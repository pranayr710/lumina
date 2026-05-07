import json
import logging
import os
import re
import subprocess
import time

import httpx

try:
    import google.generativeai as genai
except ImportError:
    genai = None

log = logging.getLogger("lumina.brain")

NX_API = "http://127.0.0.1:18181"
OL_API = "http://127.0.0.1:11434"
V_MDL = "NexaAI/OmniNeural-4B"
OL_LLM = os.environ.get("OLLAMA_LLM_MODEL", "gemma3:latest")
OL_VLM = os.environ.get("OLLAMA_VLM_MODEL", "gemma3:latest")

# All valid Lumina node type identifiers
LUMINA_NODE_TYPES = (
    "camera,video,mic,audioFile,ipCamera,"
    "detection,pose,visualLlm,audioDetect,audioLlm,whisperStt,ocr,faceMatch,"
    "logic,llm,script,debounce,merge,timer,"
    "logAction,emailAction,smsAction,slackAction,discordAction,"
    "webhookAction,mqttAction,googleSheetsAction,"
    "screenshotAction,notifyAction,speakAction,soundAction,fileAction,"
    "geminiLive,toolUse"
)

# One-shot example for pipeline generation
_WORKFLOW_EXAMPLE = (
    '{"nodes":['
    '{"id":"n1","type":"camera","data":{}},'
    '{"id":"n2","type":"detection","data":{"confidence":50}},'
    '{"id":"n3","type":"logic","data":{"conditions":[{"id":"1","operator":"contains","value":"person"}],"mode":"any"}},'
    '{"id":"n4","type":"emailAction","data":{"to":"alert@example.com","subject":"Person Detected","body":"A person was detected by Lumina."}}'
    '],'
    '"edges":['
    '{"id":"e1","source":"n1","sourceHandle":"camera","target":"n2","targetHandle":"camera"},'
    '{"id":"e2","source":"n2","sourceHandle":"match","target":"n3","targetHandle":"input"},'
    '{"id":"e3","source":"n3","sourceHandle":"match","target":"n4","targetHandle":"trigger"}'
    ']}'
)

_HANDLE_RULES = """Handle connection rules (ALWAYS follow exactly):
- camera/video/ipCamera output: sourceHandle="camera"
- detection input: targetHandle="camera" | output match: sourceHandle="match" | output miss: sourceHandle="noMatch"
- visualLlm inputs: targetHandle="camera" (frames), targetHandle="trigger" (events) | output: sourceHandle="response"
- audioDetect input: targetHandle="audio" | output match: sourceHandle="match"
- mic/audioFile output: sourceHandle="audio"
- logic input: targetHandle="input" | output match: sourceHandle="match" | output miss: sourceHandle="noMatch"
- llm/audioLlm input: targetHandle="input" | output: sourceHandle="output"
- whisperStt input: targetHandle="audio" | output: sourceHandle="transcript"
- ALL action nodes (emailAction, smsAction, slackAction, discordAction, webhookAction, mqttAction, googleSheetsAction, screenshotAction, notifyAction, speakAction, soundAction, fileAction, logAction): input targetHandle="trigger"
- timer output: sourceHandle="tick"
- geminiLive inputs: targetHandle="camera", targetHandle="audio" | output: sourceHandle="response"
- toolUse input: targetHandle="input" | output: sourceHandle="output" """


def _is_junk(t: str) -> bool:
    if not t or len(t) < 20:
        return False
    t = t.strip()
    for n in range(2, 11):
        s = t[:n]
        if not s.strip():
            continue
        if t.count(s) * n >= 0.5 * len(t):
            return True
    return False


