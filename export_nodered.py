"""Compile a Lumina ReactFlow graph → valid Node-RED flow JSON array.

Architecture overview
=====================
Node-RED flow format is a flat JSON ARRAY where the first element is always a
tab node (the "flow" container).  Every subsequent node references the tab via
its ``z`` field.  Data flows through ``msg.payload``; wires are stored on the
SOURCE node as ``wires: [[target_id, ...], ...]``.

Lumina → Node-RED mapping summary
----------------------------------
INPUT nodes (camera / video / ipCamera / mic / audioFile):
    expand to TWO nodes:
        1. inject  (type "inject")  — triggers on interval, sets msg.payload
        2. http request (type "http request") — POST /api/capture

timer node:
    single inject only (no capture)

AI nodes (detection, faceMatch, pose, ocr, whisperStt, audioDetect):
    single http request → Lumina REST API

AI nodes with prompt / extra params (visualLlm, geminiLive, llm, audioLlm, toolUse):
    function node (merges params into msg.payload) + http request

logic node:
    switch node — property "payload.output", rules from conditions, always
    appends an "else" catch-all rule.  Match branch = output 0, else = output 1.

debounce:  delay node (pauseType "delay")
merge:     join node  (mode "auto")
script:    function node

ACTION nodes:
    logAction        → debug node
    emailAction      → e-mail node  (needs node-red-node-email)
    slackAction / discordAction / webhookAction → http request to target URL
    mqttAction       → function (set topic) + mqtt out + mqtt-broker config
    fileAction       → file write node
    notifyAction / screenshotAction / soundAction / speakAction / smsAction /
    googleSheetsAction → http request to Lumina /api/... endpoint

Connection strategy
-------------------
Edges carry source/target Lumina IDs and an optional sourceHandle.

We maintain two maps per Lumina node ID:
    incoming_map[lumina_id]  = NR node ID that RECEIVES edges from upstream
    outgoing_map[lumina_id]  = NR node ID that SENDS edges downstream

For single-node expansions both maps point to the same NR node.
For inject+capture pairs:
    incoming — not used (input nodes are always sources, never targets in a
    well-formed Lumina graph; if an edge somehow targets them we connect to
    the inject node so the pipeline re-triggers).
    outgoing = capture node ID
For function+http pairs:
    incoming = function node ID
    outgoing = http request node ID

After all NR nodes are built, wires are woven in a second pass over the edges.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _short_id() -> str:
    """Return a short unique ID suitable for Node-RED (8 hex chars)."""
    return uuid.uuid4().hex[:8]


def _get_base() -> str:
    """Return the Lumina base URL, stripping any accidental KEY= prefix."""
    val = os.getenv("LUMINA_BASE_URL", "http://localhost:8000")
    if not val.startswith("http") and "=" in val:
        val = val.split("=", 1)[1]
    return val.rstrip("/")


# Canvas scaling: ReactFlow positions → Node-RED canvas positions
_SCALE = 1.5
# Horizontal offset for the "left" node in a pair (inject or function)
_PAIR_LEFT_OFFSET_INJECT   = -240   # inject trigger sits this far left of capture
_PAIR_LEFT_OFFSET_FUNCTION = -120   # function node sits this far left of http node


# ---------------------------------------------------------------------------
# Node-RED node factories
# ---------------------------------------------------------------------------

def _base_node(nr_id: str, ntype: str, tab_id: str, name: str, x: int, y: int) -> dict:
    """Scaffold a minimal Node-RED node dict."""
    return {
        "id":    nr_id,
        "type":  ntype,
        "z":     tab_id,
        "name":  name,
        "x":     x,
        "y":     y,
        "wires": [[]],
    }


# ── Inject ──────────────────────────────────────────────────────────────────

def _make_inject(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    payload: dict,
    repeat: str | int,
) -> dict:
    """Build an inject node.

    Args:
        payload:  Python dict to serialise as the inject payload.
        repeat:   Repeat interval in seconds (string or int).  "" = once.
    """
    node = _base_node(nr_id, "inject", tab_id, name, x, y)
    node.update({
        "props": [{"p": "payload"}, {"p": "topic", "vt": "str"}],
        "repeat": str(repeat),
        "crontab": "",
        "once": False,
        "onceDelay": 0.1,
        "topic": "",
        "payload":     json.dumps(payload),
        "payloadType": "json",
    })
    return node


# ── HTTP Request ─────────────────────────────────────────────────────────────

def _make_http_request(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    url: str,
) -> dict:
    """Build an http request node (POST, sends msg.payload as JSON body).

    Node-RED "http request" node (note the space in the type string).
    ret="obj" → response parsed as JSON object, placed back into msg.payload.
    """
    node = _base_node(nr_id, "http request", tab_id, name, x, y)
    node.update({
        "method": "POST",
        "ret":    "obj",
        "paytoqs": "ignore",
        "url":    url,
        "tls":    "",
        "persist": False,
        "proxy":  "",
        "insecureHTTPParser": False,
        "authType": "",
        "senderr": False,
        "headers": [],
    })
    return node


# ── Function ─────────────────────────────────────────────────────────────────

def _make_function(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    func_code: str,
    outputs: int = 1,
) -> dict:
    """Build a function node with the given JS body."""
    node = _base_node(nr_id, "function", tab_id, name, x, y)
    node["wires"] = [[] for _ in range(outputs)]
    node.update({
        "func":      func_code,
        "outputs":   outputs,
        "noerr":     0,
        "initialize": "",
        "finalize":  "",
        "libs":      [],
    })
    return node


# ── Switch ───────────────────────────────────────────────────────────────────

_SWITCH_OP_MAP: dict[str, dict] = {
    # Lumina operator  → Node-RED rule fragment
    "contains":    {"t": "cont",  "vt": "str"},
    "equals":      {"t": "eq",    "vt": "str"},
    "starts_with": {"t": "regex", "vt": "re"},   # use ^val regex
    "ends_with":   {"t": "regex", "vt": "re"},   # use val$ regex
    "regex":       {"t": "regex", "vt": "re"},
    "greater":     {"t": "gt",    "vt": "num"},
    "less":        {"t": "lt",    "vt": "num"},
}


def _build_switch_rule(condition: dict) -> dict:
    """Convert a single Lumina condition dict into a Node-RED switch rule."""
    op_key = condition.get("operator", "contains")
    raw_val = str(condition.get("value", ""))
    rule_base = _SWITCH_OP_MAP.get(op_key, {"t": "cont", "vt": "str"}).copy()

    if op_key == "starts_with":
        rule_base["v"] = f"^{raw_val}"
    elif op_key == "ends_with":
        rule_base["v"] = f"{raw_val}$"
    else:
        rule_base["v"] = raw_val

    return rule_base


def _make_switch(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    data: dict,
) -> dict:
    """Build a switch node from a Lumina logic node's data dict.

    Output ports:
        0 … N-2  → one port per matching rule (in condition order)
        N-1      → else (no-match) port
    """
    conditions = data.get("conditions", [])
    mode = data.get("mode", "any")    # "any" or "all"
    checkall = "true" if mode == "all" else "false"

    rules: list[dict] = []
    for cond in conditions:
        rules.append(_build_switch_rule(cond))

    # Always add an else rule as the final output
    rules.append({"t": "else"})

    num_outputs = len(rules)    # includes the else port
    node = _base_node(nr_id, "switch", tab_id, name, x, y)
    node["wires"] = [[] for _ in range(num_outputs)]
    node.update({
        "property":     "payload.output",
        "propertyType": "msg",
        "rules":        rules,
        "checkall":     checkall,
        "repair":       False,
        "outputs":      num_outputs,
    })
    return node


# ── Delay ────────────────────────────────────────────────────────────────────

def _make_delay(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    seconds: int,
) -> dict:
    node = _base_node(nr_id, "delay", tab_id, name, x, y)
    node.update({
        "pauseType":   "delay",
        "timeout":     str(seconds),
        "timeoutUnits":"seconds",
        "rate":        1,
        "nbRateUnits": 1,
        "rateUnits":   "second",
        "randomFirst": "1",
        "randomLast":  "5",
        "randomUnits": "seconds",
        "drop":        False,
        "allowrate":   False,
        "outputs":     1,
    })
    return node


# ── Rate limiter ─────────────────────────────────────────────────────────────

def _make_rate_limit(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    rate: int = 1,
    per_seconds: int = 10,
) -> dict:
    """Delay node in rate-limiter mode — drops excess messages to prevent backlog.

    Allows at most `rate` message(s) per `per_seconds` seconds.
    Messages arriving faster than the rate are DROPPED (not queued),
    preventing the backend from being overwhelmed.
    """
    node = _base_node(nr_id, "delay", tab_id, name, x, y)
    node.update({
        "pauseType":   "rate",
        "timeout":     "5",
        "timeoutUnits":"seconds",
        "rate":        str(rate),
        "nbRateUnits": str(per_seconds),
        "rateUnits":   "second",
        "randomFirst": "1",
        "randomLast":  "5",
        "randomUnits": "seconds",
        "drop":        True,     # DROP excess — never queue
        "allowrate":   False,
        "outputs":     1,
    })
    return node


# ── Join ─────────────────────────────────────────────────────────────────────

def _make_join(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
) -> dict:
    node = _base_node(nr_id, "join", tab_id, name, x, y)
    node.update({
        "mode":        "auto",
        "build":       "array",
        "property":    "payload",
        "propertyType":"msg",
        "key":         "topic",
        "joiner":      "\\n",
        "joinerType":  "str",
        "accumulate":  False,
        "timeout":     "",
        "count":       "",
        "reduceRight": False,
        "outputs":     1,
    })
    return node


# ── Debug ────────────────────────────────────────────────────────────────────

def _make_debug(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
) -> dict:
    node = _base_node(nr_id, "debug", tab_id, name, x, y)
    node.update({
        "active":     True,
        "tosidebar":  True,
        "console":    False,
        "tostatus":   False,
        "complete":   "payload",
        "targetType": "msg",
        "statusVal":  "",
        "statusType": "auto",
    })
    return node


# ── E-mail ───────────────────────────────────────────────────────────────────

def _make_email(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    data: dict,
) -> dict:
    """E-mail output node (requires node-red-node-email to be installed)."""
    node = _base_node(nr_id, "e-mail", tab_id, name, x, y)
    node.update({
        "server":   "smtp.gmail.com",
        "port":     "587",
        "secure":   False,
        "tls":      True,
        "name":     data.get("to", ""),
        "dname":    name,
        "to":       data.get("to", ""),
        "from":     "lumina@example.com",
        "subject":  data.get("subject", "Lumina Alert"),
        "body":     "payload",
        # Note: credentials (username/password) must be set in Node-RED editor
    })
    return node


# ── File ─────────────────────────────────────────────────────────────────────

def _make_file(
    nr_id: str,
    tab_id: str,
    name: str,
    x: int,
    y: int,
    data: dict,
) -> dict:
    node = _base_node(nr_id, "file", tab_id, name, x, y)
    node.update({
        "filename":      data.get("filename", "lumina_output.txt"),
        "filenameType":  "str",
        "appendNewline": True,
        "createDir":     True,
        "overwriteFile": "false",
        "encoding":      "none",
    })
    return node


# ── MQTT Out + Broker Config ──────────────────────────────────────────────────

def _make_mqtt_broker(nr_id: str, tab_id: str, data: dict) -> dict:
    """Create the mqtt-broker config node (referenced by mqtt out nodes)."""
    # Config nodes do NOT have a z field — they are global
    return {
        "id":          nr_id,
        "type":        "mqtt-broker",
        "name":        "Lumina MQTT Broker",
        "broker":      data.get("broker", "localhost"),
        "port":        str(data.get("port", 1883)),
        "clientid":    "",
        "autoConnect": True,
        "usetls":      False,
        "protocolVersion": "4",
        "keepalive":   "60",
        "cleansession": True,
        "autoUnsubscribe": True,
        "birthTopic":  "",
        "birthQos":    "0",
        "birthPayload":"",
        "birthMsg":    {},
        "closeTopic":  "",
        "closeQos":    "0",
        "closePayload":"",
        "closeMsg":    {},
        "willTopic":   "",
        "willQos":     "0",
        "willPayload": "",
        "willMsg":     {},
        "userProps":   "",
        "sessionExpiry": "",
    }


def _make_mqtt_out(
    nr_id: str,
    tab_id: str,
    broker_id: str,
    name: str,
    x: int,
    y: int,
    data: dict,
) -> dict:
    node = _base_node(nr_id, "mqtt out", tab_id, name, x, y)
    node.update({
        "topic":  data.get("topic", "lumina/output"),
        "qos":    "",
        "retain": "",
        "respTopic": "",
        "contentType": "",
        "userProps": "",
        "correl": "",
        "expiry": "",
        "broker": broker_id,
    })
    return node


# ---------------------------------------------------------------------------
# Display name registry
# ---------------------------------------------------------------------------

_DISPLAY_NAMES: dict[str, str] = {
    # Inputs
    "camera":   "Camera",
    "video":    "Video",
    "mic":      "Microphone",
    "audioFile":"Audio File",
    "ipCamera": "IP Camera",
    "timer":    "Timer",
    # AI
    "detection":  "Object Detect",
    "faceMatch":  "Face Match",
    "pose":       "Pose Detect",
    "ocr":        "OCR",
    "visualLlm":  "Visual LLM",
    "geminiLive": "Gemini Live",
    "llm":        "LLM",
    "audioDetect":"Audio Detect",
    "audioLlm":   "Audio LLM",
    "whisperStt": "Whisper STT",
    "toolUse":    "Tool Use",
    # Logic
    "logic":   "Switch",
    # Processing
    "debounce":"Debounce",
    "merge":   "Merge",
    "script":  "Script",
    # Actions
    "logAction":          "Log",
    "emailAction":        "Email",
    "smsAction":          "SMS",
    "slackAction":        "Slack",
    "discordAction":      "Discord",
    "webhookAction":      "Webhook",
    "mqttAction":         "MQTT",
    "fileAction":         "File",
    "notifyAction":       "Notify",
    "screenshotAction":   "Screenshot",
    "soundAction":        "Sound",
    "speakAction":        "Speak",
    "googleSheetsAction": "Google Sheets",
}


def _display_name(ntype: str, counters: dict[str, int]) -> str:
    """Return a unique human-readable name for a Lumina node type."""
    base = _DISPLAY_NAMES.get(ntype, ntype)
    counters[base] = counters.get(base, 0) + 1
    n = counters[base]
    return base if n == 1 else f"{base} {n}"


# ---------------------------------------------------------------------------
# Wire helper
# ---------------------------------------------------------------------------

def _wire(nr_nodes_by_id: dict[str, dict], src_id: str, tgt_id: str, port: int = 0) -> None:
    """Add tgt_id to src node's wires[port], extending the list if needed."""
    node = nr_nodes_by_id.get(src_id)
    if node is None:
        return
    wires: list[list] = node.setdefault("wires", [[]])
    while len(wires) <= port:
        wires.append([])
    if tgt_id not in wires[port]:
        wires[port].append(tgt_id)


