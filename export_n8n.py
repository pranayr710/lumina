"""Compile a Lumina ReactFlow graph → valid n8n workflow JSON.

Architecture (confirmed from real n8n workflow analysis):

  Camera / audio input nodes expand to TWO n8n nodes:
      [Schedule Trigger] → [HTTP Capture]  → downstream AI nodes...

  Schedule Trigger:  wakes the workflow on an interval.
                     Its $json output is nearly empty — only timestamps.
  HTTP Capture:      calls Lumina's /api/capture and returns {"image": "...", "output": "..."}.
                     Downstream nodes access $json.image or $json.output directly.

  Timer nodes:       single Schedule Trigger only (no capture needed).
  AI analysis nodes: HTTP Request → Lumina REST API, body sent as application/json.
  Logic nodes:       n8n IF, typeVersion 2.2 (required for correct operator schema).
  Action nodes:      native n8n nodes; credentials need manual setup in n8n Credential Manager.

n8n JSON rules confirmed from live exports:
  - connections keyed by SOURCE NODE NAME (not id)
  - IF true branch = main[0], false/no-match branch = main[1]
  - HTTP body sent as JSON requires specifyBody="json" + jsonBody expression
  - IF typeVersion 2.2 requires options.version = 2 inside conditions block
  - Operator objects require "name" field (e.g. "filter.operator.contains")
"""

import json
import os
import uuid


# ── Helpers ───────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


def _get_base() -> str:
    val = os.getenv("LUMINA_BASE_URL", "http://localhost:8000")
    # Strip accidental "KEY=value" format (e.g. env var set wrong)
    if not val.startswith("http") and "=" in val:
        val = val.split("=", 1)[1]
    return val.rstrip("/")


# Canvas spacing constants
_TRIGGER_OFFSET = -280   # schedule trigger sits this far LEFT of its capture node
_Y_DEFAULT = 240


# ── Core node builders ────────────────────────────────────────────────────────

def _make_schedule(name: str, pos: list, interval_s: int = 5) -> dict:
    """n8n Schedule Trigger (typeVersion 1.2 — supports seconds granularity)."""
    return {
        "id": _uid(),
        "name": name,
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.2,
        "position": pos,
        "parameters": {
            "rule": {
                "interval": [
                    {"field": "seconds", "secondsInterval": max(1, int(interval_s))}
                ]
            }
        },
    }


def _body_expr(params: list) -> str:
    """Build a JSON.stringify() n8n expression from a list of {name, value} dicts.

    Values that start with ={{ are treated as JS expressions (e.g. $json.image).
    Static strings are JSON-escaped and quoted.

    Result example:
        ={{ JSON.stringify({"image": $json.image || '', "confidence": "50"}) }}
    """
    if not params:
        return "={{}}"
    parts = []
    for p in params:
        k = p["name"]
        v = p["value"]
        if v.startswith("={{") and v.endswith("}}"):
            # Strip ={{ ... }} wrapper — raw JS expression
            inner = v[3:-2].strip()
            parts.append(f'"{k}": {inner}')
        else:
            # Static value — JSON-encode it
            escaped = v.replace("\\", "\\\\").replace('"', '\\"')
            parts.append(f'"{k}": "{escaped}"')
    body_js = "{" + ", ".join(parts) + "}"
    return "={{ JSON.stringify(" + body_js + ") }}"


def _make_http(name: str, pos: list, url: str, params: list | None = None) -> dict:
    """HTTP Request node (POST, application/json body).

    Uses specifyBody='json' + jsonBody expression to guarantee Content-Type: application/json,
    which is what FastAPI's `p: dict` body parser expects.
    """
    return {
        "id": _uid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": pos,
        "parameters": {
            "method": "POST",
            "url": url,
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": _body_expr(params or []),
            "options": {},
        },
    }


