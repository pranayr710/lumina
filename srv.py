import asyncio
import base64
import json
import logging
import os
import smtplib
import subprocess
import uuid
import time
from contextlib import asynccontextmanager
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path

import httpx
import sqlite3
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import numpy as np

from brain import Brain
from vis import Vis
from aud import Aud

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("lumina.srv")

DB = "lumina.db"
BOOT_TIME = time.time()

COCO_LABELS = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
    "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
    "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
    "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
    "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
    "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
    "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
    "remote","keyboard","cell phone","microwave","oven","toaster","sink",
    "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
    "toothbrush"
]


def init_db():
    with sqlite3.connect(DB) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS history "
            "(id TEXT PRIMARY KEY, ts TEXT, type TEXT, nid TEXT, data TEXT, img TEXT)"
        )

init_db()


def log_ev(t, nid, d, img=None):
    eid = str(uuid.uuid4())
    ts = datetime.now().isoformat()
    p = ""
    if img:
        dr = Path("s"); dr.mkdir(exist_ok=True)
        p = f"s/{eid}.jpg"
        raw = img.split(",")[1] if "," in img else img
        with open(dr / f"{eid}.jpg", "wb") as f:
            f.write(base64.b64decode(raw))
    with sqlite3.connect(DB) as conn:
        conn.execute(
            "INSERT INTO history VALUES (?,?,?,?,?,?)",
            (eid, ts, t, nid, json.dumps(d), p)
        )


# ── Singletons ──────────────────────────────────────────────────────────────

brain = Brain()
_vis: Vis | None = None
_aud: Aud | None = None


def get_v() -> Vis | None:
    global _vis
    if not _vis:
        p = Path("m/yolov8n.onnx")
        if p.exists():
            _vis = Vis(str(p))
    return _vis


def get_a() -> Aud | None:
    global _aud
    if not _aud:
        m, l = Path("m/yamnet.onnx"), Path("m/yamnet_class_map.csv")
        if m.exists() and l.exists():
            _aud = Aud(str(m), str(l))
    return _aud


# ── Connection Manager ───────────────────────────────────────────────────────

class Manager:
    def __init__(self):
        self.active: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket) -> str:
        await ws.accept()
        cid = str(uuid.uuid4())[:8]
        self.active[cid] = ws
        return cid

    def disconnect(self, cid: str):
        self.active.pop(cid, None)

    async def send(self, cid: str, m_type: str, payload: dict):
        ws = self.active.get(cid)
        if ws:
            try:
                await ws.send_json({"type": m_type, "payload": payload})
            except Exception:
                self.disconnect(cid)

    async def broadcast(self, m_type: str, payload: dict):
        dead = []
        for cid, ws in self.active.items():
            try:
                await ws.send_json({"type": m_type, "payload": payload})
            except Exception:
                dead.append(cid)
        for cid in dead:
            self.disconnect(cid)


mgr = Manager()
clients: dict[str, dict] = {}


# ── Telemetry broadcast ──────────────────────────────────────────────────────

async def _telemetry_loop():
    while True:
        await asyncio.sleep(2)
        for cid, state in list(clients.items()):
            tel = state.get("tel", {})
            await mgr.send(cid, "telemetry_update", {
                "execution_counts": tel.get("execution_counts", {}),
                "latencies": tel.get("latencies", {}),
                "uptime_s": int(time.time() - BOOT_TIME),
            })


def _bump(cid: str, node_type: str, latency_ms: float):
    tel = clients.get(cid, {}).get("tel", {})
    ec = tel.setdefault("execution_counts", {})
    ec[node_type] = ec.get(node_type, 0) + 1
    lat = tel.setdefault("latencies", {})
    arr = lat.setdefault(node_type, [])
    arr.append(round(latency_ms, 1))
    if len(arr) > 10:
        arr.pop(0)


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def life(app: FastAPI):
    log.info("Lumina Srv Starting")
    brain.load_v()
    brain.load_l()
    get_v()
    get_a()
    asyncio.create_task(_telemetry_loop())
    yield
    brain.shut()


app = FastAPI(lifespan=life)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── REST Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_s": int(time.time() - BOOT_TIME),
        "vlm_ready": brain.v_rdy,
        "llm_ready": brain.l_rdy,
        "vision_model": "yolov8n" if get_v() else None,
        "audio_model": "yamnet" if get_a() else None,
    }


@app.get("/api/history")
async def get_history():
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(
            "SELECT id,ts,type,nid,data,img FROM history ORDER BY ts DESC LIMIT 100"
        ).fetchall()
    return [
        {"id": r[0], "ts": r[1], "type": r[2], "nid": r[3],
         "data": json.loads(r[4] or "{}"), "img": r[5]}
        for r in rows
    ]


