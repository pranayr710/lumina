"""Compile a Lumina ReactFlow graph → valid n8n workflow JSON."""

import json
import uuid


def _uid() -> str:
    return str(uuid.uuid4())


# ── Node mapping ──────────────────────────────────────────────────────────────

def _make_schedule(name: str, pos: list, data: dict, interval_s: int = 5) -> dict:
    fps = data.get("fps", 1)
    secs = max(1, round(1 / fps)) if fps > 0 else interval_s
    return {
        "id": _uid(), "name": name,
        "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2,
        "position": pos,
        "parameters": {"rule": {"interval": [{"field": "seconds", "secondsInterval": secs}]}},
    }


def _make_http(name: str, pos: list, url: str, body_params: list | None = None) -> dict:
    params = body_params or []
    return {
        "id": _uid(), "name": name,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": pos,
        "parameters": {
            "method": "POST", "url": url,
            "sendBody": True,
            "bodyParameters": {"parameters": params},
        },
    }


_LUMINA_BASE = "http://localhost:8000"

_NODE_BUILDERS: dict[str, callable] = {
    # Input nodes → schedule triggers
    "camera":    lambda n, p, d: _make_schedule(n, p, d),
    "video":     lambda n, p, d: _make_schedule(n, p, d, 5),
    "mic":       lambda n, p, d: _make_schedule(n, p, d, 1),
    "audioFile": lambda n, p, d: _make_schedule(n, p, d, 1),
    "ipCamera":  lambda n, p, d: _make_schedule(n, p, d, 5),
    "timer":     lambda n, p, d: _make_schedule(n, p, d, d.get("interval", 60)),

    # AI analysis nodes → HTTP requests to Lumina
    "visualLlm": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/vlm",
        [{"name": "prompt", "value": d.get("prompt", "Describe what you see")}]),
    "geminiLive": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/gemini-live",
        [{"name": "prompt", "value": d.get("system_prompt", "Analyze the scene")}]),
    "llm":       lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/llm",
        [{"name": "prompt", "value": d.get("prompt", "")},
         {"name": "system", "value": d.get("system_prompt", "")}]),
    "detection": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/detect",
        [{"name": "confidence", "value": str(d.get("confidence", 50))}]),
    "pose":      lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/pose", []),
    "faceMatch": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/face-match", []),
    "ocr":       lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/ocr", []),
    "audioDetect": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/audio-detect",
        [{"name": "confidence", "value": str(d.get("confidence", 20))}]),
    "audioLlm":  lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/audio-llm",
        [{"name": "prompt", "value": d.get("prompt", "Analyze this audio")}]),
    "whisperStt": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/whisper", []),
    "toolUse":   lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/tool-use",
        [{"name": "tool_name", "value": d.get("tool_name", "")},
         {"name": "input_text", "value": "={{ $json.output }}"}]),

    # Logic node → IF
    "logic": lambda n, p, d: _make_if(n, p, d),

    # Processing nodes
    "debounce": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.wait", "typeVersion": 1.1,
        "position": p,
        "parameters": {"resume": "timeInterval", "unit": "seconds",
                       "amount": d.get("interval", 5)},
    },
    "merge": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.merge", "typeVersion": 3,
        "position": p,
        "parameters": {"mode": "combine"},
    },
    "script": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": p,
        "parameters": {"jsCode": f"// Converted from Python:\n// {d.get('script', '# no script')}\nreturn [{{'json': $input.all()[0].json}}];"},
    },

    # Action nodes
    "webhookAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": p,
        "parameters": {
            "method": d.get("method", "POST"),
            "url": d.get("url", ""),
            "sendBody": True,
            "bodyParameters": {"parameters": [{"name": "data", "value": "={{ $json.output }}"}]},
        },
    },
    "emailAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1,
        "position": p,
        "parameters": {
            "toEmail": d.get("to", ""),
            "subject": d.get("subject", "Lumina Alert"),
            "text": d.get("body", ""),
        },
        "credentials": {"smtp": {"id": "PLACEHOLDER", "name": "Lumina SMTP"}},
    },
    "smsAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.twilio", "typeVersion": 1,
        "position": p,
        "parameters": {
            "to": d.get("to", ""),
            "body": d.get("body", "Lumina Alert"),
        },
        "credentials": {"twilioApi": {"id": "PLACEHOLDER", "name": "Lumina Twilio"}},
    },
    "slackAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.slack", "typeVersion": 2.2,
        "position": p,
        "parameters": {
            "operation": "message",
            "channel": d.get("channel", "#alerts"),
            "text": d.get("message", "Lumina Alert"),
        },
        "credentials": {"slackApi": {"id": "PLACEHOLDER", "name": "Lumina Slack"}},
    },
    "discordAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.discord", "typeVersion": 2,
        "position": p,
        "parameters": {
            "webhookUri": d.get("webhook_url", ""),
            "text": d.get("message", "Lumina Alert"),
        },
    },
    "googleSheetsAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5,
        "position": p,
        "parameters": {
            "operation": "append",
            "documentId": {"value": d.get("sheet_id", "")},
            "sheetName": {"value": d.get("sheet_name", "Sheet1")},
            "columns": {"mappingMode": "autoMapInputData"},
        },
        "credentials": {"googleSheetsOAuth2Api": {"id": "PLACEHOLDER", "name": "Lumina Google"}},
    },
    "mqttAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.mqtt", "typeVersion": 1,
        "position": p,
        "parameters": {
            "topic": d.get("topic", "lumina/alert"),
            "payload": d.get("payload", "={{ $json.output }}"),
        },
    },
    "logAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.set", "typeVersion": 3.4,
        "position": p,
        "parameters": {
            "mode": "manual",
            "assignments": {"assignments": [
                {"id": _uid(), "name": "log_output", "value": "={{ $json.output }}", "type": "string"}
            ]},
        },
    },
    "fileAction": lambda n, p, d: {
        "id": _uid(), "name": n,
        "type": "n8n-nodes-base.writeFile", "typeVersion": 1,
        "position": p,
        "parameters": {
            "fileName": d.get("filename", "lumina_output.txt"),
            "dataPropertyName": "data",
        },
    },
    "notifyAction": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/notify",
        [{"name": "message", "value": "={{ $json.output }}"}]),
    "screenshotAction": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/screenshot", []),
    "soundAction": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/sound",
        [{"name": "sound", "value": d.get("sound", "alert")}]),
    "speakAction": lambda n, p, d: _make_http(n, p, f"{_LUMINA_BASE}/api/speak",
        [{"name": "text", "value": "={{ $json.output }}"}]),
}