# ---------------------------------------------------------------------------
# Main compiler
# ---------------------------------------------------------------------------

def compile_to_nodered(graph: dict) -> list:
    """Compile a Lumina ReactFlow graph to a Node-RED flow JSON array.

    Args:
        graph: dict with keys "nodes" (list of ReactFlow node dicts) and
               "edges" (list of ReactFlow edge dicts).

    Returns:
        A list (JSON array) ready for ``json.dumps`` and import into Node-RED.
        The first element is the tab node; all subsequent elements are flow nodes.

    Node-RED import:
        In Node-RED, go to Menu → Import → paste the JSON array → Import.
    """
    lumina_nodes: list[dict] = graph.get("nodes", [])
    lumina_edges: list[dict] = graph.get("edges", [])
    base = _get_base()

    # ── Tab node ─────────────────────────────────────────────────────────────
    tab_id = _short_id()
    tab_node: dict[str, Any] = {
        "id":       tab_id,
        "type":     "tab",
        "label":    "Lumina Export",
        "disabled": False,
        "info":     "",
        "env":      [],
    }

    # Ordered list of all NR nodes (tab excluded)
    nr_nodes: list[dict] = []
    # Config nodes (mqtt-broker etc.) collected separately so they can be
    # appended at the end (they have no z field and must not appear before use)
    config_nodes: list[dict] = []
    # Fast lookup by NR id
    nr_by_id: dict[str, dict] = {}

    # Maps Lumina node ID → NR node ID that incoming upstream edges connect to
    incoming_map: dict[str, str] = {}
    # Maps Lumina node ID → NR node ID that outgoing downstream edges originate from
    outgoing_map: dict[str, str] = {}

    # Unique name counter
    counters: dict[str, int] = {}

    # ── Build NR nodes from Lumina nodes ─────────────────────────────────────
    for node in lumina_nodes:
        lumina_id = node.get("id", _short_id())
        ntype     = node.get("type", "")
        data      = node.get("data") or {}
        rf_pos    = node.get("position") or {}
        rx = round(rf_pos.get("x", 0) * _SCALE)
        ry = round(rf_pos.get("y", 0) * _SCALE)

        label = _display_name(ntype, counters)

        # ── INPUT NODES: inject + http request pair ───────────────────────
        if ntype in {"camera", "video", "ipCamera", "mic", "audioFile"}:
            inject_id  = _short_id()
            capture_id = _short_id()

            # Determine polling interval and capture payload
            if ntype == "camera":
                fps = max(0.01, float(data.get("fps", 1)))
                # Minimum 10s between triggers — VLM/detect need processing time
                interval = max(10, round(1 / fps))
                payload  = {"source": "camera", "fps": fps}
            elif ntype == "video":
                interval = 5
                payload  = {"source": "video", "path": data.get("path", "")}
            elif ntype == "ipCamera":
                interval = 5
                payload  = {"source": "ip_camera", "url": data.get("url", "")}
            elif ntype == "mic":
                interval = 2
                payload  = {"source": "mic", "duration": data.get("duration", 2)}
            else:  # audioFile
                interval = 5
                payload  = {"source": "audio_file", "path": data.get("path", "")}

            inject_x = rx + _PAIR_LEFT_OFFSET_INJECT
            inject_y = ry

            inj = _make_inject(
                inject_id, tab_id,
                f"{label} Trigger",
                inject_x, inject_y,
                payload, interval,
            )
            cap = _make_http_request(
                capture_id, tab_id,
                label,
                rx, ry,
                f"{base}/api/capture",
            )

            # Wire inject → capture internally
            inj["wires"] = [[capture_id]]

            nr_nodes.extend([inj, cap])
            nr_by_id[inject_id]  = inj
            nr_by_id[capture_id] = cap

            # Input nodes are always graph sources; if something somehow points
            # at them we land on the inject node.  Outgoing edges originate from
            # the capture node (which carries the actual frame data in payload).
            incoming_map[lumina_id] = inject_id
            outgoing_map[lumina_id] = capture_id

        # ── TIMER: single inject, no capture ─────────────────────────────
        elif ntype == "timer":
            inject_id = _short_id()
            interval  = max(1, int(data.get("interval", 60)))

            inj = _make_inject(
                inject_id, tab_id,
                label,
                rx, ry,
                {}, interval,
            )
            nr_nodes.append(inj)
            nr_by_id[inject_id] = inj
            incoming_map[lumina_id] = inject_id
            outgoing_map[lumina_id] = inject_id

        # ── AI NODES: simple single http request ─────────────────────────
        elif ntype in {
            "detection", "faceMatch", "pose", "ocr",
            "whisperStt", "audioDetect",
        }:
            # These nodes receive msg.payload from upstream and forward it as
            # the request body.  Any extra per-type params are merged via a
            # thin function node so the original payload is preserved.
            fn_id   = _short_id()
            http_id = _short_id()

            endpoint_map = {
                "detection":  "/api/detect",
                "faceMatch":  "/api/face-match",
                "pose":       "/api/pose",
                "ocr":        "/api/ocr",
                "whisperStt": "/api/whisper",
                "audioDetect":"/api/audio-detect",
            }
            url = f"{base}{endpoint_map[ntype]}"

            # Build merge code: save image/audio to msg.lumina_* so it survives
            # after this node's HTTP response replaces msg.payload.
            if ntype == "detection":
                confidence = data.get("confidence", 50)
                merge_code = (
                    "// Preserve image so downstream VLM nodes can use it\n"
                    "msg.lumina_image = msg.payload.image || msg.payload.output || msg.lumina_image || '';\n"
                    f"msg.payload = Object.assign({{}}, msg.payload, {{confidence: {confidence}}});\n"
                    "return msg;"
                )
            elif ntype == "audioDetect":
                confidence = data.get("confidence", 20)
                merge_code = (
                    "msg.lumina_audio = msg.payload.audio || msg.payload.output || msg.lumina_audio || '';\n"
                    f"msg.payload = Object.assign({{}}, msg.payload, {{confidence: {confidence}}});\n"
                    "return msg;"
                )
            elif ntype == "faceMatch":
                merge_code = (
                    "msg.lumina_image = msg.payload.image || msg.payload.output || msg.lumina_image || '';\n"
                    "return msg;"
                )
            else:
                # Preserve image as pass-through
                merge_code = (
                    "msg.lumina_image = msg.payload.image || msg.payload.output || msg.lumina_image || '';\n"
                    "return msg;"
                )

            fn_x = rx + _PAIR_LEFT_OFFSET_FUNCTION
            fn   = _make_function(fn_id, tab_id, f"{label} Prep", fn_x, ry, merge_code)
            http = _make_http_request(http_id, tab_id, label, rx, ry, url)

            # Wire fn → http internally
            fn["wires"] = [[http_id]]

            nr_nodes.extend([fn, http])
            nr_by_id[fn_id]   = fn
            nr_by_id[http_id] = http

            incoming_map[lumina_id] = fn_id
            outgoing_map[lumina_id] = http_id

        # ── AI NODES WITH PROMPT: rate-limiter + function + http request ─────
        elif ntype in {
            "visualLlm", "geminiLive", "llm",
            "audioLlm", "toolUse",
        }:
            rl_id   = _short_id()   # rate limiter — drops excess msgs
            fn_id   = _short_id()
            http_id = _short_id()

            endpoint_map = {
                "visualLlm":  "/api/vlm",
                "geminiLive": "/api/gemini-live",
                "llm":        "/api/llm",
                "audioLlm":   "/api/audio-llm",
                "toolUse":    "/api/tool-use",
            }
            url = f"{base}{endpoint_map[ntype]}"

            if ntype == "visualLlm":
                prompt = data.get("prompt", "Describe what you see").replace('"', '\\"')
                merge_code = (
                    "// Restore original captured image (detect/other nodes overwrite msg.payload)\n"
                    "var img = msg.lumina_image || msg.payload.image || msg.payload.output || '';\n"
                    f'msg.payload = {{image: img, prompt: "{prompt}"}};\n'
                    "return msg;"
                )
            elif ntype == "geminiLive":
                prompt = data.get("system_prompt", "Analyze the scene").replace('"', '\\"')
                merge_code = (
                    "var img = msg.lumina_image || msg.payload.image || msg.payload.output || '';\n"
                    f'msg.payload = {{image: img, prompt: "{prompt}"}};\n'
                    "return msg;"
                )
            elif ntype == "llm":
                prompt = data.get("prompt", "").replace('"', '\\"')
                system = data.get("system_prompt", "").replace('"', '\\"')
                merge_code = (
                    "var text = msg.payload.output || msg.payload.text || '';\n"
                    f'msg.payload = {{input_text: text, prompt: "{prompt}", system: "{system}"}};\n'
                    "return msg;"
                )
            elif ntype == "audioLlm":
                prompt = data.get("prompt", "Analyze this audio").replace('"', '\\"')
                merge_code = (
                    "var ctx = msg.lumina_audio || msg.payload.output || msg.payload.transcript || '';\n"
                    f'msg.payload = {{context: ctx, prompt: "{prompt}"}};\n'
                    "return msg;"
                )
            else:  # toolUse
                tool_name = data.get("tool_name", "").replace('"', '\\"')
                merge_code = (
                    "var text = msg.payload.output || msg.payload.text || '';\n"
                    f'msg.payload = {{input_text: text, tool_name: "{tool_name}"}};\n'
                    "return msg;"
                )

            rl_x = rx + _PAIR_LEFT_OFFSET_FUNCTION - 120
            fn_x = rx + _PAIR_LEFT_OFFSET_FUNCTION
            rl   = _make_rate_limit(rl_id, tab_id, f"{label} Rate Limit", rl_x, ry)
            fn   = _make_function(fn_id, tab_id, f"{label} Prep", fn_x, ry, merge_code)
            http = _make_http_request(http_id, tab_id, label, rx, ry, url)

            # rate limiter → fn → http
            rl["wires"] = [[fn_id]]
            fn["wires"] = [[http_id]]

            nr_nodes.extend([rl, fn, http])
            nr_by_id[rl_id]   = rl
            nr_by_id[fn_id]   = fn
            nr_by_id[http_id] = http

            # Incoming edges land on the rate limiter; outgoing from http
            incoming_map[lumina_id] = rl_id
            outgoing_map[lumina_id] = http_id

        # ── LOGIC: switch node ────────────────────────────────────────────
        elif ntype == "logic":
            sw_id = _short_id()
            sw = _make_switch(sw_id, tab_id, label, rx, ry, data)

            nr_nodes.append(sw)
            nr_by_id[sw_id] = sw
            incoming_map[lumina_id] = sw_id
            outgoing_map[lumina_id] = sw_id

        # ── DEBOUNCE: delay node ──────────────────────────────────────────
        elif ntype == "debounce":
            delay_id = _short_id()
            seconds  = int(data.get("interval", 5))
            dl = _make_delay(delay_id, tab_id, label, rx, ry, seconds)

            nr_nodes.append(dl)
            nr_by_id[delay_id] = dl
            incoming_map[lumina_id] = delay_id
            outgoing_map[lumina_id] = delay_id

        # ── MERGE: join node ──────────────────────────────────────────────
        elif ntype == "merge":
            join_id = _short_id()
            jn = _make_join(join_id, tab_id, label, rx, ry)

            nr_nodes.append(jn)
            nr_by_id[join_id] = jn
            incoming_map[lumina_id] = join_id
            outgoing_map[lumina_id] = join_id

        # ── SCRIPT: function node ─────────────────────────────────────────
        elif ntype == "script":
            fn_id   = _short_id()
            raw_js  = data.get("script", "")
            js_code = (
                "// Auto-converted from Lumina script node\n"
                + raw_js
                if raw_js
                else (
                    "// Lumina script node (empty) — pass through\n"
                    "return msg;"
                )
            )
            fn = _make_function(fn_id, tab_id, label, rx, ry, js_code)

            nr_nodes.append(fn)
            nr_by_id[fn_id] = fn
            incoming_map[lumina_id] = fn_id
            outgoing_map[lumina_id] = fn_id

        # ── ACTION: logAction → debug ─────────────────────────────────────
        elif ntype == "logAction":
            dbg_id = _short_id()
            dbg = _make_debug(dbg_id, tab_id, label, rx, ry)

            nr_nodes.append(dbg)
            nr_by_id[dbg_id] = dbg
            incoming_map[lumina_id] = dbg_id
            outgoing_map[lumina_id] = dbg_id

        # ── ACTION: emailAction → e-mail ──────────────────────────────────
        elif ntype == "emailAction":
            em_id = _short_id()
            em = _make_email(em_id, tab_id, label, rx, ry, data)

            nr_nodes.append(em)
            nr_by_id[em_id] = em
            incoming_map[lumina_id] = em_id
            outgoing_map[lumina_id] = em_id

        # ── ACTION: fileAction → file write ───────────────────────────────
        elif ntype == "fileAction":
            file_id = _short_id()
            fnode = _make_file(file_id, tab_id, label, rx, ry, data)

            nr_nodes.append(fnode)
            nr_by_id[file_id] = fnode
            incoming_map[lumina_id] = file_id
            outgoing_map[lumina_id] = file_id

        # ── ACTION: mqttAction → function + mqtt out ──────────────────────
        elif ntype == "mqttAction":
            fn_id      = _short_id()
            mqtt_id    = _short_id()
            broker_id  = _short_id()

            topic   = data.get("topic", "lumina/output").replace('"', '\\"')
            payload_expr = data.get("payload", "")

            if payload_expr:
                payload_line = f'msg.payload = {payload_expr};\n'
            else:
                payload_line = "// msg.payload flows through unchanged\n"

            fn_code = (
                f'msg.topic = "{topic}";\n'
                + payload_line
                + "return msg;"
            )

            fn_x = rx + _PAIR_LEFT_OFFSET_FUNCTION
            fn   = _make_function(fn_id, tab_id, f"{label} Prep", fn_x, ry, fn_code)

            broker_node = _make_mqtt_broker(broker_id, tab_id, data)
            mqtt_out    = _make_mqtt_out(mqtt_id, tab_id, broker_id, label, rx, ry, data)

            fn["wires"] = [[mqtt_id]]

            nr_nodes.extend([fn, mqtt_out])
            config_nodes.append(broker_node)
            nr_by_id[fn_id]   = fn
            nr_by_id[mqtt_id] = mqtt_out

            incoming_map[lumina_id] = fn_id
            outgoing_map[lumina_id] = mqtt_id

        # ── ACTION: webhook / slack / discord → http request ──────────────
        elif ntype in {"webhookAction", "slackAction", "discordAction"}:
            http_id = _short_id()
            if ntype == "webhookAction":
                url = data.get("url", "")
            elif ntype == "slackAction":
                url = data.get("webhook_url", f"{base}/api/slack")
            else:  # discordAction
                url = data.get("webhook_url", f"{base}/api/discord")

            http = _make_http_request(http_id, tab_id, label, rx, ry, url)

            nr_nodes.append(http)
            nr_by_id[http_id] = http
            incoming_map[lumina_id] = http_id
            outgoing_map[lumina_id] = http_id

        # ── ACTION: Lumina API actions (notify/screenshot/sound/speak/sms/sheets)
        elif ntype in {
            "notifyAction", "screenshotAction", "soundAction",
            "speakAction", "smsAction", "googleSheetsAction",
        }:
            http_id = _short_id()
            endpoint_map = {
                "notifyAction":       "/api/notify",
                "screenshotAction":   "/api/screenshot",
                "soundAction":        "/api/sound",
                "speakAction":        "/api/speak",
                "smsAction":          "/api/sms",
                "googleSheetsAction": "/api/google-sheets",
            }
            url = f"{base}{endpoint_map[ntype]}"

            # Merge action-specific fields into payload via function node
            if ntype == "soundAction":
                sound = data.get("sound", "alert").replace('"', '\\"')
                fn_code = (
                    f'msg.payload = Object.assign({{}}, msg.payload, {{sound: "{sound}"}});\n'
                    "return msg;"
                )
            elif ntype == "speakAction":
                text = data.get("text", "").replace('"', '\\"')
                fn_code = (
                    f'msg.payload = Object.assign({{}}, msg.payload, '
                    f'{{text: "{text}" || msg.payload.output || ""}});\n'
                    "return msg;"
                )
            elif ntype == "smsAction":
                to   = data.get("to", "").replace('"', '\\"')
                body = data.get("body", "").replace('"', '\\"')
                fn_code = (
                    f'msg.payload = Object.assign({{}}, msg.payload, '
                    f'{{to: "{to}", body: "{body}" || msg.payload.output || ""}});\n'
                    "return msg;"
                )
            elif ntype == "googleSheetsAction":
                sheet_id   = data.get("sheet_id", "").replace('"', '\\"')
                sheet_name = data.get("sheet_name", "Sheet1").replace('"', '\\"')
                fn_code = (
                    f'msg.payload = Object.assign({{}}, msg.payload, '
                    f'{{sheet_id: "{sheet_id}", sheet_name: "{sheet_name}"}});\n'
                    "return msg;"
                )
            else:
                fn_code = "return msg;"   # pass-through

            fn_id = _short_id()
            fn_x  = rx + _PAIR_LEFT_OFFSET_FUNCTION
            fn    = _make_function(fn_id, tab_id, f"{label} Prep", fn_x, ry, fn_code)
            http  = _make_http_request(http_id, tab_id, label, rx, ry, url)

            fn["wires"] = [[http_id]]

            nr_nodes.extend([fn, http])
            nr_by_id[fn_id]   = fn
            nr_by_id[http_id] = http

            incoming_map[lumina_id] = fn_id
            outgoing_map[lumina_id] = http_id

        else:
            # Unknown / future node type → no-op comment node as placeholder
            noop_id = _short_id()
            noop: dict[str, Any] = {
                "id":   noop_id,
                "type": "comment",
                "z":    tab_id,
                "name": f"[TODO] {label} (type: {ntype})",
                "info": (
                    f"Lumina node type '{ntype}' has no Node-RED mapping.\n"
                    "Replace this placeholder with the appropriate node."
                ),
                "x":     rx,
                "y":     ry,
                "wires": [],
            }
            nr_nodes.append(noop)
            nr_by_id[noop_id] = noop
            incoming_map[lumina_id] = noop_id
            outgoing_map[lumina_id] = noop_id

    # ── Wire edges ────────────────────────────────────────────────────────────
    # For switch (logic) nodes:
    #   sourceHandle "no_match" or "else"  → output port  = last port (else port)
    #   sourceHandle "match" / anything else → output port 0
    #
    # For all other node types: always port 0.

    for edge in lumina_edges:
        src_lumina_id = edge.get("source")
        tgt_lumina_id = edge.get("target")
        src_handle    = edge.get("sourceHandle", "")

        out_nr_id = outgoing_map.get(src_lumina_id)
        in_nr_id  = incoming_map.get(tgt_lumina_id)

        if not out_nr_id or not in_nr_id:
            # One or both endpoints were not mapped (unknown node types etc.)
            continue

        # Determine output port on the source NR node
        out_node = nr_by_id.get(out_nr_id)
        if out_node and out_node.get("type") == "switch":
            num_outputs = out_node.get("outputs", 1)
            if src_handle in {"no_match", "else", "false"}:
                # else is always the last port
                _wire(nr_by_id, out_nr_id, in_nr_id, num_outputs - 1)
            else:
                # "match" — connect ALL condition output ports (0..N-2) so any
                # matching condition propagates downstream, not just the first one.
                for port in range(num_outputs - 1):
                    _wire(nr_by_id, out_nr_id, in_nr_id, port)
        else:
            _wire(nr_by_id, out_nr_id, in_nr_id, 0)

    # ── Assemble final flow array ─────────────────────────────────────────────
    flow: list[dict] = [tab_node] + nr_nodes + config_nodes

    return flow


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def _cli() -> None:
    """Read a Lumina graph JSON from stdin, print Node-RED flow to stdout.

    Usage:
        python export_nodered.py < my_graph.json > nodered_flow.json

    Or pass a file path as the first argument:
        python export_nodered.py my_graph.json
    """
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as fh:
            graph = json.load(fh)
    else:
        graph = json.load(sys.stdin)

    flow = compile_to_nodered(graph)
    print(json.dumps(flow, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    _cli()