@app.get("/api/dashboard")
async def get_dashboard():
    with sqlite3.connect(DB) as conn:
        total = conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]
        types = conn.execute(
            "SELECT type, COUNT(*) FROM history GROUP BY type"
        ).fetchall()
    return {
        "uptime_s": int(time.time() - BOOT_TIME),
        "total_events": total,
        "by_type": {t: c for t, c in types},
        "vlm_ready": brain.v_rdy,
        "llm_ready": brain.l_rdy,
        "clients": len(mgr.active),
    }


@app.post("/api/export/n8n")
async def export_n8n(graph: dict):
    from export_n8n import compile_to_n8n
    workflow = compile_to_n8n(graph)
    return Response(
        content=json.dumps(workflow, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=lumina-workflow.json"},
    )


@app.post("/api/export/n8n/push")
async def push_to_n8n(graph: dict):
    from export_n8n import compile_to_n8n
    n8n_url = os.getenv("N8N_INSTANCE_URL", "http://localhost:5678")
    token = os.getenv("N8N_MCP_TOKEN")
    if not token:
        return {"error": "N8N_MCP_TOKEN not set"}
    workflow = compile_to_n8n(graph)
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{n8n_url}/api/v1/workflows",
            json=workflow,
            headers={"X-N8N-API-KEY": token},
        )
    return {"status": r.status_code, "workflow_id": r.json().get("id")}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    cid = await mgr.connect(ws)
    clients[cid] = {"tel": {"execution_counts": {}, "latencies": {}}}
    log.info(f"Client connected: {cid}")
    try:
        while True:
            data = await ws.receive_json()
            t, p = data.get("type"), data.get("payload", {})
            asyncio.create_task(_handle(cid, t, p))
    except WebSocketDisconnect:
        mgr.disconnect(cid)
        clients.pop(cid, None)
        log.info(f"Client disconnected: {cid}")


async def _handle(cid: str, t: str, p: dict):
    """Dispatch WebSocket message to the appropriate handler."""
    try:
        if t == "frame":
            await _h_frame(cid, p)
        elif t == "detect":
            await _h_detect(cid, p)
        elif t in ("vlm", "vlm_analyze"):
            await _h_vlm(cid, p)
        elif t == "audio_analyze":
            await _h_audio(cid, p)
        elif t == "audio_llm_analyze":
            await _h_audio_llm(cid, p)
        elif t == "text_gen":
            await _h_text_gen(cid, p)
        elif t == "whisper_stt":
            await _h_whisper(cid, p)
        elif t == "generate_workflow":
            await _h_gen_workflow(cid, p)
        elif t == "chat_refine":
            await _h_chat(cid, p)
        elif t == "auto_connect":
            await _h_auto_connect(cid, p)
        elif t == "send_email":
            await _h_email(cid, p)
        elif t == "send_sms":
            await _h_sms(cid, p)
        elif t == "discord_notify":
            await _h_discord(cid, p)
        elif t == "slack_notify":
            await _h_slack(cid, p)
        elif t == "mqtt_publish":
            await _h_mqtt(cid, p)
        elif t == "run_script":
            await _h_script(cid, p)
        elif t == "gemini_live_start":
            await _h_gemini_live_start(cid, p)
        elif t == "gemini_live_frame":
            await _h_gemini_live_frame(cid, p)
        elif t == "gemini_live_stop":
            await _h_gemini_live_stop(cid, p)
        elif t == "tool_use":
            await _h_tool_use(cid, p)
    except Exception as e:
        log.error(f"Handler error [{t}]: {e}", exc_info=True)
        nid = p.get("node_id", "")
        await mgr.send(cid, f"{t}_error", {"node_id": nid, "error": str(e)})


# ── Individual handlers ───────────────────────────────────────────────────────

async def _h_frame(cid: str, p: dict):
    """Camera frame → run YOLO → send detect_res for live preview."""
    v = get_v()
    if not v:
        return
    import cv2
    raw = p.get("image", "")
    if "," in raw:
        raw = raw.split(",")[1]
    buf = np.frombuffer(base64.b64decode(raw), np.uint8)
    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    t0 = time.perf_counter()
    hits = v.run(frame)
    lat = (time.perf_counter() - t0) * 1000
    detections = [
        {"label": COCO_LABELS[h["cid"]] if h["cid"] < len(COCO_LABELS) else "unknown",
         "confidence": round(h["conf"] * 100),
         "bbox": h["box"]}
        for h in hits
    ]
    await mgr.send(cid, "detect_res", {
        "node_id": p.get("node_id"),
        "hits": detections,
        "latency_ms": round(lat, 1),
    })


