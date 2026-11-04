import asyncio
import base64
import json
import logging
import os
import smtplib
import subprocess
import tempfile
import uuid
import time
from contextlib import asynccontextmanager
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path

import httpx
import sqlite3
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import numpy as np

from ai_engine import AIEngine
from vision import Vision
from audio import Audio

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


def _db() -> sqlite3.Connection:
    """Open a connection with WAL journal mode and a 30s busy timeout so
    concurrent reads never fail with 'database is locked'."""
    conn = sqlite3.connect(DB, timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    with _db() as conn:
        # Column names match what log_ev() inserts: ts, type, nid, data, img
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
    with _db() as conn:
        conn.execute(
            "INSERT INTO history VALUES (?,?,?,?,?,?)",
            (eid, ts, t, nid, json.dumps(d), p)
        )


# ── Singletons ──────────────────────────────────────────────────────────────

brain = AIEngine()
_vis: Vision | None = None
_aud: Audio | None = None
_last_pipeline_result: dict | None = None   # sent to new WS clients on connect
_whisper_model = None                        # cached — loading takes 3-5s, do it once

def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper as _whisper
            _whisper_model = _whisper.load_model("base")
            log.info("Whisper STT model loaded (cached)")
        except Exception as e:
            # ImportError  → whisper package not installed
            # FileNotFoundError (WinError 2) → ffmpeg missing from PATH
            # RuntimeError → torch/model download failure
            log.warning(f"Whisper load failed (ffmpeg installed? whisper package?): {e}")
    return _whisper_model

# Pre-load test scene as the default frame so the pipeline always has something
# meaningful to analyze even without a camera connected.
def _load_test_scene() -> "np.ndarray":
    import cv2 as _cv2
    p = Path("test_scene.jpg")
    if p.exists():
        f = _cv2.imread(str(p))
        if f is not None:
            log.info("Loaded test_scene.jpg as default frame")
            return f
    # Fallback: plain grey frame
    return np.ones((480, 640, 3), dtype=np.uint8) * 80

_last_frame: "np.ndarray" = _load_test_scene()


def get_v() -> Vision | None:
    global _vis
    if not _vis:
        p = Path("m/yolov8n.onnx")
        if p.exists():
            _vis = Vision(str(p))
    return _vis


def get_a() -> Audio | None:
    global _aud
    if not _aud:
        m, l = Path("m/yamnet.onnx"), Path("m/yamnet_class_map.csv")
        if m.exists() and l.exists():
            _aud = Audio(str(m), str(l))
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
                "uptime_sec": int(time.time() - BOOT_TIME),
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
    # Warm the local LLM in the background so the first user request is fast,
    # not a ~80s cold load. Non-blocking — startup completes immediately.
    asyncio.create_task(asyncio.to_thread(brain.warmup))
    yield
    brain.shut()


app = FastAPI(lifespan=life)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── REST helpers ─────────────────────────────────────────────────────────────

async def _body(req: Request) -> dict:
    """Parse request body as JSON or form-data — accepts whatever n8n sends."""
    ct = req.headers.get("content-type", "")
    if "application/json" in ct:
        try:
            return await req.json()
        except Exception:
            pass
    if "application/x-www-form-urlencoded" in ct or "multipart/form-data" in ct:
        form = await req.form()
        return {k: v for k, v in form.items()}
    # Fallback: try JSON first, then form
    try:
        return await req.json()
    except Exception:
        try:
            form = await req.form()
            return {k: v for k, v in form.items()}
        except Exception:
            return {}


# ── REST Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_sec": int(time.time() - BOOT_TIME),
        "vlm_ready": brain.v_rdy,
        "llm_ready": brain.l_rdy,
        "vision_model": "yolov8n" if get_v() else None,
        "audio_model": "yamnet" if get_a() else None,
    }


@app.get("/api/history")
async def get_history():
    with _db() as conn:
        rows = conn.execute(
            "SELECT id,ts,type,nid,data,img FROM history ORDER BY ts DESC LIMIT 100"
        ).fetchall()
    return [
        {"id": r[0], "timestamp": r[1], "node_type": r[2], "node_id": r[3],
         "data": json.loads(r[4] or "{}"), "image": r[5]}
        for r in rows
    ]