def _extract_json_obj(txt: str) -> str | None:
    """Extract the first complete JSON object from text."""
    # Strip markdown fences
    txt = re.sub(r"```(?:json)?\s*", "", txt)
    txt = re.sub(r"```\s*", "", txt).strip()
    start = txt.find("{")
    if start == -1:
        return None
    depth = 0
    for i, c in enumerate(txt[start:], start):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return txt[start : i + 1]
    # Truncated — try to close it
    candidate = txt[start:]
    opens_b = candidate.count("{") - candidate.count("}")
    opens_sq = candidate.count("[") - candidate.count("]")
    if opens_b > 0 or opens_sq > 0:
        candidate += "]" * max(opens_sq, 0) + "}" * max(opens_b, 0)
        return candidate
    return None


def _extract_json_arr(txt: str) -> str | None:
    """Extract the first complete JSON array from text."""
    txt = re.sub(r"```(?:json)?\s*", "", txt)
    txt = re.sub(r"```\s*", "", txt).strip()
    start = txt.find("[")
    end = txt.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    return txt[start : end + 1]


class Brain:
    def __init__(self):
        self.v_on = False
        self.l_on = False
        self.nx_p = None
        self.ol_p = None
        self.use_gt = False
        self.use_gv = False
        self.use_ol = False
        self.ol_mdls: list[str] = []

        key = os.environ.get("GOOGLE_API_KEY")
        f_ot = os.environ.get("LUMINA_USE_OLLAMA_FOR_TEXT", "").lower() == "true"
        f_ov = os.environ.get("LUMINA_USE_OLLAMA_FOR_VISION", "").lower() == "true"

        if key and genai:
            try:
                genai.configure(api_key=key)
                self.g_mdl = genai.GenerativeModel("gemini-2.0-flash")
                self.use_gt = not f_ot
                self.use_gv = not f_ov
                log.info(f"Gemini: text={self.use_gt}, vision={self.use_gv}")
            except Exception as e:
                log.error(f"Gemini init error: {e}")

        if not self._ck_ol():
            try:
                self.ol_p = subprocess.Popen(
                    ["ollama", "serve"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                for _ in range(10):
                    time.sleep(1)
                    if self._ck_ol():
                        break
            except Exception:
                pass

        if self._ck_ol():
            try:
                r = httpx.get(f"{OL_API}/api/tags", timeout=2)
                self.use_ol = True
                self.ol_mdls = [m["name"] for m in r.json().get("models", [])]
                log.info(f"Ollama models: {self.ol_mdls}")
            except Exception:
                pass

    # ── Model Loading ─────────────────────────────────────────────────────────

    def load_v(self, m: str = "NexaAI/OmniNeural-4B"):
        global V_MDL
        V_MDL = m
        if self._ck_nx():
            self.v_on = True
            return
        try:
            self.nx_p = subprocess.Popen(
                ["nexa", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(30):
                time.sleep(1)
                if self._ck_nx():
                    self.v_on = True
                    return
        except Exception:
            pass

    def load_l(self):
        self.l_on = self.v_on

    def _ck_nx(self) -> bool:
        try:
            return httpx.get(f"{NX_API}/v1/models", timeout=1).status_code == 200
        except Exception:
            return False

    def _ck_ol(self) -> bool:
        try:
            return httpx.get(f"{OL_API}/api/tags", timeout=1).status_code == 200
        except Exception:
            return False

    @property
    def v_rdy(self) -> bool:
        ol_v = any(
            m.startswith(("llava", "moondream", "gemma3", "gemma"))
            for m in self.ol_mdls
        )
        return self.use_gv or self.v_on or ol_v

    @property
    def l_rdy(self) -> bool:
        return self.use_gt or self.l_on or self.use_ol

    # ── Vision ────────────────────────────────────────────────────────────────

    def run_v(self, img: str, p: str = "Describe", cid: str = "") -> dict:
        if not self.v_rdy:
            return {"analysis": "[No vision model ready]", "latency_ms": 0}
        if self.use_gv:
            return self._v_g(img, p)
        if self.v_on:
            return self._v_nx(img, p)
        if self.use_ol:
            m = next(
                (m for m in self.ol_mdls if m.startswith(("moondream", "llava", "gemma3", "gemma"))),
                None,
            )
            if m:
                return self._v_ol(img, p, m)
        return {"analysis": "[No vision engine]", "latency_ms": 0}

    def _v_g(self, img: str, p: str) -> dict:
        import base64 as b64
        t0 = time.perf_counter()
        try:
            if "," in img:
                img = img.split(",")[1]
            data = b64.b64decode(img)
            res = self.g_mdl.generate_content(
                [p, {"mime_type": "image/jpeg", "data": data}]
            )
            txt = res.text
            if _is_junk(txt):
                raise ValueError("Junk output")
        except Exception as e:
            log.error(f"Gemini vision error: {e}")
            if self.use_ol:
                m = next(
                    (m for m in self.ol_mdls if m.startswith(("moondream", "llava", "gemma3"))),
                    None,
                )
                if m:
                    return self._v_ol(img, p, m)
            txt = f"Error: {e}"
        return {"analysis": txt, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}

    def _v_nx(self, img: str, p: str) -> dict:
        t0 = time.perf_counter()
        try:
            if "," in img:
                img = img.split(",")[1]
            r = httpx.post(
                f"{NX_API}/v1/chat/completions",
                json={
                    "model": V_MDL,
                    "messages": [
                        {"role": "user", "content": [
                            {"type": "text", "text": p},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}},
                        ]}
                    ],
                },
                timeout=60,
            )
            txt = r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            txt = f"Nexa error: {e}"
        return {"analysis": txt, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}

    def _v_ol(self, img: str, p: str, m: str) -> dict:
        t0 = time.perf_counter()
        try:
            if "," in img:
                img = img.split(",")[1]
            r = httpx.post(
                f"{OL_API}/api/generate",
                json={"model": m, "prompt": p, "images": [img], "stream": False},
                timeout=60,
            )
            txt = r.json().get("response", "")
        except Exception as e:
            txt = f"Ollama vision error: {e}"
        return {"analysis": txt, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}

    # ── Text Generation ───────────────────────────────────────────────────────

    def gen_txt(self, p: str, max_tk: int = 1024, is_json: bool = False) -> dict:
        if self.use_gt:
            try:
                cfg = None
                if is_json and genai:
                    cfg = genai.GenerationConfig(
                        response_mime_type="application/json",
                        max_output_tokens=max_tk,
                    )
                res = self.g_mdl.generate_content(p, generation_config=cfg)
                txt = res.text
                if _is_junk(txt):
                    raise ValueError("Junk output")
                return {"text": txt}
            except Exception as e:
                log.error(f"Gemini text error: {e}")

        if self.use_ol:
            try:
                req: dict = {
                    "model": OL_LLM,
                    "prompt": p,
                    "stream": False,
                    "options": {"num_predict": max_tk},
                }
                if is_json:
                    req["format"] = "json"
                r = httpx.post(f"{OL_API}/api/generate", json=req, timeout=120)
                txt = r.json().get("response", "")
                if _is_junk(txt):
                    return {"text": "", "error": "Repetitive output from model"}
                return {"text": txt}
            except Exception as e:
                return {"text": "", "error": str(e)}

        return {"text": "", "error": "[No LLM available]"}

    # ── Workflow Generation (Gemma3-optimised) ────────────────────────────────

    def gen_workflow(self, description: str) -> dict:
        """Generate a Lumina pipeline JSON from natural language.

        Uses a structured one-shot prompt with explicit handle rules that
        guides smaller models (Gemma3, Llama 3.2) to produce valid JSON.
        """
        prompt = (
            f"You are a JSON generator for Lumina AI pipelines. "
            f"Output ONLY a valid JSON object. No explanation, no markdown.\n\n"
            f"Available node types: {LUMINA_NODE_TYPES}\n\n"
            f"{_HANDLE_RULES}\n\n"
            f"Example pipeline for 'detect people and email alert':\n"
            f"{_WORKFLOW_EXAMPLE}\n\n"
            f"Now generate a pipeline for: \"{description}\"\n\n"
            f"Rules:\n"
            f"- Use only node types from the list above\n"
            f"- Node ids: n1, n2, n3, ...\n"
            f"- Edge ids: e1, e2, e3, ...\n"
            f"- data field: include relevant config (confidence, prompt, subject, etc.)\n"
            f"- Always start with an input node (camera, mic, timer, video, ipCamera)\n"
            f"- Always end with an action node (logAction, emailAction, slackAction, etc.)\n"
            f"Output (JSON only):"
        )

        result = self.gen_txt(prompt, max_tk=2048, is_json=True)
        raw = result.get("text", "")
        if not raw:
            return {"nodes": [], "edges": [], "error": result.get("error", "No output")}

        return self._parse_workflow_json(raw)

    def _parse_workflow_json(self, txt: str) -> dict:
        """Robustly extract nodes/edges from LLM output."""
        candidate = _extract_json_obj(txt)
        if not candidate:
            return {"nodes": [], "edges": [], "error": "No JSON object found in output"}
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            # Last-resort: try to fix common issues
            fixed = re.sub(r",\s*([}\]])", r"\1", candidate)  # trailing commas
            try:
                data = json.loads(fixed)
            except Exception as e:
                return {"nodes": [], "edges": [], "error": f"JSON parse failed: {e}"}

        nodes = data.get("nodes", [])
        edges = data.get("edges", [])

        # Validate and clean nodes
        valid_types = set(LUMINA_NODE_TYPES.split(","))
        clean_nodes = []
        for n in nodes:
            if isinstance(n, dict) and n.get("type") in valid_types:
                clean_nodes.append({
                    "id": str(n.get("id", f"n{len(clean_nodes)+1}")),
                    "type": n["type"],
                    "data": n.get("data", {}),
                })

        # Validate edges reference valid node ids
        node_ids = {n["id"] for n in clean_nodes}
        clean_edges = []
        for e in edges:
            if (isinstance(e, dict)
                    and e.get("source") in node_ids
                    and e.get("target") in node_ids):
                clean_edges.append({
                    "id": str(e.get("id", f"e{len(clean_edges)+1}")),
                    "source": e["source"],
                    "target": e["target"],
                    "sourceHandle": e.get("sourceHandle", "output"),
                    "targetHandle": e.get("targetHandle", "input"),
                })

        if not clean_nodes:
            return {"nodes": [], "edges": [], "error": "No valid nodes generated"}

        return {"nodes": clean_nodes, "edges": clean_edges}

    # ── Chat Refinement ───────────────────────────────────────────────────────

    def chat_refine(self, user_prompt: str, current_workflow: dict | None) -> dict:
        """Use AI to respond to workflow refinement chat messages."""
        ctx = ""
        if current_workflow:
            node_summary = [
                f"{n.get('type')} (id:{n.get('id')})"
                for n in current_workflow.get("nodes", [])
            ]
            ctx = f"\nCurrent pipeline nodes: {', '.join(node_summary)}"

        full_prompt = (
            f"You are a Lumina AI pipeline assistant. "
            f"Help the user build or modify their visual AI pipeline.{ctx}\n\n"
            f"User: {user_prompt}\n\n"
            f"If the user wants to add or change nodes, respond with a JSON object:\n"
            f'{{ "message": "explanation", "new_workflow": {{ "nodes": [...], "edges": [...] }} }}\n\n'
            f"Otherwise just respond conversationally:\n"
            f'{{ "message": "your response" }}\n\n'
            f"Available types: {LUMINA_NODE_TYPES}\n"
            f"{_HANDLE_RULES}\n"
            f"Response (JSON only):"
        )

        result = self.gen_txt(full_prompt, max_tk=2048, is_json=True)
        raw = result.get("text", "")
        if not raw:
            return {"message": f"Error: {result.get('error', 'No response')}"}

        candidate = _extract_json_obj(raw)
        if candidate:
            try:
                data = json.loads(candidate)
                # Validate new_workflow if present
                if "new_workflow" in data:
                    parsed = self._parse_workflow_json(json.dumps(data["new_workflow"]))
                    if parsed.get("nodes"):
                        data["new_workflow"] = parsed
                    else:
                        del data["new_workflow"]
                return data
            except Exception:
                pass

        # Fallback: return raw text as message
        return {"message": raw.strip()[:500]}

    # ── Auto Connect ──────────────────────────────────────────────────────────

    def auto_connect(self, nodes: list, existing_edges: list) -> list:
        """Suggest connections between unconnected nodes using AI."""
        if not nodes:
            return []

        existing_pairs = {(e.get("source"), e.get("target")) for e in existing_edges}
        node_list = [{"id": n.get("id"), "type": n.get("type")} for n in nodes]

        prompt = (
            f"You are a Lumina pipeline wiring assistant. "
            f"Suggest the correct edges to connect these nodes.\n\n"
            f"Nodes: {json.dumps(node_list)}\n\n"
            f"Already connected: {json.dumps(list(existing_pairs))}\n\n"
            f"{_HANDLE_RULES}\n\n"
            f"Output ONLY a JSON array of new edge objects:\n"
            f'[{{"source":"n1","sourceHandle":"camera","target":"n2","targetHandle":"camera"}}]\n\n'
            f"Do not repeat existing connections. Edges only:"
        )

        result = self.gen_txt(prompt, max_tk=1024, is_json=True)
        raw = result.get("text", "")
        if not raw:
            return self._rule_based_connect(nodes, existing_pairs)

        candidate = _extract_json_arr(raw)
        if not candidate:
            return self._rule_based_connect(nodes, existing_pairs)

        try:
            edges = json.loads(candidate)
            node_ids = {n.get("id") for n in nodes}
            return [
                e for e in edges
                if isinstance(e, dict)
                and e.get("source") in node_ids
                and e.get("target") in node_ids
                and (e.get("source"), e.get("target")) not in existing_pairs
            ]
        except Exception:
            return self._rule_based_connect(nodes, existing_pairs)

    def _rule_based_connect(self, nodes: list, existing: set) -> list:
        """Fallback rule-based auto-connect for common pipeline patterns."""
        edges = []
        by_type: dict[str, list] = {}
        for n in nodes:
            t = n.get("type", "")
            by_type.setdefault(t, []).append(n["id"])

        def add(s, sh, t, th):
            if (s, t) not in existing:
                edges.append({
                    "source": s, "sourceHandle": sh,
                    "target": t, "targetHandle": th,
                    "id": f"auto-{s}-{t}",
                })
                existing.add((s, t))

        # Camera → detection
        for cam in by_type.get("camera", []) + by_type.get("video", []) + by_type.get("ipCamera", []):
            for det in by_type.get("detection", []):
                add(cam, "camera", det, "camera")
            for vlm in by_type.get("visualLlm", []) + by_type.get("geminiLive", []):
                add(cam, "camera", vlm, "camera")
            for ocr in by_type.get("ocr", []) + by_type.get("faceMatch", []) + by_type.get("pose", []):
                add(cam, "camera", ocr, "camera")

        # Mic → audio nodes
        for mic in by_type.get("mic", []) + by_type.get("audioFile", []):
            for ad in by_type.get("audioDetect", []):
                add(mic, "audio", ad, "audio")
            for wh in by_type.get("whisperStt", []):
                add(mic, "audio", wh, "audio")
            for al in by_type.get("audioLlm", []):
                add(mic, "audio", al, "audio")

        # Detection match → logic / actions
        for det in by_type.get("detection", []):
            for lg in by_type.get("logic", []):
                add(det, "match", lg, "input")
            for vlm in by_type.get("visualLlm", []):
                add(det, "match", vlm, "trigger")

        # VLM / LLM response → logic / actions
        for vlm in by_type.get("visualLlm", []) + by_type.get("geminiLive", []):
            for lg in by_type.get("logic", []):
                add(vlm, "response", lg, "input")
            for llm in by_type.get("llm", []):
                add(vlm, "response", llm, "input")
            for tu in by_type.get("toolUse", []):
                add(vlm, "response", tu, "input")

        for llm in by_type.get("llm", []):
            for lg in by_type.get("logic", []):
                add(llm, "output", lg, "input")

        for whisper in by_type.get("whisperStt", []):
            for lg in by_type.get("logic", []):
                add(whisper, "transcript", lg, "input")
            for llm in by_type.get("llm", []):
                add(whisper, "transcript", llm, "input")

        # Logic match → actions
        all_actions = (
            by_type.get("emailAction", [])
            + by_type.get("smsAction", [])
            + by_type.get("slackAction", [])
            + by_type.get("discordAction", [])
            + by_type.get("webhookAction", [])
            + by_type.get("mqttAction", [])
            + by_type.get("logAction", [])
            + by_type.get("screenshotAction", [])
            + by_type.get("notifyAction", [])
            + by_type.get("speakAction", [])
            + by_type.get("soundAction", [])
            + by_type.get("fileAction", [])
            + by_type.get("googleSheetsAction", [])
        )
        for lg in by_type.get("logic", []):
            for act in all_actions:
                add(lg, "match", act, "trigger")

        # Timer → various processing nodes
        for tmr in by_type.get("timer", []):
            for n in (
                by_type.get("llm", [])
                + by_type.get("visualLlm", [])
                + by_type.get("script", [])
            ):
                add(tmr, "tick", n, "trigger")

        return edges

    # ── Tool Use / Function Calling ───────────────────────────────────────────

    def run_tool_use(
        self,
        input_text: str,
        tool_name: str,
        tool_desc: str,
        tool_params: dict,
    ) -> dict:
        """Use Gemini function calling to decide whether to invoke a tool."""
        if self.use_gt and genai:
            try:
                tool_def = genai.protos.Tool(
                    function_declarations=[
                        genai.protos.FunctionDeclaration(
                            name=tool_name,
                            description=tool_desc,
                            parameters=genai.protos.Schema(
                                type=genai.protos.Type.OBJECT,
                                properties={
                                    k: genai.protos.Schema(
                                        type=genai.protos.Type.STRING,
                                        description=v.get("description", k),
                                    )
                                    for k, v in tool_params.items()
                                },
                            ),
                        )
                    ]
                )
                res = self.g_mdl.generate_content(input_text, tools=[tool_def])
                for part in res.candidates[0].content.parts:
                    if part.function_call:
                        args = dict(part.function_call.args)
                        return {
                            "called": True,
                            "tool": tool_name,
                            "args": args,
                            "reasoning": f"Gemini decided to call {tool_name}",
                        }
                return {"called": False, "reason": res.text}
            except Exception as e:
                log.error(f"Tool use error: {e}")

        # Fallback: simple keyword matching via LLM
        param_names = list(tool_params.keys())
        prompt = (
            f"Given this input text, decide if the tool '{tool_name}' should be called.\n"
            f"Tool description: {tool_desc}\n"
            f"Input: {input_text}\n\n"
            f"If yes, extract these parameters: {param_names}\n"
            f'Output JSON: {{"called": true, "args": {{"param1": "value1"}}}} or {{"called": false, "reason": "why not"}}'
        )
        result = self.gen_txt(prompt, max_tk=256, is_json=True)
        raw = result.get("text", "")
        candidate = _extract_json_obj(raw)
        if candidate:
            try:
                return json.loads(candidate)
            except Exception:
                pass
        return {"called": False, "reason": "Could not determine"}

    def shut(self):
        if self.nx_p:
            self.nx_p.terminate()
        if self.ol_p:
            self.ol_p.terminate()