async def _h_detect(cid: str, p: dict):
    """Explicit detection request from DetectionNode."""
    v = get_v()
    nid = p.get("node_id", "")
    if not v:
        await mgr.send(cid, "detect_result", {"node_id": nid, "detections": [], "error": "No model"})
        return
    import cv2
    raw = p.get("image", "")
    if "," in raw:
        raw = raw.split(",")[1]
    conf_thresh = p.get("confidence", 45) / 100.0
    t0 = time.perf_counter()
    buf = np.frombuffer(base64.b64decode(raw), np.uint8)
    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    # Temporarily lower vis confidence threshold
    old_conf = v.conf
    v.conf = conf_thresh
    hits = v.run(frame)
    v.conf = old_conf
    lat = (time.perf_counter() - t0) * 1000
    detections = [
        {"label": COCO_LABELS[h["cid"]] if h["cid"] < len(COCO_LABELS) else "unknown",
         "confidence": round(h["conf"] * 100),
         "bbox": h["box"]}
        for h in hits
    ]
    _bump(cid, "detection", lat)
    log_ev("detect", nid, {"count": len(detections)})
    await mgr.send(cid, "detect_result", {
        "node_id": nid,
        "detections": detections,
        "latency_ms": round(lat, 1),
    })


async def _h_vlm(cid: str, p: dict):
    """VLM visual analysis request."""
    nid = p.get("node_id", "")
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.run_v, p.get("image", ""), p.get("prompt", "Describe what you see"), cid
    )
    _bump(cid, "visualLlm", result.get("latency_ms", 0))
    log_ev("vlm", nid, {"analysis": result.get("analysis", "")[:200]})
    await mgr.send(cid, "vlm_result", {"node_id": nid, **result})


async def _h_audio(cid: str, p: dict):
    """YamNet audio classification."""
    a = get_a()
    nid = p.get("node_id", "")
    if not a:
        await mgr.send(cid, "audio_result", {"node_id": nid, "events": [], "error": "No model"})
        return
    import io, wave
    raw = p.get("audio", "")
    if "," in raw:
        raw = raw.split(",")[1]
    t0 = time.perf_counter()
    audio_bytes = base64.b64decode(raw)
    # Decode WAV PCM to float array
    try:
        with io.BytesIO(audio_bytes) as bio:
            with wave.open(bio, "rb") as wf:
                frames = wf.readframes(wf.getnframes())
                samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception:
        samples = np.frombuffer(audio_bytes, dtype=np.float32)
    # Reshape to YamNet input (96 x 64 mel spectrogram approximation)
    target = 96 * 64
    if len(samples) >= target:
        samples = samples[:target]
    else:
        samples = np.pad(samples, (0, target - len(samples)))
    events = a.run(samples.reshape(96, 64).tolist())
    lat = (time.perf_counter() - t0) * 1000
    conf_thresh = p.get("confidence", 20) / 100.0
    filtered = [e for e in events if e["conf"] >= conf_thresh]
    top = filtered[0] if filtered else None
    _bump(cid, "audioDetect", lat)
    log_ev("audio", nid, {"top": top})
    await mgr.send(cid, "audio_result", {
        "node_id": nid,
        "events": filtered[:10],
        "top_class": top["label"] if top else None,
        "confidence": round(top["conf"] * 100) if top else 0,
        "latency_ms": round(lat, 1),
    })


async def _h_audio_llm(cid: str, p: dict):
    """LLM analysis of audio transcription / description."""
    nid = p.get("node_id", "")
    prompt = p.get("prompt", "Analyze this audio")
    context = p.get("context", "")
    full_prompt = f"{prompt}\n\nAudio context: {context}" if context else prompt
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.gen_txt, full_prompt, 512, False
    )
    _bump(cid, "audioLlm", 0)
    await mgr.send(cid, "audio_llm_result", {
        "node_id": nid,
        "analysis": result.get("text", ""),
    })


async def _h_text_gen(cid: str, p: dict):
    """LLM text generation."""
    nid = p.get("node_id", "")
    t0 = time.perf_counter()
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.gen_txt, p.get("prompt", ""), p.get("max_tokens", 512), False
    )
    lat = (time.perf_counter() - t0) * 1000
    _bump(cid, "llm", lat)
    log_ev("text_gen", nid, {"preview": result.get("text", "")[:100]})
    await mgr.send(cid, "text_result", {
        "node_id": nid,
        "text": result.get("text", ""),
        "latency_ms": round(lat, 1),
    })