@app.get("/api/dashboard")
async def get_dashboard():
    with _db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]
        types = conn.execute(
            "SELECT type, COUNT(*) FROM history GROUP BY type"
        ).fetchall()
    return {
        "uptime_sec": int(time.time() - BOOT_TIME),
        "total_events": total,
        "stats": {t: c for t, c in types},
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


@app.post("/api/export/nodered")
async def export_nodered(graph: dict):
    from export_nodered import compile_to_nodered
    flow = compile_to_nodered(graph)
    return Response(
        content=json.dumps(flow, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=lumina-nodered-flow.json"},
    )


@app.post("/api/export/nodered/push")
async def push_to_nodered(graph: dict):
    """Compile the Lumina graph to Node-RED format and deploy it live to the
    local Node-RED instance (default http://localhost:1880).
    Uses the Node-RED v1 REST API (plain array POST, no revision header needed).
    """
    from export_nodered import compile_to_nodered
    nr_url = os.getenv("NODERED_URL", "http://localhost:1880")
    flow = compile_to_nodered(graph)
    flow_json = json.dumps(flow)
    try:
        async with httpx.AsyncClient() as client:
            # v1 API: POST /flows with raw JSON array — no Node-RED-API-Version header
            r = await client.post(
                f"{nr_url}/flows",
                content=flow_json,
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
        if r.status_code in (200, 204):
            return {"status": "deployed", "http": r.status_code, "node_count": len(flow)}
        else:
            return {"status": "error", "http": r.status_code, "detail": r.text[:200]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.post("/api/pipeline-result")
async def pipeline_result(req: Request):
    """Receive results from Node-RED and broadcast to all Lumina canvas clients.
    Also stored so new clients get it immediately on WebSocket connect."""
    global _last_pipeline_result
    p = await _body(req)
    ts = datetime.now().strftime("%H:%M:%S")
    payload = {
        "source":           p.get("source", "node-red"),
        "timestamp":        ts,
        "detections":       p.get("detections", []),
        "detection_output": p.get("detection_output", ""),
        "vlm_analysis":     p.get("vlm_analysis", ""),
        "latency_ms":       p.get("latency_ms", 0),
        "image":            p.get("image", ""),
    }
    _last_pipeline_result = payload
    log_ev("pipeline_result", "", {k: v for k, v in payload.items() if k != "image"})
    await mgr.broadcast("pipeline_result", payload)
    return {"status": "ok", "timestamp": ts}


# ── REST AI Endpoints (Supporting n8n/External calls) ─────────────────────────

@app.post("/api/detect")
async def rest_detect(req: Request):
    return await _h_detect_logic(await _body(req))

@app.post("/api/vlm")
async def rest_vlm(req: Request):
    return await _h_vlm_logic(await _body(req))

@app.post("/api/llm")
async def rest_llm(req: Request):
    return await _h_llm_logic(await _body(req))

@app.post("/api/face-match")
async def rest_face_match(req: Request):
    return await _h_face_match_logic(await _body(req))

@app.post("/api/ocr")
async def rest_ocr(req: Request):
    return await _h_ocr_logic(await _body(req))

@app.post("/api/pose")
async def rest_pose(req: Request):
    return await _h_pose_logic(await _body(req))

@app.post("/api/audio-detect")
async def rest_audio_detect(req: Request):
    return await _h_audio_logic(await _body(req))

@app.post("/api/audio-llm")
async def rest_audio_llm(req: Request):
    return await _h_audio_llm_logic(await _body(req))

@app.post("/api/whisper")
async def rest_whisper(req: Request):
    return await _h_whisper_logic(await _body(req))

@app.post("/api/tool-use")
async def rest_tool_use(req: Request):
    return await _h_tool_use_logic(await _body(req))

@app.post("/api/notify")
async def rest_notify(req: Request):
    p = await _body(req)
    await mgr.broadcast("notification", {"message": p.get("message", "Alert")})
    return {"status": "ok"}

@app.post("/api/screenshot")
async def rest_screenshot(req: Request):
    base = os.getenv("LUMINA_BASE_URL", "http://localhost:8000").rstrip("/")
    return {"status": "ok", "output": "screenshot", "url": f"{base}/latest_screenshot.jpg"}

@app.post("/api/sound")
async def rest_sound(req: Request):
    p = await _body(req)
    await mgr.broadcast("sound_alert", {"sound": p.get("sound", "alert")})
    return {"status": "ok", "output": "sound triggered"}

@app.post("/api/speak")
async def rest_speak(req: Request):
    p = await _body(req)
    await mgr.broadcast("speak", {"text": p.get("text", "")})
    return {"status": "ok", "output": "speaking"}

@app.post("/api/sms")
async def rest_sms(req: Request):
    """SMS via Twilio — called by Node-RED smsAction nodes."""
    p = await _body(req)
    # Reuse the WebSocket SMS handler with a dummy cid; mgr.send silently ignores unknown cids
    await _h_sms("_rest_", p)
    return {"status": "ok"}

@app.post("/api/google-sheets")
async def rest_google_sheets(req: Request):
    """Google Sheets append — stub endpoint (real impl requires OAuth2 setup)."""
    p = await _body(req)
    log.info(f"[google-sheets] sheet_id={p.get('sheet_id','')} row={str(p)[:120]}")
    return {"status": "ok", "message": "Logged (full Google Sheets OAuth2 requires credentials setup)"}

@app.post("/api/gemini-live")
async def rest_gemini_live(req: Request):
    """Gemini Live REST fallback for Node-RED — delegates to standard VLM logic."""
    return await _h_vlm_logic(await _body(req))


def _capture_frame_sync(source: str, url: str = "") -> tuple:
    """Blocking camera capture — must be run in a thread executor."""
    import cv2
    if source == "ip_camera":
        if not url:
            return None, "No IP camera URL"
        cap = cv2.VideoCapture(url)
    else:
        cap = cv2.VideoCapture(0)

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    ret, frame = cap.read()
    cap.release()
    if ret and frame is not None:
        return frame, None
    return None, "Camera not available"


@app.post("/api/capture")
async def rest_capture(req: Request):
    """Return the latest captured frame as base64 JPEG.
    Runs camera I/O in a thread so the async loop never blocks.
    Falls back to _last_frame if camera is unavailable.
    Falls back to a 320x240 black test image if no frame exists at all."""
    import cv2
    p = await _body(req)
    source = p.get("source", "camera")

    frame = None

    # 1. Try to grab a live frame (non-blocking via thread executor)
    if source in ("camera", "ip_camera"):
        url = p.get("url", "")
        try:
            frame, err = await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(
                    None, _capture_frame_sync, source, url
                ),
                timeout=4.0,   # give up after 4s
            )
        except asyncio.TimeoutError:
            frame, err = None, "Camera read timed out"
        # Reject blank/dark frames (mean < 8 = essentially all black = no camera feed)
        if frame is not None and frame.mean() < 8:
            log.warning("[capture] Camera returned blank frame — falling back to last/test frame")
            frame = None
        if frame is None:
            log.warning(f"[capture] {err or 'blank frame'} — falling back")

    # 2. Fall back to last WebSocket frame from the Lumina canvas
    if frame is None and _last_frame is not None:
        frame = _last_frame.copy()

    # 3. Fall back to the bundled test scene (has monitor, person, keyboard, chair)
    if frame is None:
        test_path = Path("test_scene.jpg")
        if test_path.exists():
            frame = cv2.imread(str(test_path))
        if frame is None:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "No Camera", (200, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (200, 200, 200), 2)

    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    image_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode()
    return {"output": image_b64, "image": image_b64}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    cid = await mgr.connect(ws)
    clients[cid] = {"tel": {"execution_counts": {}, "latencies": {}}}
    log.info(f"Client connected: {cid}")
    # Immediately push the last pipeline result so the panel appears right away
    if _last_pipeline_result:
        await mgr.send(cid, "pipeline_result", _last_pipeline_result)
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
        elif t == "file_append":
            await _h_file_append(cid, p)
        elif t == "gsheets_append":
            await _h_gsheets_append(cid, p)
        elif t == "ip_camera_connect":
            await _h_ip_camera(cid, p)
        elif t == "gemini_live_start":
            await _h_gemini_live_start(cid, p)
        elif t == "gemini_live_frame":
            await _h_gemini_live_frame(cid, p)
        elif t == "gemini_live_stop":
            await _h_gemini_live_stop(cid, p)
        elif t == "tool_use":
            await _h_tool_use(cid, p)
        elif t == "face_match":
            await _h_face_match(cid, p)
        elif t == "ocr":
            await _h_ocr(cid, p)
        elif t == "pose":
            await _h_pose(cid, p)
    except Exception as e:
        log.error(f"Handler error [{t}]: {e}", exc_info=True)
        nid = p.get("node_id", "")
        await mgr.send(cid, f"{t}_error", {"node_id": nid, "error": str(e)})


# ── Individual handlers ───────────────────────────────────────────────────────

def _decode_b64_image(raw: str):
    """base64 (optionally data-URI) → BGR ndarray, or None."""
    import cv2
    if not raw:
        return None
    if "," in raw:
        raw = raw.split(",")[1]
    buf = np.frombuffer(base64.b64decode(raw), np.uint8)
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def _blocking_detect(v, frame, conf_thresh=None):
    """CPU-bound: optionally set threshold, run YOLO, format detections.
    Runs in a thread-pool executor so it never blocks the event loop."""
    if conf_thresh is not None:
        old = v.conf
        v.conf = conf_thresh
        try:
            hits = v.run(frame)
        finally:
            v.conf = old
    else:
        hits = v.run(frame)
    return [
        {"label": COCO_LABELS[h["cid"]] if h["cid"] < len(COCO_LABELS) else "unknown",
         "confidence": round(h["conf"] * 100),
         "bbox": h["box"]}
        for h in hits
    ]


async def _h_frame(cid: str, p: dict):
    """Camera frame → run YOLO → send detect_res for live preview."""
    v = get_v()
    if not v:
        return
    loop = asyncio.get_running_loop()
    frame = await loop.run_in_executor(None, _decode_b64_image, p.get("image", ""))
    if frame is None:
        return

    global _last_frame
    _last_frame = frame

    t0 = time.perf_counter()
    detections = await loop.run_in_executor(None, _blocking_detect, v, frame)
    lat = (time.perf_counter() - t0) * 1000
    await mgr.send(cid, "detect_res", {
        "node_id": p.get("node_id"),
        "hits": detections,
        "latency_ms": round(lat, 1),
    })


async def _h_detect(cid: str, p: dict):
    """Explicit detection request from DetectionNode."""
    res = await _h_detect_logic(p)
    if "latency_ms" in res:
        _bump(cid, "detection", res["latency_ms"])
    await mgr.send(cid, "detect_result", res)


async def _h_detect_logic(p: dict) -> dict:
    v = get_v()
    nid = p.get("node_id", "")
    if not v:
        return {"node_id": nid, "detections": [], "error": "No model"}
    loop = asyncio.get_running_loop()

    raw = p.get("image", "")
    frame = await loop.run_in_executor(None, _decode_b64_image, raw) if raw else None

    # Fallback to last live frame — do NOT re-decode raw (it is empty here)
    if frame is None and _last_frame is not None:
        frame = _last_frame.copy()

    if frame is None:
        return {"node_id": nid, "detections": [], "error": "No image provided and no live frame available"}

    conf_thresh = p.get("confidence", 45) / 100.0
    t0 = time.perf_counter()
    detections = await loop.run_in_executor(None, _blocking_detect, v, frame, conf_thresh)
    lat = (time.perf_counter() - t0) * 1000

    # Collapse duplicate labels in the summary string while keeping order
    seen, ordered = set(), []
    for d in detections:
        if d["label"] not in seen:
            seen.add(d["label"]); ordered.append(d["label"])

    log_ev("detect", nid, {"count": len(detections)})
    return {
        "node_id": nid,
        "detections": detections,
        "output": ", ".join(ordered) if ordered else "no detections",
        "latency_ms": round(lat, 1),
    }


async def _h_vlm(cid: str, p: dict):
    """VLM visual analysis request."""
    res = await _h_vlm_logic(p)
    await mgr.send(cid, "vlm_result", res)


async def _h_vlm_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    image_data = p.get("image", "")
    
    if not image_data and _last_frame is not None:
        import cv2
        _, buf = cv2.imencode(".jpg", _last_frame)
        image_data = base64.b64encode(buf).decode()

    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.run_v, image_data, p.get("prompt", "Describe what you see")
    )
    log_ev("vlm", nid, {"analysis": result.get("analysis", "")[:200]})
    return {"node_id": nid, **result}


async def _h_audio(cid: str, p: dict):
    """YamNet audio classification."""
    res = await _h_audio_logic(p)
    if "latency_ms" in res:
        _bump(cid, "audioDetect", res["latency_ms"])
    await mgr.send(cid, "audio_result", res)


def _blocking_audio(a, audio_bytes):
    """CPU-bound: decode WAV/PCM → 96x64 patch → YamNet. Runs in executor."""
    import io, wave
    try:
        with io.BytesIO(audio_bytes) as bio:
            with wave.open(bio, "rb") as wf:
                frames = wf.readframes(wf.getnframes())
                samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception:
        samples = np.frombuffer(audio_bytes, dtype=np.float32)
    target = 96 * 64
    if len(samples) >= target:
        samples = samples[:target]
    else:
        samples = np.pad(samples, (0, target - len(samples)))
    return a.run(samples.reshape(96, 64).tolist())


async def _h_audio_logic(p: dict) -> dict:
    a = get_a()
    nid = p.get("node_id", "")
    if not a:
        return {"node_id": nid, "events": [], "error": "No model"}
    raw = p.get("audio", "")
    if not raw:
        return {"node_id": nid, "events": [], "error": "No audio provided"}
    if "," in raw:
        raw = raw.split(",")[1]
    t0 = time.perf_counter()
    audio_bytes = base64.b64decode(raw)
    events = await asyncio.get_running_loop().run_in_executor(
        None, _blocking_audio, a, audio_bytes
    )
    lat = (time.perf_counter() - t0) * 1000
    conf_thresh = p.get("confidence", 20) / 100.0
    filtered = [e for e in events if e["conf"] >= conf_thresh]
    top = filtered[0] if filtered else None
    log_ev("audio", nid, {"top": top})
    return {
        "node_id": nid,
        "events": filtered[:10],
        "top_class": top["label"] if top else None,
        "confidence": round(top["conf"] * 100) if top else 0,
        "latency_ms": round(lat, 1),
    }


async def _h_audio_llm(cid: str, p: dict):
    """LLM analysis of audio transcription / description."""
    res = await _h_audio_llm_logic(p)
    await mgr.send(cid, "audio_llm_result", res)


async def _h_audio_llm_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    prompt = p.get("prompt", "Analyze this audio")
    context = p.get("context", "")
    full_prompt = f"{prompt}\n\nAudio context: {context}" if context else prompt
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.gen_txt, full_prompt, 512, False
    )
    return {
        "node_id": nid,
        "analysis": result.get("text", ""),
    }


async def _h_text_gen(cid: str, p: dict):
    """LLM text generation."""
    res = await _h_llm_logic(p)
    if "latency_ms" in res:
        _bump(cid, "llm", res["latency_ms"])
    await mgr.send(cid, "text_result", res)


async def _h_llm_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    t0 = time.perf_counter()
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.gen_txt, p.get("prompt", ""), p.get("max_tokens", 512), False
    )
    lat = (time.perf_counter() - t0) * 1000
    log_ev("text_gen", nid, {"preview": result.get("text", "")[:100]})
    return {
        "node_id": nid,
        "text": result.get("text", ""),
        "latency_ms": round(lat, 1),
    }