def _make_if(name: str, pos: list, data: dict) -> dict:
    conditions = data.get("conditions", [{"id": "1", "operator": "contains", "value": ""}])
    combinator = "and" if data.get("mode", "any") == "all" else "or"

    _op_map = {
        "contains":    ("string", "contains"),
        "equals":      ("string", "equals"),
        "starts_with": ("string", "startsWith"),
        "ends_with":   ("string", "endsWith"),
        "regex":       ("string", "regex"),
        "greater":     ("number", "gt"),
        "less":        ("number", "lt"),
    }

    n8n_conds = []
    for c in conditions:
        op_type, op_op = _op_map.get(c.get("operator", "contains"), ("string", "contains"))
        n8n_conds.append({
            "id": _uid(),
            "leftValue": "={{ $json.output }}",
            "rightValue": c.get("value", ""),
            "operator": {"type": op_type, "operation": op_op},
        })

    return {
        "id": _uid(), "name": name,
        "type": "n8n-nodes-base.if", "typeVersion": 2,
        "position": pos,
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": False},
                "conditions": n8n_conds,
                "combinator": combinator,
            }
        },
    }


# ── Name generation ───────────────────────────────────────────────────────────

_DISPLAY_NAMES = {
    "camera": "Camera", "video": "Video", "mic": "Microphone",
    "audioFile": "Audio File", "ipCamera": "IP Camera", "timer": "Timer",
    "detection": "Object Detect", "pose": "Pose Detect",
    "visualLlm": "Visual LLM", "geminiLive": "Gemini Live",
    "llm": "LLM", "audioDetect": "Audio Detect", "audioLlm": "Audio LLM",
    "whisperStt": "Whisper STT", "ocr": "OCR", "faceMatch": "Face Match",
    "logic": "IF", "debounce": "Wait", "merge": "Merge", "script": "Code",
    "webhookAction": "Webhook", "emailAction": "Email", "smsAction": "SMS",
    "slackAction": "Slack", "discordAction": "Discord",
    "googleSheetsAction": "Google Sheets", "mqttAction": "MQTT",
    "logAction": "Set Variable", "fileAction": "Write File",
    "notifyAction": "Notify", "screenshotAction": "Screenshot",
    "soundAction": "Sound Alert", "speakAction": "Speak", "toolUse": "Tool Use",
}


