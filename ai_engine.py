import json
import logging
import os
import re
import subprocess
import threading
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
OL_VLM = os.environ.get("OLLAMA_VLM_MODEL", "llava:latest")

# Models confirmed to support vision (images) in Ollama
_OL_VISION_MODELS = ("llava", "moondream", "bakllava", "minicpm-v", "llava-phi3", "llava-llama3")

# All valid Lumina node type identifiers (must match l/reactFlowTypes.ts registry)
LUMINA_NODE_TYPES = (
    "camera,video,mic,audioFile,ipCamera,"
    "detection,pose,visualLlm,audioDetect,audioLlm,whisperStt,ocr,faceMatch,"
    "logic,llm,script,debounce,merge,"
    "logAction,emailAction,smsAction,slackAction,discordAction,"
    "webhookAction,mqttAction,googleSheetsAction,"
    "screenshotAction,notifyAction,speakAction,soundAction,fileAction,"
    "geminiLive,toolUse"
)

# Ground-truth handle ids per node type, scraped from c/nodes/*.tsx.
# ReactFlow SILENTLY DROPS any edge whose handle id doesn't exist on the node,
# so all AI-generated edges are snapped to these before reaching the canvas.
# Format: type -> (source/output handles in priority order, target/input handles)
_NODE_HANDLES: dict[str, tuple[list, list]] = {
    "camera":             (["camera"], []),
    "video":              (["frames"], []),
    "ipCamera":           (["frames"], []),
    "mic":                (["audio"], []),
    "audioFile":          (["audio"], []),
    "detection":          (["match", "no_match"], ["camera"]),
    "pose":               (["output", "fall"], ["camera"]),
    "faceMatch":          (["output"], ["camera", "trigger"]),
    "ocr":                (["output"], ["camera", "trigger"]),
    "visualLlm":          (["response"], ["camera", "trigger"]),
    "geminiLive":         (["response"], ["camera", "audio"]),
    "audioDetect":        (["match", "no_match"], ["audio"]),
    "audioLlm":           (["response"], ["audio"]),
    "whisperStt":         (["output"], ["audio"]),
    "logic":              (["match", "no_match"], ["input"]),
    "llm":                (["output"], ["input"]),
    "toolUse":            (["output"], ["input"]),
    "script":             (["output"], ["input"]),
    "debounce":           (["output"], ["input"]),
    "merge":              (["output"], ["inputA", "inputB"]),
    "logAction":          ([], ["trigger"]),
    "emailAction":        ([], ["trigger"]),
    "smsAction":          ([], ["trigger"]),
    "slackAction":        ([], ["trigger"]),
    "discordAction":      ([], ["trigger"]),
    "webhookAction":      ([], ["trigger"]),
    "mqttAction":         ([], ["trigger"]),
    "googleSheetsAction": ([], ["trigger"]),
    "screenshotAction":   ([], ["camera", "trigger"]),
    "notifyAction":       ([], ["trigger"]),
    "speakAction":        ([], ["trigger"]),
    "soundAction":        ([], ["trigger"]),
    "fileAction":         ([], ["trigger"]),
}

_FRAME_PRODUCERS = ("camera", "video", "ipCamera")
_AUDIO_PRODUCERS = ("mic", "audioFile")

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