async def _h_whisper(cid: str, p: dict):
    """Whisper speech-to-text."""
    nid = p.get("node_id", "")
    raw = p.get("audio", "")
    if "," in raw:
        raw = raw.split(",")[1]
    audio_path = f"/tmp/lumina_stt_{uuid.uuid4().hex[:8]}.wav"
    try:
        with open(audio_path, "wb") as f:
            f.write(base64.b64decode(raw))
        t0 = time.perf_counter()
        try:
            import whisper
            mdl = whisper.load_model("base")
            res = mdl.transcribe(audio_path)
            transcript = res["text"]
        except ImportError:
            transcript = "[Whisper not installed]"
        lat = (time.perf_counter() - t0) * 1000
        _bump(cid, "whisperStt", lat)
        await mgr.send(cid, "stt_result", {
            "node_id": nid,
            "transcript": transcript,
            "latency_ms": round(lat, 1),
        })
    finally:
        Path(audio_path).unlink(missing_ok=True)


async def _h_gen_workflow(cid: str, p: dict):
    """AI pipeline generation from natural language description."""
    desc = p.get("description", "")
    if not desc.strip():
        await mgr.send(cid, "workflow_generated", {"nodes": [], "edges": [], "error": "Empty description"})
        return
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.gen_workflow, desc
    )
    error = result.pop("error", None)
    await mgr.send(cid, "workflow_generated", {
        "nodes": result.get("nodes", []),
        "edges": result.get("edges", []),
        "error": error,
    })


async def _h_chat(cid: str, p: dict):
    """Chat-based workflow refinement."""
    prompt = p.get("prompt", "")
    current_wf = p.get("current_workflow")
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.chat_refine, prompt, current_wf
    )
    await mgr.send(cid, "chat_result", result)


async def _h_auto_connect(cid: str, p: dict):
    """AI-powered auto-connect suggestion."""
    nodes = p.get("nodes", [])
    existing_edges = p.get("existing_edges", [])
    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.auto_connect, nodes, existing_edges
    )
    await mgr.send(cid, "auto_connect_result", {"edges": result})