def _unique_name(type_key: str, counters: dict) -> str:
    base = _DISPLAY_NAMES.get(type_key, type_key)
    counters[base] = counters.get(base, 0) + 1
    n = counters[base]
    return base if n == 1 else f"{base} {n}"


# ── Connection builder ────────────────────────────────────────────────────────

def _build_connections(edges: list, id_to_name: dict) -> dict:
    """Build n8n connections dict keyed by source node name."""
    connections: dict = {}
    for e in edges:
        src_name = id_to_name.get(e.get("source"))
        tgt_name = id_to_name.get(e.get("target"))
        if not src_name or not tgt_name:
            continue

        # Logic node: sourceHandle "noMatch" → output index 1
        src_handle = e.get("sourceHandle", "")
        output_idx = 1 if src_handle == "noMatch" else 0

        if src_name not in connections:
            connections[src_name] = {"main": [[]]}

        main = connections[src_name]["main"]
        # Extend to required length
        while len(main) <= output_idx:
            main.append([])
        main[output_idx].append({"node": tgt_name, "type": "main", "index": 0})

    return connections


# ── Main compiler ─────────────────────────────────────────────────────────────

def compile_to_n8n(graph: dict) -> dict:
    """Compile a Lumina ReactFlow graph to a valid n8n workflow JSON.

    Args:
        graph: {"nodes": [...], "edges": [...]}

    Returns:
        n8n workflow dict ready for JSON serialization.
    """
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    counters: dict[str, int] = {}
    id_to_name: dict[str, str] = {}
    n8n_nodes: list[dict] = []

    for node in nodes:
        nid = node.get("id", _uid())
        ntype = node.get("type", "")
        data = node.get("data", {})
        rf_pos = node.get("position", {"x": 0, "y": 0})

        # Scale position: n8n canvas uses larger coordinates
        pos = [round(rf_pos.get("x", 0) * 1.5), round(rf_pos.get("y", 0) * 1.5)]

        name = _unique_name(ntype, counters)
        id_to_name[nid] = name

        builder = _NODE_BUILDERS.get(ntype)
        if builder:
            n8n_node = builder(name, pos, data)
        else:
            # Unknown node type → NoOp placeholder
            n8n_node = {
                "id": _uid(), "name": name,
                "type": "n8n-nodes-base.noOp", "typeVersion": 1,
                "position": pos,
                "parameters": {"note": f"Unmapped Lumina node type: {ntype}"},
            }

        n8n_nodes.append(n8n_node)

    connections = _build_connections(edges, id_to_name)

    return {
        "name": "Lumina Export",
        "nodes": n8n_nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "meta": {"instanceId": "lumina-export"},
    }