# Two-input example: camera + mic, combined, fanning out to several actions.
# Mirrors the hardest common shape ("when X is seen AND Y is said, do A, B, C").
_WORKFLOW_EXAMPLE_2 = (
    '{"nodes":['
    '{"id":"n1","type":"camera","data":{}},'
    '{"id":"n2","type":"detection","data":{"confidence":50}},'
    '{"id":"n3","type":"mic","data":{}},'
    '{"id":"n4","type":"whisperStt","data":{}},'
    '{"id":"n5","type":"merge","data":{}},'
    '{"id":"n6","type":"logic","data":{"conditions":[{"id":"1","operator":"contains","value":"hello"},{"id":"2","operator":"contains","value":"help"}],"mode":"any"}},'
    '{"id":"n7","type":"speakAction","data":{"text":"Welcome!"}},'
    '{"id":"n8","type":"fileAction","data":{"filePath":"logs/events.csv"}}'
    '],'
    '"edges":['
    '{"id":"e1","source":"n1","sourceHandle":"camera","target":"n2","targetHandle":"camera"},'
    '{"id":"e2","source":"n3","sourceHandle":"audio","target":"n4","targetHandle":"audio"},'
    '{"id":"e3","source":"n2","sourceHandle":"match","target":"n5","targetHandle":"inputA"},'
    '{"id":"e4","source":"n4","sourceHandle":"output","target":"n5","targetHandle":"inputB"},'
    '{"id":"e5","source":"n5","sourceHandle":"output","target":"n6","targetHandle":"input"},'
    '{"id":"e6","source":"n6","sourceHandle":"match","target":"n7","targetHandle":"trigger"},'
    '{"id":"e7","source":"n6","sourceHandle":"match","target":"n8","targetHandle":"trigger"}'
    ']}'
)

_HANDLE_RULES = """Handle connection rules (handles are OPTIONAL — if unsure, omit them and they will be auto-assigned):
- camera out: "camera" | video/ipCamera out: "frames" | mic/audioFile out: "audio"
- detection: in "camera" | out "match" / "no_match"
- faceMatch / ocr: in "camera" | out "output"
- pose: in "camera" | out "output" ("fall" for fall events)
- visualLlm: in "camera" (frames) or "trigger" (events) | out "response"
- geminiLive: in "camera" + "audio" | out "response"
- audioDetect: in "audio" | out "match" / "no_match"
- audioLlm: in "audio" | out "response"
- whisperStt: in "audio" | out "output"
- logic: in "input" | out "match" / "no_match"
- llm / toolUse / script / debounce: in "input" | out "output"
- merge: in "inputA" / "inputB" | out "output"
- ALL *Action nodes: in "trigger" (they have no outputs)"""


def _fix_edges(edges: list, type_by_id: dict) -> list:
    """Snap AI-suggested edges onto handles that actually exist on each node.

    Small local models (gemma3, llama3.2) reliably pick the right nodes to
    connect but rarely emit exact handle ids; ReactFlow silently drops any
    edge with an unknown handle, which made auto-wire 'do nothing' on local
    models. This makes handle choice deterministic so the model only has to
    get source/target right.
    """
    fixed, seen, used_inputs = [], set(), set()
    for e in edges:
        if not isinstance(e, dict):
            continue
        s, t = e.get("source"), e.get("target")
        st, tt = type_by_id.get(s), type_by_id.get(t)
        if not st or not tt or s == t or (s, t) in seen:
            continue
        src_outs = _NODE_HANDLES.get(st, (["output"], []))[0]
        tgt_ins = _NODE_HANDLES.get(tt, ([], ["input"]))[1]
        if not src_outs or not tgt_ins:
            continue  # edge out of an action node, or into a pure source — impossible

        sh = e.get("sourceHandle")
        if sh not in src_outs:
            sh = src_outs[0]

        th = e.get("targetHandle")
        if th not in tgt_ins:
            if st in _FRAME_PRODUCERS and "camera" in tgt_ins:
                th = "camera"
            elif st in _AUDIO_PRODUCERS and "audio" in tgt_ins:
                th = "audio"
            elif "trigger" in tgt_ins and st not in _FRAME_PRODUCERS + _AUDIO_PRODUCERS:
                th = "trigger"
            elif "input" in tgt_ins:
                th = "input"
            else:
                # multi-input nodes (merge): pick the first unused port
                th = next((h for h in tgt_ins if (t, h) not in used_inputs), tgt_ins[0])

        seen.add((s, t))
        used_inputs.add((t, th))
        fixed.append({
            "id": e.get("id") or f"e-{s}-{t}",
            "source": s, "sourceHandle": sh,
            "target": t, "targetHandle": th,
        })
    return fixed