def _make_if(name: str, pos: list, data: dict) -> dict:
    """n8n IF node, typeVersion 2.2.

    typeVersion 2.2 requires:
      - options.version = 2 inside the conditions block
      - operator objects include "name" field (filter.operator.*)
    True  → output index 0  (match / yes branch)
    False → output index 1  (no_match / no branch)
    """
    raw_conds = data.get("conditions", [{"id": "1", "operator": "contains", "value": ""}])
    combinator = "and" if data.get("mode", "any") == "all" else "or"

    _op_map = {
        "contains":    ("string", "contains",   "filter.operator.contains"),
        "equals":      ("string", "equals",     "filter.operator.equals"),
        "starts_with": ("string", "startsWith", "filter.operator.startsWith"),
        "ends_with":   ("string", "endsWith",   "filter.operator.endsWith"),
        "regex":       ("string", "regex",      "filter.operator.regex"),
        "greater":     ("number", "gt",         "filter.operator.gt"),
        "less":        ("number", "lt",         "filter.operator.lt"),
    }

    n8n_conds = []
    for c in raw_conds:
        op_type, op_op, op_name = _op_map.get(
            c.get("operator", "contains"),
            ("string", "contains", "filter.operator.contains"),
        )
        n8n_conds.append({
            "id": _uid(),
            "leftValue": "={{ $json.output || '' }}",
            "rightValue": c.get("value", ""),
            "operator": {"type": op_type, "operation": op_op, "name": op_name},
        })

    return {
        "id": _uid(),
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": pos,
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": False,
                    "leftValue": "",
                    "typeValidation": "loose",
                    "version": 2,         # required for typeVersion 2.x
                },
                "conditions": n8n_conds,
                "combinator": combinator,
            },
            "options": {},
        },
    }


# ── Input node pair builders ──────────────────────────────────────────────────
# Camera/audio input nodes in Lumina → TWO n8n nodes:
#   1. Schedule Trigger (named "<Name> Trigger") — fires on interval
#   2. HTTP Request     (named "<Name>")         — calls /api/capture
# The trigger sits to the LEFT of the capture node on the canvas.
# Downstream edges from Lumina connect to the Capture node name.

def _make_input_pair(
    name: str,
    pos: list,
    interval_s: int,
    capture_params: list,
) -> tuple[dict, dict]:
    """Return (trigger_node, capture_node). Trigger connects → Capture internally."""
    trigger_name = f"{name} Trigger"
    trigger_pos = [pos[0] + _TRIGGER_OFFSET, pos[1]]
    trigger = _make_schedule(trigger_name, trigger_pos, interval_s)
    base = _get_base()
    capture = _make_http(name, pos, f"{base}/api/capture", capture_params)
    return trigger, capture


_PAIR_TYPES = {"camera", "video", "ipCamera", "mic", "audioFile"}


def _build_input_pair(ntype: str, name: str, pos: list, data: dict):
    """Dispatch to correct pair builder for each input node type."""
    fps = data.get("fps", 1)
    # Minimum 10s between triggers — VLM/detect need time to process.
    # A 1 fps setting would flood the backend within seconds.
    interval_s = max(10, round(1 / fps)) if fps > 0 else 10

    if ntype == "camera":
        return _make_input_pair(name, pos, interval_s, [
            {"name": "source", "value": "camera"},
            {"name": "fps",    "value": str(fps)},
        ])
    if ntype == "video":
        return _make_input_pair(name, pos, 5, [
            {"name": "source", "value": "video"},
            {"name": "path",   "value": data.get("path", "")},
        ])
    if ntype == "ipCamera":
        return _make_input_pair(name, pos, 5, [
            {"name": "source", "value": "ip_camera"},
            {"name": "url",    "value": data.get("url", "")},
        ])
    if ntype == "mic":
        return _make_input_pair(name, pos, 2, [
            {"name": "source",   "value": "mic"},
            {"name": "duration", "value": str(data.get("duration", 2))},
        ])
    if ntype == "audioFile":
        return _make_input_pair(name, pos, 5, [
            {"name": "source", "value": "audio_file"},
            {"name": "path",   "value": data.get("path", "")},
        ])
    raise ValueError(f"Unknown pair type: {ntype}")


# ── Single-node builders ──────────────────────────────────────────────────────

