import os
import time
import logging
import numpy as np
import cv2
try:
    import onnxruntime as ort
except ImportError:
    ort = None

log = logging.getLogger("lumina.vis")

class Vis:
    def __init__(self, mdl: str, conf: float = 0.45, cpu: bool = False):
        self.mdl_path = mdl
        self.conf = conf
        self.cpu = cpu
        self.sess = None
        self.meta = {}
        if ort: self._ld()

    def _ld(self):
        try:
            prov = ["CPUExecutionProvider"]
            self.sess = ort.InferenceSession(self.mdl_path, providers=prov)
            log.info(f"Vis ready: {self.mdl_path}")
        except Exception as e:
            log.error(f"Vis fail: {e}")

    def run(self, frame):
        if not self.sess: return []
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(frame, 1/255.0, (640, 640), swapRB=True, crop=False)
        out = self.sess.run(None, {self.sess.get_inputs()[0].name: blob})[0]
        
        preds = np.transpose(np.squeeze(out))
        res = []
        for p in preds:
            scr = np.max(p[4:])
            if scr > self.conf:
                cid = np.argmax(p[4:])
                cx, cy, nw, nh = p[:4]
                x1 = int((cx - nw/2) * w / 640)
                y1 = int((cy - nh/2) * h / 640)
                res.append({"box": [x1, y1, int(nw * w / 640), int(nh * h / 640)], "conf": float(scr), "cid": int(cid)})
        return res