def _repair_workflow(nodes: list, edges: list) -> list:
    """Structural repair (runs after handle-snapping). Local models reliably
    pick nodes but routinely build chains like camera→detect→logic→VLM and
    forget that the VLM ALSO needs the camera's frames — leaving vision nodes
    silently inert. This guarantees every camera-consuming node is fed by a
    real frame source, and moves event edges that landed on a 'camera' handle
    onto 'trigger' where the node supports it.
    """
    type_by_id = {n["id"]: n["type"] for n in nodes}
    frame_sources = [n["id"] for n in nodes if n["type"] in _FRAME_PRODUCERS]
    if not frame_sources:
        return edges

    # Nodes whose input handles include "camera"
    consumers = [n["id"] for n in nodes
                 if "camera" in _NODE_HANDLES.get(n["type"], ([], []))[1]]

    def out_handle(src_id: str) -> str:
        return _NODE_HANDLES.get(type_by_id.get(src_id, "camera"), (["camera"], []))[0][0]

    def trace(start: str, producer_types) -> str | None:
        """BFS upstream from `start` to the nearest producer of the given kind."""
        seen, frontier = {start}, [e["source"] for e in edges if e["target"] == start]
        while frontier:
            nxt = []
            for nid in frontier:
                if nid in seen:
                    continue
                seen.add(nid)
                if type_by_id.get(nid) in producer_types:
                    return nid
                nxt += [e["source"] for e in edges if e["target"] == nid]
            frontier = nxt
        return None

    used_ids = {e.get("id") for e in edges}
    def new_id() -> str:
        i = len(edges) + 1
        while f"e{i}" in used_ids:
            i += 1
        used_ids.add(f"e{i}")
        return f"e{i}"

    for cid in consumers:
        ctype = type_by_id[cid]
        has_trigger_handle = "trigger" in _NODE_HANDLES.get(ctype, ([], []))[1]

        # 1. An edge sitting on the 'camera' handle whose source isn't a frame
        #    producer is really an event trigger — move it (if the node has a
        #    trigger handle and isn't already triggered).
        if has_trigger_handle:
            has_trigger = any(e["target"] == cid and e.get("targetHandle") == "trigger"
                              for e in edges)
            for e in edges:
                if (e["target"] == cid and e.get("targetHandle") == "camera"
                        and type_by_id.get(e["source"]) not in _FRAME_PRODUCERS
                        and not has_trigger):
                    e["targetHandle"] = "trigger"
                    has_trigger = True

        # 2. Guarantee a real frame source feeds the 'camera' handle.
        good = any(e["target"] == cid and e.get("targetHandle") == "camera"
                   and type_by_id.get(e["source"]) in _FRAME_PRODUCERS for e in edges)
        if not good:
            src = trace(cid, _FRAME_PRODUCERS) or frame_sources[0]
            edges.append({
                "id": new_id(), "source": src, "sourceHandle": out_handle(src),
                "target": cid, "targetHandle": "camera",
            })

    # 2b. Same guarantee for audio consumers (whisperStt, audioDetect, audioLlm,
    #     geminiLive) — feed each from a mic/audioFile source if nothing does.
    audio_sources = [n["id"] for n in nodes if n["type"] in _AUDIO_PRODUCERS]
    if audio_sources:
        audio_consumers = [n["id"] for n in nodes
                           if "audio" in _NODE_HANDLES.get(n["type"], ([], []))[1]]
        for cid in audio_consumers:
            good = any(e["target"] == cid and e.get("targetHandle") == "audio"
                       and type_by_id.get(e["source"]) in _AUDIO_PRODUCERS for e in edges)
            if not good:
                src = trace(cid, _AUDIO_PRODUCERS) or audio_sources[0]
                edges.append({
                    "id": new_id(), "source": src, "sourceHandle": out_handle(src),
                    "target": cid, "targetHandle": "audio",
                })

    # 3. Wire orphaned action nodes. Action/sink nodes have no outputs; if one
    #    has no incoming trigger it would sit dead (the common "fileAction left
    #    dangling" case). Attach it to the pipeline's result producer.
    action_types = {t for t, (outs, _ins) in _NODE_HANDLES.items() if not outs}

    def pick_trigger_source() -> str | None:
        # Prefer whatever already feeds other action nodes (keeps the fan-out together).
        feeders = [e["source"] for e in edges if type_by_id.get(e["target"]) in action_types]
        if feeders:
            return max(set(feeders), key=feeders.count)
        # Otherwise the most "downstream" result producer by type preference.
        for t in ("logic", "merge", "visualLlm", "llm", "audioLlm", "toolUse",
                  "whisperStt", "ocr", "faceMatch", "pose", "detection", "audioDetect"):
            for n in nodes:
                if n["type"] == t:
                    return n["id"]
        return None

    for n in nodes:
        if n["type"] not in action_types:
            continue
        nid = n["id"]
        if any(e["target"] == nid and e.get("targetHandle") == "trigger" for e in edges):
            continue
        src = pick_trigger_source()
        if src and src != nid:
            sh = out_handle(src)
            # logic emits on "match"; that's already out_handle's first choice
            edges.append({
                "id": new_id(), "source": src, "sourceHandle": sh,
                "target": nid, "targetHandle": "trigger",
            })

    # 4. De-dupe single-source handles. 'camera'/'audio' take exactly one feed;
    #    when the model wired several (e.g. camera→whisper[audio]), keep the one
    #    from a real producer of that modality and drop the rest.
    for n in nodes:
        for handle, producers in (("camera", _FRAME_PRODUCERS), ("audio", _AUDIO_PRODUCERS)):
            ins = [e for e in edges if e["target"] == n["id"] and e.get("targetHandle") == handle]
            if len(ins) <= 1:
                continue
            keep = next((e for e in ins if type_by_id.get(e["source"]) in producers), ins[0])
            for e in ins:
                if e is not keep:
                    edges.remove(e)
    return edges