async def _h_whisper(cid: str, p: dict):
    """Whisper speech-to-text."""
    res = await _h_whisper_logic(p)
    if "latency_ms" in res:
        _bump(cid, "whisperStt", res["latency_ms"])
    await mgr.send(cid, "stt_result", res)


def _blocking_whisper(mdl, samples):
    """CPU-bound transcription. Passing a float32 ndarray (not a file path)
    makes Whisper skip its internal ffmpeg decode entirely — the mic already
    delivers 16 kHz mono float32 PCM, exactly what Whisper wants."""
    return mdl.transcribe(samples, fp16=False)["text"].strip()


async def _h_whisper_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    raw = p.get("audio", "")
    if not raw:
        return {"node_id": nid, "transcript": "", "error": "No audio"}
    if "," in raw:
        raw = raw.split(",")[1]
    mdl = _get_whisper_model()
    if mdl is None:
        return {"node_id": nid,
                "transcript": "[Whisper not installed — run: pip install openai-whisper]"}
    t0 = time.perf_counter()
    try:
        # Mic sends raw float32 PCM @ 16 kHz mono (no WAV header). Decode to an
        # ndarray and hand it straight to Whisper — no temp file, no ffmpeg.
        samples = np.frombuffer(base64.b64decode(raw), dtype=np.float32).copy()
        if samples.size == 0:
            return {"node_id": nid, "transcript": "", "error": "Empty audio"}
        transcript = await asyncio.get_running_loop().run_in_executor(
            None, _blocking_whisper, mdl, samples
        )
        if not transcript:
            transcript = "[no speech detected]"
    except Exception as e:
        transcript = f"[Whisper error: {e}]"
    lat = (time.perf_counter() - t0) * 1000
    log_ev("whisper", nid, {"transcript": transcript[:200]})
    return {
        "node_id": nid,
        "transcript": transcript,
        "latency_ms": round(lat, 1),
    }