async def _h_email(cid: str, p: dict):
    """Send email via SMTP."""
    nid = p.get("node_id", "")
    try:
        smtp_user = os.getenv("LUMINA_SMTP_USER", "")
        smtp_pass = os.getenv("LUMINA_SMTP_PASS", "")
        smtp_host = os.getenv("LUMINA_SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("LUMINA_SMTP_PORT", "587"))
        if not smtp_user:
            raise ValueError("SMTP not configured")
        msg = MIMEText(p.get("body", ""))
        msg["Subject"] = p.get("subject", "Lumina Alert")
        msg["From"] = smtp_user
        msg["To"] = p.get("to", smtp_user)
        with smtplib.SMTP(smtp_host, smtp_port) as s:
            s.ehlo(); s.starttls(); s.login(smtp_user, smtp_pass)
            s.send_message(msg)
        log_ev("email", nid, {"to": p.get("to"), "subject": p.get("subject")})
        await mgr.send(cid, "email_sent", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "email_sent", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_sms(cid: str, p: dict):
    """Send SMS via Twilio."""
    nid = p.get("node_id", "")
    try:
        sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        token = os.getenv("TWILIO_AUTH_TOKEN", "")
        from_num = os.getenv("TWILIO_FROM_NUMBER", "")
        if not sid:
            raise ValueError("Twilio not configured")
        from twilio.rest import Client
        client = Client(sid, token)
        client.messages.create(body=p.get("body", ""), from_=from_num, to=p.get("to", ""))
        log_ev("sms", nid, {"to": p.get("to")})
        await mgr.send(cid, "sms_sent", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "sms_sent", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_discord(cid: str, p: dict):
    """Send Discord webhook message."""
    nid = p.get("node_id", "")
    url = p.get("webhook_url", "")
    if not url:
        await mgr.send(cid, "discord_sent", {"node_id": nid, "ok": False, "error": "No webhook URL"})
        return
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(url, json={"content": p.get("message", "Lumina Alert")})
        log_ev("discord", nid, {"status": r.status_code})
        await mgr.send(cid, "discord_sent", {"node_id": nid, "ok": r.status_code < 300})
    except Exception as e:
        await mgr.send(cid, "discord_sent", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_slack(cid: str, p: dict):
    """Send Slack webhook message."""
    nid = p.get("node_id", "")
    url = p.get("webhook_url", "")
    if not url:
        await mgr.send(cid, "slack_sent", {"node_id": nid, "ok": False, "error": "No webhook URL"})
        return
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(url, json={
                "text": p.get("message", "Lumina Alert"),
                "channel": p.get("channel", ""),
            })
        await mgr.send(cid, "slack_sent", {"node_id": nid, "ok": r.status_code < 300})
    except Exception as e:
        await mgr.send(cid, "slack_sent", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_mqtt(cid: str, p: dict):
    """Publish MQTT message."""
    nid = p.get("node_id", "")
    try:
        import paho.mqtt.client as mqtt
        client = mqtt.Client()
        host = p.get("host", "broker.hivemq.com")
        port = p.get("port", 1883)
        client.connect(host, port, 10)
        client.publish(p.get("topic", "lumina/alert"), p.get("payload", ""))
        client.disconnect()
        await mgr.send(cid, "mqtt_sent", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "mqtt_sent", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_script(cid: str, p: dict):
    """Execute a Python script in a sandboxed subprocess."""
    nid = p.get("node_id", "")
    script = p.get("script", "")
    input_data = p.get("input", "")
    if not script.strip():
        await mgr.send(cid, "script_result", {"node_id": nid, "output": "", "error": "Empty script"})
        return
    script_path = Path(f"/tmp/lumina_script_{uuid.uuid4().hex[:8]}.py")
    try:
        wrapped = f"""
import sys, json
_input = {json.dumps(input_data)}
{script}
"""
        script_path.write_text(wrapped)
        proc = await asyncio.create_subprocess_exec(
            "python", str(script_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        except asyncio.TimeoutError:
            proc.kill()
            await mgr.send(cid, "script_result", {"node_id": nid, "output": "", "error": "Timeout"})
            return
        out = stdout.decode()
        err = stderr.decode()
        await mgr.send(cid, "script_result", {
            "node_id": nid,
            "output": out,
            "error": err if err else None,
        })
    finally:
        script_path.unlink(missing_ok=True)


# ── Gemini Live handlers ──────────────────────────────────────────────────────

_live_sessions: dict[str, object] = {}


async def _h_gemini_live_start(cid: str, p: dict):
    """Start a Gemini Live session for real-time streaming analysis."""
    nid = p.get("node_id", "")
    try:
        from gemini_live import GeminiLiveSession
        session = GeminiLiveSession(
            system_prompt=p.get("system_prompt", "Analyze each frame and describe what you see."),
            on_response=lambda text, nid=nid: asyncio.create_task(
                mgr.send(cid, "gemini_live_response", {"node_id": nid, "text": text})
            )
        )
        await session.start()
        _live_sessions[f"{cid}:{nid}"] = session
        await mgr.send(cid, "gemini_live_started", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "gemini_live_started", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_gemini_live_frame(cid: str, p: dict):
    """Send a frame to an active Gemini Live session."""
    nid = p.get("node_id", "")
    key = f"{cid}:{nid}"
    session = _live_sessions.get(key)
    if session:
        await session.send_frame(p.get("image", ""), p.get("prompt", ""))
    else:
        # Fallback: use regular VLM
        result = await asyncio.get_event_loop().run_in_executor(
            None, brain.run_v, p.get("image", ""), p.get("prompt", "What do you see?"), cid
        )
        await mgr.send(cid, "gemini_live_response", {
            "node_id": nid,
            "text": result.get("analysis", ""),
            "latency_ms": result.get("latency_ms", 0),
        })


async def _h_gemini_live_stop(cid: str, p: dict):
    """Stop a Gemini Live session."""
    nid = p.get("node_id", "")
    key = f"{cid}:{nid}"
    session = _live_sessions.pop(key, None)
    if session:
        await session.stop()
    await mgr.send(cid, "gemini_live_stopped", {"node_id": nid})


# ── Tool Use / Function Calling handler ──────────────────────────────────────

async def _h_tool_use(cid: str, p: dict):
    """Gemini function calling - decide whether to invoke a tool based on input."""
    nid = p.get("node_id", "")
    input_text = p.get("input_text", "")
    tool_name = p.get("tool_name", "external_tool")
    tool_desc = p.get("tool_description", "A useful tool")
    tool_params = p.get("tool_parameters", {})
    call_url = p.get("call_url", "")

    result = await asyncio.get_event_loop().run_in_executor(
        None, brain.run_tool_use, input_text, tool_name, tool_desc, tool_params
    )
    called = result.get("called", False)
    args = result.get("args", {})

    if called and call_url:
        try:
            async with httpx.AsyncClient() as client:
                http_res = await client.post(call_url, json=args, timeout=10)
                result["http_response"] = http_res.text[:500]
        except Exception as e:
            result["http_error"] = str(e)

    await mgr.send(cid, "tool_use_result", {"node_id": nid, **result})


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("LUMINA_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