# Aliases small models commonly emit instead of the exact registry name
_TYPE_ALIASES = {
    "webcam": "camera", "objectdetection": "detection", "detect": "detection",
    "object": "detection", "yolo": "detection", "vlm": "visualLlm",
    "visionllm": "visualLlm", "visual_llm": "visualLlm", "imagellm": "visualLlm",
    "facedetection": "faceMatch", "face": "faceMatch", "facematch": "faceMatch",
    "posedetection": "pose", "falldetection": "pose",
    "stt": "whisperStt", "whisper": "whisperStt", "speechtotext": "whisperStt",
    "transcribe": "whisperStt", "audiodetection": "audioDetect",
    "sounddetection": "audioDetect", "condition": "logic", "filter": "logic",
    "if": "logic", "switch": "logic", "textllm": "llm", "gpt": "llm", "gemma": "llm",
    "email": "emailAction", "mail": "emailAction", "sms": "smsAction",
    "slack": "slackAction", "discord": "discordAction", "webhook": "webhookAction",
    "mqtt": "mqttAction", "log": "logAction", "logger": "logAction",
    "notify": "notifyAction", "notification": "notifyAction",
    "speak": "speakAction", "tts": "speakAction", "sound": "soundAction",
    "alarm": "soundAction", "screenshot": "screenshotAction",
    "file": "fileAction", "save": "fileAction", "sheets": "googleSheetsAction",
    "googlesheets": "googleSheetsAction", "microphone": "mic",
    "audioinput": "mic",
}


def _normalize_node_type(raw: str) -> str | None:
    """Resolve an LLM-emitted node type to an exact registry name, or None."""
    if raw in _NODE_HANDLES:
        return raw
    key = re.sub(r"[\s_\-]+", "", raw).lower()
    # exact case-insensitive match against the registry
    for t in _NODE_HANDLES:
        if t.lower() == key:
            return t
    return _TYPE_ALIASES.get(key)


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