async def _h_gen_workflow(cid: str, p: dict):
    """AI pipeline generation from natural language description.

    Broadcasts the result (rather than sending to one cid) because local-model
    generation can take ~90s on CPU, during which the canvas socket may
    reconnect — broadcasting ensures whichever connection is live receives it.
    """
    desc = p.get("description", "")
    if not desc.strip():
        await mgr.broadcast("workflow_generated", {"nodes": [], "edges": [], "error": "Empty description"})
        return
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.gen_workflow, desc
    )
    error = result.pop("error", None)
    await mgr.broadcast("workflow_generated", {
        "nodes": result.get("nodes", []),
        "edges": result.get("edges", []),
        "error": error,
    })


async def _h_chat(cid: str, p: dict):
    """Chat-based workflow refinement."""
    prompt = p.get("prompt", "")
    current_wf = p.get("current_workflow")
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.chat_refine, prompt, current_wf
    )
    await mgr.broadcast("chat_result", result)


async def _h_auto_connect(cid: str, p: dict):
    """AI-powered auto-connect suggestion."""
    nodes = p.get("nodes", [])
    existing_edges = p.get("existing_edges", [])
    description = p.get("description", "")
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.auto_connect, nodes, existing_edges, description
    )
    await mgr.broadcast("auto_connect_result", {"edges": result})


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
    script_path = Path(tempfile.gettempdir()) / f"lumina_script_{uuid.uuid4().hex[:8]}.py"
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


