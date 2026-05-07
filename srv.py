import asyncio
import json
import logging
import os
import uuid
import time
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
import sqlite3
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from brain import Brain
from vis import Vis
from aud import Aud

load_dotenv()
log = logging.getLogger("lumina.srv")
DB = "lumina.db"

def init_db():
    with sqlite3.connect(DB) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, ts TEXT, type TEXT, nid TEXT, data TEXT, img TEXT)")

init_db()

def log_ev(t, nid, d, img=None):
    eid = str(uuid.uuid4())
    ts = datetime.now().isoformat()
    p = ""
    if img:
        dr = Path("s")
        dr.mkdir(exist_ok=True)
        p = f"s/{eid}.jpg"
        import base64
        if "," in img: img = img.split(",")[1]
        with open(dr / f"{eid}.jpg", "wb") as f: f.write(base64.b64decode(img))
    with sqlite3.connect(DB) as conn:
        conn.execute("INSERT INTO history VALUES (?,?,?,?,?,?)", (eid, ts, t, nid, json.dumps(d), p))

brain = Brain()
_vis = None
_aud = None

def get_v():
    global _vis
    if not _vis:
        p = Path("m/yolov8n.onnx")
        if p.exists(): _vis = Vis(str(p))
    return _vis

def get_a():
    global _aud
    if not _aud:
        m, l = Path("m/yamnet.onnx"), Path("m/yamnet_class_map.csv")
        if m.exists() and l.exists(): _aud = Aud(str(m), str(l))
    return _aud

class Manager:
    def __init__(self):
        self.active = {}

    async def connect(self, ws):
        await ws.accept()
        cid = str(uuid.uuid4())[:8]
        self.active[cid] = ws
        return cid

    def disconnect(self, cid):
        self.active.pop(cid, None)

    async def send(self, cid, m_type, payload):
        ws = self.active.get(cid)
        if ws:
            try: await ws.send_json({"type": m_type, "payload": payload})
            except: self.disconnect(cid)

mgr = Manager()
clients = {}

@asynccontextmanager
async def life(app: FastAPI):
    log.info("Lumina Srv Starting")
    brain.load_v()
    brain.load_l()
    get_v()
    get_a()
    yield
    brain.shut()

app = FastAPI(lifespan=life)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    cid = await mgr.connect(ws)
    clients[cid] = {"tel": {"execution_counts": {}, "latencies": {}}}
    try:
        while True:
            data = await ws.receive_json()
            t, p = data.get("type"), data.get("payload", {})
            if t == "frame":
                v = get_v()
                if v:
                    import base64 as b64
                    import cv2
                    import numpy as np
                    raw = p.get("image", "")
                    if "," in raw: raw = raw.split(",")[1]
                    buf = np.frombuffer(b64.b64decode(raw), np.uint8)
                    f = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                    hits = v.run(f)
                    await mgr.send(cid, "detect_res", {"node_id": p.get("node_id"), "hits": hits})
            elif t == "vlm":
                res = brain.run_v(p.get("image"), p.get("prompt"))
                await mgr.send(cid, "vlm_res", {"node_id": p.get("node_id"), **res})
    except WebSocketDisconnect:
        mgr.disconnect(cid)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