class AIEngine:
    def __init__(self):
        self.v_on = False
        self.l_on = False
        self.nx_p = None
        self.ol_p = None
        self.use_gt = False
        self.use_gv = False
        self.use_ol = False
        self.ol_mdls: list[str] = []
        # Ollama only handles ONE inference at a time — queue concurrent calls
        # so they don't crash each other (threading.Semaphore works across executors)
        self._ol_lock = threading.Semaphore(1)

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
        # Only count models that actually support image input
        ol_v = any(m.startswith(_OL_VISION_MODELS) for m in self.ol_mdls)
        return self.use_gv or self.v_on or ol_v

    @property
    def l_rdy(self) -> bool:
        return self.use_gt or self.l_on or self.use_ol

    def warmup(self):
        """Fire a tiny generation so Ollama loads the LLM into RAM now, turning
        the user's first real request from a ~80s cold load into a warm call.
        Safe to call in a background thread; failures are ignored."""
        if not self.use_ol or self.use_gt:
            return  # Gemini has no cold-load problem; skip when it's the text engine
        try:
            with self._ol_lock:
                httpx.post(
                    f"{OL_API}/api/generate",
                    json={"model": OL_LLM, "prompt": "ok", "stream": False,
                          "options": {"num_predict": 1}},
                    timeout=180,
                )
            log.info(f"Ollama LLM '{OL_LLM}' warmed up")
        except Exception as e:
            log.info(f"LLM warmup skipped: {e}")

    # ── Vision ────────────────────────────────────────────────────────────────

    def run_v(self, img: str, p: str = "Describe", cid: str = "") -> dict:
        if not self.v_rdy:
            return {"analysis": "[No vision model ready]", "latency_ms": 0}
        if self.use_gv:
            return self._v_g(img, p)
        if self.v_on:
            return self._v_nx(img, p)
        if self.use_ol:
            # Prefer the explicitly configured VLM model, then fall back to first available vision model
            preferred = OL_VLM.split(":")[0]   # e.g. "moondream" from "moondream:latest"
            m = next(
                (m for m in self.ol_mdls if m.startswith(preferred)),
                next((m for m in self.ol_mdls if m.startswith(_OL_VISION_MODELS)), None)
            )
            if m:
                log.info(f"[VLM] using model: {m}")
                return self._v_ol(img, p, m)
            log.warning("No vision-capable Ollama model found. Run: ollama pull moondream")
            return {"analysis": "[No vision model — run: ollama pull moondream]", "latency_ms": 0}
        return {"analysis": "[No vision engine available]", "latency_ms": 0}

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
                m = next((m for m in self.ol_mdls if m.startswith(_OL_VISION_MODELS)), None)
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
        with self._ol_lock:   # only ONE Ollama call at a time — prevents crashes
            try:
                if "," in img:
                    img = img.split(",")[1]
                r = httpx.post(
                    f"{OL_API}/api/generate",
                    json={"model": m, "prompt": p, "images": [img], "stream": False},
                    timeout=120,  # llava on CPU needs ~60s; moondream needs ~20s
                )
                txt = r.json().get("response", "").strip()
                if not txt:
                    txt = "[VLM returned empty response]"
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
            with self._ol_lock:   # queue behind any running VLM call
                try:
                    req: dict = {
                        "model": OL_LLM,
                        "prompt": p,
                        "stream": False,
                        "options": {"num_predict": max_tk},
                    }
                    if is_json:
                        req["format"] = "json"
                    # 180s: cold model load alone can take ~80s on CPU, plus
                    # structured JSON generation for workflows
                    r = httpx.post(f"{OL_API}/api/generate", json=req, timeout=180)
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
            f"Example 1 — 'detect people and email alert':\n"
            f"{_WORKFLOW_EXAMPLE}\n\n"
            f"Example 2 — 'when a person is seen AND someone says hello/help, speak and log to file':\n"
            f"{_WORKFLOW_EXAMPLE_2}\n\n"
            f"Now generate a pipeline for: \"{description}\"\n\n"
            f"Rules:\n"
            f"- Use only node types from the list above\n"
            f"- Node ids: n1, n2, n3, ...; edge ids: e1, e2, e3, ...\n"
            f"- data field: include relevant config (confidence, prompt, subject, etc.)\n"
            f"- Start with input nodes (camera, mic, video, ipCamera); use ONE input per sensor, no duplicates\n"
            f"- For SPOKEN WORDS/PHRASES (someone says 'hello', 'help'), use whisperStt then a logic node with 'contains'. "
            f"Use audioDetect only for sound CATEGORIES (bark, alarm, music)\n"
            f"- To combine TWO sources before acting, send both into a merge node (inputA/inputB), then to logic\n"
            f"- EVERY node must be connected: each non-input node needs an incoming edge, each non-action needs an outgoing edge, "
            f"and every action node needs an incoming trigger. No orphan nodes.\n"
            f"- End with the action node(s) the user asked for (speakAction, fileAction, slackAction, ...)\n"
            f"Output (JSON only):"
        )

        result = self.gen_txt(prompt, max_tk=2048, is_json=True)
        raw = result.get("text", "")
        parsed = self._parse_workflow_json(raw) if raw else {"nodes": [], "edges": []}

        # Local models sometimes return junk/timeouts — never leave the user
        # with nothing: build the pipeline from keywords instead.
        if not parsed.get("nodes"):
            log.info(f"gen_workflow: LLM output unusable ({parsed.get('error') or result.get('error')}), using keyword fallback")
            parsed = self._rule_based_workflow(description)

        parsed.pop("error", None)
        return parsed

    def _rule_based_workflow(self, description: str) -> dict:
        """Keyword-driven pipeline builder — guarantees workflow generation
        works even when no LLM is available or the local model fails."""
        d = description.lower()
        nodes: list[dict] = []

        def add(t: str, data: dict | None = None) -> str:
            nid = f"n{len(nodes)+1}"
            nodes.append({"id": nid, "type": t, "data": data or {}})
            return nid

        audio_in = any(k in d for k in ("mic", "speech", "voice", "listen", "spoken", "say something", "audio"))
        add("mic" if audio_in else "camera")

        # Processing nodes
        n_procs = 0
        if any(k in d for k in ("face", "recogni")):
            add("faceMatch"); n_procs += 1
        if any(k in d for k in ("pose", "fall", "posture")):
            add("pose"); n_procs += 1
        if any(k in d for k in ("ocr", "read text", "license", "plate", "document")):
            add("ocr"); n_procs += 1
        if any(k in d for k in ("transcri", "speech to text", "dictat", "what is said")):
            add("whisperStt"); n_procs += 1
        if audio_in and any(k in d for k in ("detect", "alarm", "glass", "bark", "scream", "cry")):
            add("audioDetect"); n_procs += 1
        if not audio_in and any(k in d for k in ("detect", "object", "person", "people", "car", "dog", "cat", "intru", "motion", "anyone", "someone")):
            add("detection", {"confidence": 50}); n_procs += 1
        if any(k in d for k in ("describe", "caption", "analy", "scene", "watch for", "understand", "explain what")):
            add("visualLlm", {"prompt": description, "interval": 10}); n_procs += 1
        if any(k in d for k in ("summar", "rewrite", "translate")):
            add("llm", {"prompt": "Summarize: {input}"}); n_procs += 1
        if n_procs == 0:
            add("audioDetect" if audio_in else "detection", {} if audio_in else {"confidence": 50})

        # Logic node if there's something concrete to match on
        quoted = re.findall(r'"([^"]+)"|\'([^\']+)\'', description)
        terms = [a or b for a, b in quoted]
        if not terms:
            terms = [w for w in ("person", "people", "car", "dog", "cat", "fire", "smoke", "intruder", "package", "danger") if w in d]
        if terms:
            add("logic", {
                "conditions": [{"id": str(i + 1), "operator": "contains", "value": v} for i, v in enumerate(terms[:3])],
                "mode": "any",
            })

        # Action nodes
        n_acts = 0
        if any(k in d for k in ("email", "mail")):
            add("emailAction", {"subject": "Lumina Alert", "body": f"Triggered by pipeline: {description}"}); n_acts += 1
        if any(k in d for k in ("sms", "text me", "text message")):
            add("smsAction", {"message": "Lumina alert"}); n_acts += 1
        if "slack" in d:
            add("slackAction"); n_acts += 1
        if "discord" in d:
            add("discordAction"); n_acts += 1
        if "webhook" in d:
            add("webhookAction"); n_acts += 1
        if "sheet" in d:
            add("googleSheetsAction"); n_acts += 1
        if any(k in d for k in ("speak", "announce", "say ", "voice alert")):
            add("speakAction"); n_acts += 1
        if any(k in d for k in ("notif", "alert me", "popup")):
            add("notifyAction"); n_acts += 1
        if any(k in d for k in ("screenshot", "snapshot", "capture image")):
            add("screenshotAction"); n_acts += 1
        if any(k in d for k in ("alarm", "siren", "beep", "sound alert")):
            add("soundAction"); n_acts += 1
        if any(k in d for k in ("save to file", "record to", "write to file", "csv")):
            add("fileAction"); n_acts += 1
        if n_acts == 0:
            add("logAction")

        return {"nodes": nodes, "edges": self._rule_based_connect(nodes, set())}

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

        # Validate and clean nodes — normalise types so small-model variants
        # like "Camera", "email" or "object_detection" still resolve.
        clean_nodes = []
        for n in nodes:
            if not isinstance(n, dict):
                continue
            ntype = _normalize_node_type(str(n.get("type", "")))
            if ntype:
                clean_nodes.append({
                    "id": str(n.get("id", f"n{len(clean_nodes)+1}")),
                    "type": ntype,
                    "data": n.get("data", {}) if isinstance(n.get("data"), dict) else {},
                })

        if not clean_nodes:
            return {"nodes": [], "edges": [], "error": "No valid nodes generated"}

        # Snap edge handles to ones that actually exist on each node type —
        # local models get source/target right but rarely the handle ids.
        type_by_id = {n["id"]: n["type"] for n in clean_nodes}
        clean_edges = _fix_edges(edges if isinstance(edges, list) else [], type_by_id)

        # If the model produced nodes but no usable edges, wire them by rule.
        if not clean_edges and len(clean_nodes) > 1:
            clean_edges = self._rule_based_connect(clean_nodes, set())

        # Structural repair: ensure vision nodes actually receive camera frames.
        clean_edges = _repair_workflow(clean_nodes, clean_edges)

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

    def auto_connect(self, nodes: list, existing_edges: list, description: str = "") -> list:
        """Suggest connections between unconnected nodes using AI.

        description: optional natural-language intent from the user, e.g.
            'camera feeds face match, then object detection, then log results'
        """
        if not nodes:
            return []

        existing_pairs = {(e.get("source"), e.get("target")) for e in existing_edges}
        node_list = [{"id": n.get("id"), "type": n.get("type")} for n in nodes]

        intent = f"\nUser intent: {description}" if description.strip() else ""

        prompt = (
            f"You are a Lumina pipeline wiring assistant. "
            f"Suggest the correct edges to connect these nodes.{intent}\n\n"
            f"Nodes: {json.dumps(node_list)}\n\n"
            f"Already connected: {json.dumps(list(existing_pairs))}\n\n"
            f"{_HANDLE_RULES}\n\n"
            f"Output ONLY a JSON array of new edge objects:\n"
            f'[{{"source":"n1","sourceHandle":"camera","target":"n2","targetHandle":"camera"}}]\n\n'
            f"Do not repeat existing connections. Edges only:"
        )

        result = self.gen_txt(prompt, max_tk=1024, is_json=True)
        raw = result.get("text", "")
        ai_edges: list = []
        if raw:
            # Ollama format=json may wrap the array in an object: {"edges": [...]}
            candidate = _extract_json_arr(raw)
            try:
                if candidate:
                    ai_edges = json.loads(candidate)
                else:
                    obj = _extract_json_obj(raw)
                    if obj:
                        parsed = json.loads(obj)
                        for v in parsed.values():
                            if isinstance(v, list):
                                ai_edges = v
                                break
            except Exception:
                ai_edges = []

        # Snap handles to real ones and drop impossible/duplicate edges
        type_by_id = {n.get("id"): n.get("type") for n in nodes}
        valid = [
            e for e in _fix_edges(ai_edges, type_by_id)
            if (e["source"], e["target"]) not in existing_pairs
        ]
        if valid:
            return valid

        # AI gave nothing usable — wire by rule so the button always works
        log.info("auto_connect: AI output unusable, using rule-based wiring")
        return self._rule_based_connect(nodes, existing_pairs)

    def _rule_based_connect(self, nodes: list, existing: set) -> list:
        """Fallback rule-based auto-connect for common pipeline patterns.
        All handles come from _NODE_HANDLES so every edge is renderable."""
        edges = []
        by_type: dict[str, list] = {}
        for n in nodes:
            t = n.get("type", "")
            by_type.setdefault(t, []).append(n["id"])

        def ids(*types):
            return [i for t in types for i in by_type.get(t, [])]

        def add(s, s_type, t, t_type, th_override=None):
            if (s, t) in existing or s == t:
                return
            src_outs = _NODE_HANDLES.get(s_type, (["output"], []))[0]
            tgt_ins = _NODE_HANDLES.get(t_type, ([], ["input"]))[1]
            if not src_outs or not tgt_ins:
                return
            th = th_override if th_override in tgt_ins else (
                "camera" if s_type in _FRAME_PRODUCERS and "camera" in tgt_ins
                else "audio" if s_type in _AUDIO_PRODUCERS and "audio" in tgt_ins
                else "trigger" if "trigger" in tgt_ins and s_type not in _FRAME_PRODUCERS + _AUDIO_PRODUCERS
                else "input" if "input" in tgt_ins
                else tgt_ins[0]
            )
            edges.append({
                "source": s, "sourceHandle": src_outs[0],
                "target": t, "targetHandle": th,
                "id": f"auto-{s}-{t}",
            })
            existing.add((s, t))

        frame_consumers = ("detection", "visualLlm", "geminiLive", "ocr", "faceMatch", "pose")
        audio_consumers = ("audioDetect", "whisperStt", "audioLlm")

        # Inputs → processors
        for cam in ids(*_FRAME_PRODUCERS):
            cam_t = next(t for t in _FRAME_PRODUCERS if cam in by_type.get(t, []))
            for fc_t in frame_consumers:
                for fc in by_type.get(fc_t, []):
                    add(cam, cam_t, fc, fc_t, th_override="camera")
        for mic in ids(*_AUDIO_PRODUCERS):
            mic_t = next(t for t in _AUDIO_PRODUCERS if mic in by_type.get(t, []))
            for ac_t in audio_consumers + ("geminiLive",):
                for ac in by_type.get(ac_t, []):
                    add(mic, mic_t, ac, ac_t, th_override="audio")

        # Detection match → visualLlm trigger (detect-then-describe chains)
        for det in by_type.get("detection", []):
            for vlm in by_type.get("visualLlm", []):
                add(det, "detection", vlm, "visualLlm", th_override="trigger")

        # Text producers → llm / toolUse chains
        for src_t in ("visualLlm", "geminiLive", "whisperStt", "audioLlm"):
            for src in by_type.get(src_t, []):
                for dst_t in ("llm", "toolUse"):
                    for dst in by_type.get(dst_t, []):
                        add(src, src_t, dst, dst_t)

        # Processors → logic
        analyser_types = ("detection", "audioDetect", "visualLlm", "geminiLive",
                          "faceMatch", "pose", "ocr", "whisperStt", "audioLlm",
                          "llm", "toolUse", "script")
        has_logic = bool(by_type.get("logic"))
        for src_t in analyser_types:
            for src in by_type.get(src_t, []):
                for lg in by_type.get("logic", []):
                    add(src, src_t, lg, "logic")

        # Logic → actions; if no logic node, terminal processors fire actions directly
        action_types = [t for t, (outs, ins) in _NODE_HANDLES.items()
                        if not outs and ins]
        all_actions = [(a, a_t) for a_t in action_types for a in by_type.get(a_t, [])]
        if has_logic:
            for lg in by_type.get("logic", []):
                for act, act_t in all_actions:
                    add(lg, "logic", act, act_t)
        else:
            # Wire from the LAST analyser in the chain (one with no outgoing edge yet)
            sources_used = {e["source"] for e in edges}
            terminals = [
                (n["id"], n["type"]) for n in nodes
                if n.get("type") in analyser_types and n["id"] not in sources_used
            ] or [(n["id"], n["type"]) for n in nodes if n.get("type") in analyser_types]
            for term, term_t in terminals:
                for act, act_t in all_actions:
                    add(term, term_t, act, act_t)

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