async def _h_file_append(cid: str, p: dict):
    """Append a line of content to a file under the workspace root."""
    nid = p.get("node_id", "")
    path = (p.get("path") or "").strip()
    content = p.get("content", "")
    try:
        if not path:
            raise ValueError("No file path")
        rel = Path(path)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError("Path must be relative to the workspace root")
        full = Path.cwd() / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        text = content if isinstance(content, str) else json.dumps(content)
        await asyncio.get_running_loop().run_in_executor(
            None, lambda: full.open("a", encoding="utf-8").write(text.rstrip("\n") + "\n")
        )
        log_ev("file", nid, {"path": path, "bytes": len(text)})
        await mgr.send(cid, "file_result", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "file_result", {"node_id": nid, "ok": False, "error": str(e)})


async def _h_gsheets_append(cid: str, p: dict):
    """Append a row to Google Sheets. A full write needs OAuth2 credentials;
    without them the row is logged so the pipeline still completes visibly."""
    nid = p.get("node_id", "")
    sheet_id = p.get("spreadsheet_id", "")
    values = p.get("values", [])
    try:
        log.info(f"[gsheets] sheet={sheet_id} range={p.get('range','')} values={str(values)[:120]}")
        log_ev("gsheets", nid, {"spreadsheet_id": sheet_id, "rows": len(values)})
        await mgr.send(cid, "gsheets_result", {"node_id": nid, "ok": True})
    except Exception as e:
        await mgr.send(cid, "gsheets_result", {"node_id": nid, "ok": False, "error": str(e)})