def _get_single_builders(base: str) -> dict:
    img  = "={{ $json.image || $json.output || '' }}"
    aud  = "={{ $json.audio || $json.output || '' }}"
    out  = "={{ $json.output || $json.text  || '' }}"

    return {
        # Timer → Schedule Trigger only
        "timer": lambda n, p, d: _make_schedule(n, p, d.get("interval", 60)),

        # ── AI analysis nodes ──
        "visualLlm": lambda n, p, d: _make_http(n, p, f"{base}/api/vlm", [
            {"name": "prompt", "value": d.get("prompt", "Describe what you see")},
            {"name": "image",  "value": img},
        ]),
        "geminiLive": lambda n, p, d: _make_http(n, p, f"{base}/api/gemini-live", [
            {"name": "prompt", "value": d.get("system_prompt", "Analyze the scene")},
            {"name": "image",  "value": img},
        ]),
        "llm": lambda n, p, d: _make_http(n, p, f"{base}/api/llm", [
            {"name": "prompt",      "value": d.get("prompt", "")},
            {"name": "system",      "value": d.get("system_prompt", "")},
            {"name": "input_text",  "value": out},
        ]),
        "detection": lambda n, p, d: _make_http(n, p, f"{base}/api/detect", [
            {"name": "confidence", "value": str(d.get("confidence", 50))},
            {"name": "image",      "value": img},
        ]),
        "pose": lambda n, p, d: _make_http(n, p, f"{base}/api/pose", [
            {"name": "image", "value": img},
        ]),
        "faceMatch": lambda n, p, d: _make_http(n, p, f"{base}/api/face-match", [
            {"name": "image", "value": img},
        ]),
        "ocr": lambda n, p, d: _make_http(n, p, f"{base}/api/ocr", [
            {"name": "image", "value": img},
        ]),
        "audioDetect": lambda n, p, d: _make_http(n, p, f"{base}/api/audio-detect", [
            {"name": "confidence", "value": str(d.get("confidence", 20))},
            {"name": "audio",      "value": aud},
        ]),
        "audioLlm": lambda n, p, d: _make_http(n, p, f"{base}/api/audio-llm", [
            {"name": "prompt",  "value": d.get("prompt", "Analyze this audio")},
            {"name": "context", "value": "={{ $json.output || $json.transcript || '' }}"},
        ]),
        "whisperStt": lambda n, p, d: _make_http(n, p, f"{base}/api/whisper", [
            {"name": "audio", "value": aud},
        ]),
        "toolUse": lambda n, p, d: _make_http(n, p, f"{base}/api/tool-use", [
            {"name": "tool_name",  "value": d.get("tool_name", "")},
            {"name": "input_text", "value": out},
        ]),

        # ── Logic ──
        "logic": lambda n, p, d: _make_if(n, p, d),

        # ── Processing ──
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
            "parameters": {
                "jsCode": (
                    "// Auto-converted from Lumina script node\n"
                    f"// Original: {d.get('script', '# no script')}\n"
                    "return [{ json: $input.all()[0].json }];"
                ),
            },
        },

        # ── Action nodes ──
        "webhookAction": lambda n, p, d: _make_http(n, p, d.get("url", ""), [
            {"name": "data", "value": "={{ $json.output || '' }}"},
        ]),
        "emailAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1,
            "position": p,
            "parameters": {
                "toEmail": d.get("to", ""),
                "subject": d.get("subject", "Lumina Alert"),
                "text": d.get("body", "") or "={{ $json.output || '' }}",
            },
            # ⚠ Credentials must be created manually in n8n → Credentials → SMTP
            "credentials": {"smtp": {"id": "1", "name": "Lumina SMTP"}},
        },
        "smsAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.twilio", "typeVersion": 1,
            "position": p,
            "parameters": {
                "to":   d.get("to", ""),
                "body": d.get("body", "") or "={{ $json.output || 'Lumina Alert' }}",
            },
            # ⚠ Credentials must be created manually in n8n → Credentials → Twilio
            "credentials": {"twilioApi": {"id": "1", "name": "Lumina Twilio"}},
        },
        "slackAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.slack", "typeVersion": 2.2,
            "position": p,
            "parameters": {
                "operation": "message",
                "channel": d.get("channel", "#alerts"),
                "text": d.get("message", "") or "={{ $json.output || 'Lumina Alert' }}",
            },
            # ⚠ Credentials must be created manually in n8n → Credentials → Slack
            "credentials": {"slackApi": {"id": "1", "name": "Lumina Slack"}},
        },
        "discordAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.discord", "typeVersion": 2,
            "position": p,
            "parameters": {
                "webhookUri": d.get("webhook_url", ""),
                "text": d.get("message", "") or "={{ $json.output || 'Lumina Alert' }}",
            },
        },
        "googleSheetsAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5,
            "position": p,
            "parameters": {
                "operation": "append",
                "documentId": {"value": d.get("sheet_id", "")},
                "sheetName":  {"value": d.get("sheet_name", "Sheet1")},
                "columns":    {"mappingMode": "autoMapInputData"},
            },
            # ⚠ Credentials must be created manually in n8n → Credentials → Google OAuth2
            "credentials": {"googleSheetsOAuth2Api": {"id": "1", "name": "Lumina Google"}},
        },
        "mqttAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.mqtt", "typeVersion": 1,
            "position": p,
            "parameters": {
                "topic":   d.get("topic", "lumina/alert"),
                "payload": d.get("payload", "") or "={{ $json.output || '' }}",
            },
        },
        "logAction": lambda n, p, d: {
            "id": _uid(), "name": n,
            "type": "n8n-nodes-base.set", "typeVersion": 3.4,
            "position": p,
            "parameters": {
                "mode": "manual",
                "assignments": {"assignments": [
                    {"id": _uid(), "name": "log_output",
                     "value": "={{ $json.output || $json }}", "type": "string"},
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
        "notifyAction": lambda n, p, d: _make_http(n, p, f"{base}/api/notify", [
            {"name": "message", "value": "={{ $json.output || '' }}"},
        ]),
        "screenshotAction": lambda n, p, d: _make_http(n, p, f"{base}/api/screenshot", []),
        "soundAction": lambda n, p, d: _make_http(n, p, f"{base}/api/sound", [
            {"name": "sound", "value": d.get("sound", "alert")},
        ]),
        "speakAction": lambda n, p, d: _make_http(n, p, f"{base}/api/speak", [
            {"name": "text", "value": "={{ $json.output || '' }}"},
        ]),
    }


# ── Display names ─────────────────────────────────────────────────────────────

_DISPLAY_NAMES: dict[str, str] = {
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
    """Build n8n connections dict keyed by source node name.

    IF (logic) node: sourceHandle 'no_match' → output index 1 (false branch).
    All others use output index 0 (true/main branch).
    """
    connections: dict = {}

    for e in edges:
        src_name = id_to_name.get(e.get("source"))
        tgt_name = id_to_name.get(e.get("target"))
        if not src_name or not tgt_name:
            continue

        src_handle = e.get("sourceHandle", "")
        output_idx = 1 if src_handle == "no_match" else 0

        if src_name not in connections:
            connections[src_name] = {"main": [[]]}

        main = connections[src_name]["main"]
        while len(main) <= output_idx:
            main.append([])
        main[output_idx].append({"node": tgt_name, "type": "main", "index": 0})

    return connections


def _add_connection(connections: dict, src_name: str, tgt_name: str, output_idx: int = 0):
    """Utility: add a single directed connection."""
    if src_name not in connections:
        connections[src_name] = {"main": [[]]}
    main = connections[src_name]["main"]
    while len(main) <= output_idx:
        main.append([])
    if not any(c["node"] == tgt_name for c in main[output_idx]):
        main[output_idx].append({"node": tgt_name, "type": "main", "index": 0})


# ── Main compiler ─────────────────────────────────────────────────────────────

def compile_to_n8n(graph: dict) -> dict:
    """Compile a Lumina ReactFlow graph to a valid n8n workflow JSON.

    Args:
        graph: {"nodes": [...], "edges": [...]}

    Returns:
        n8n workflow dict ready for JSON serialization and import.
    """
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    base = _get_base()
    single_builders = _get_single_builders(base)

    counters: dict[str, int] = {}
    # Maps Lumina node ID → the n8n node name that downstream edges should connect TO.
    # For pair nodes this is the Capture node name (not the Trigger).
    id_to_name: dict[str, str] = {}
    n8n_nodes: list[dict] = []
    # (trigger_name, capture_name) internal connections to add after edge processing
    pair_internals: list[tuple[str, str]] = []

    for node in nodes:
        nid   = node.get("id", _uid())
        ntype = node.get("type", "")
        data  = node.get("data", {})
        rf    = node.get("position", {"x": 0, "y": 0})

        # Scale ReactFlow coords → n8n canvas coords (n8n uses larger spacing)
        pos = [round(rf.get("x", 0) * 1.5), round(rf.get("y", 0) * 1.5)]

        name = _unique_name(ntype, counters)
        # Downstream connections always use the "main" node name
        id_to_name[nid] = name

        if ntype in _PAIR_TYPES:
            # Expand to trigger + capture pair
            trigger_node, capture_node = _build_input_pair(ntype, name, pos, data)
            n8n_nodes.append(trigger_node)
            n8n_nodes.append(capture_node)
            pair_internals.append((trigger_node["name"], capture_node["name"]))

        elif ntype == "timer":
            # Timer is just a Schedule Trigger — no capture node needed
            interval_s = data.get("interval", 60)
            n8n_node = _make_schedule(name, pos, interval_s)
            n8n_nodes.append(n8n_node)

        else:
            builder = single_builders.get(ntype)
            if builder:
                n8n_node = builder(name, pos, data)
            else:
                # Unmapped node type → NoOp placeholder
                n8n_node = {
                    "id": _uid(), "name": name,
                    "type": "n8n-nodes-base.noOp", "typeVersion": 1,
                    "position": pos,
                    "parameters": {},
                }
            n8n_nodes.append(n8n_node)

    # Build connections from Lumina edges
    connections = _build_connections(edges, id_to_name)

    # Wire trigger → capture for every pair
    for trigger_name, capture_name in pair_internals:
        _add_connection(connections, trigger_name, capture_name)

    return {
        "name": "Lumina Export",
        "nodes": n8n_nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "meta": {"instanceId": "lumina-export"},
    }