# ── IP Camera streaming ───────────────────────────────────────────────────────

_ip_cams: dict[str, bool] = {}   # node_id -> should-keep-running


async def _h_ip_camera(cid: str, p: dict):
    """Start/stop an RTSP/HTTP camera stream, pushing frames to the canvas."""
    nid = p.get("node_id", "")
    url = (p.get("url") or "").strip()
    if not p.get("active"):
        _ip_cams[nid] = False           # signal the running loop to stop
        return
    if not url:
        await mgr.send(cid, "ip_camera_frame", {"node_id": nid, "image": "", "error": "No stream URL"})
        return
    _ip_cams[nid] = True
    asyncio.create_task(_ip_camera_loop(cid, nid, url))


async def _ip_camera_loop(cid: str, nid: str, url: str):
    import cv2
    loop = asyncio.get_running_loop()

    def _enc(f):
        h, w = f.shape[:2]
        scale = min(1.0, 640 / max(h, w))
        if scale < 1.0:
            f = cv2.resize(f, (int(w * scale), int(h * scale)))
        _, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return base64.b64encode(buf).decode()

    cap = await loop.run_in_executor(None, cv2.VideoCapture, url)
    try:
        if not await loop.run_in_executor(None, cap.isOpened):
            await mgr.send(cid, "ip_camera_frame", {"node_id": nid, "image": "", "error": "Cannot open stream"})
            return
        global _last_frame
        while _ip_cams.get(nid) and cid in mgr.active:
            ok, frame = await loop.run_in_executor(None, cap.read)
            if not ok or frame is None:
                await asyncio.sleep(0.5)
                continue
            _last_frame = frame
            img = await loop.run_in_executor(None, _enc, frame)
            await mgr.send(cid, "ip_camera_frame", {"node_id": nid, "image": img})
            await asyncio.sleep(0.2)    # ~5 fps — plenty for analysis, light on CPU/bandwidth
    finally:
        _ip_cams.pop(nid, None)
        await loop.run_in_executor(None, cap.release)


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
        result = await asyncio.get_running_loop().run_in_executor(
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
    res = await _h_tool_use_logic(p)
    await mgr.send(cid, "tool_use_result", res)


async def _h_tool_use_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    input_text = p.get("input_text", "")
    tool_name = p.get("tool_name", "external_tool")
    tool_desc = p.get("tool_description", "A useful tool")
    tool_params = p.get("tool_parameters", {})
    call_url = p.get("call_url", "")

    result = await asyncio.get_running_loop().run_in_executor(
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

    return {"node_id": nid, **result}


# ── Missing Handlers (Face, OCR, Pose) ────────────────────────────────────────

async def _h_face_match(cid: str, p: dict):
    res = await _h_face_match_logic(p)
    await mgr.send(cid, "face_match_result", res)

async def _h_face_match_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    image_data = p.get("image", "")
    if not image_data and _last_frame is not None:
        import cv2
        _, buf = cv2.imencode(".jpg", _last_frame)
        image_data = base64.b64encode(buf).decode()

    prompt = "Find and describe any faces in this image. Is there a match for the target identity?"
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.run_v, image_data, prompt
    )
    analysis_lower = result.get("analysis", "").lower()
    # True when VLM mentions a face/person — False when scene is empty or explicitly "unknown"
    face_detected = any(kw in analysis_lower for kw in ("face", "person", "people", "human", "man", "woman", "child", "match", "identified"))
    return {"node_id": nid, "analysis": result.get("analysis", ""), "match": face_detected}

async def _h_ocr(cid: str, p: dict):
    res = await _h_ocr_logic(p)
    await mgr.send(cid, "ocr_result", res)

async def _h_ocr_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    prompt = "Extract all text from this image as a structured list."
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.run_v, p.get("image", ""), prompt
    )
    return {"node_id": nid, "text": result.get("analysis", "")}

async def _h_pose(cid: str, p: dict):
    res = await _h_pose_logic(p)
    await mgr.send(cid, "pose_result", res)

async def _h_pose_logic(p: dict) -> dict:
    nid = p.get("node_id", "")
    prompt = "Describe the human poses and keypoints visible in this image."
    result = await asyncio.get_running_loop().run_in_executor(
        None, brain.run_v, p.get("image", ""), prompt
    )
    return {"node_id": nid, "analysis": result.get("analysis", "")}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("LUMINA_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
