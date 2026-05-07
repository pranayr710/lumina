import logging
import numpy as np
import csv
try:
    import onnxruntime as ort
except ImportError:
    ort = None

log = logging.getLogger("lumina.aud")

class Aud:
    def __init__(self, mdl: str, lbls: str, conf: float = 0.2):
        self.mdl = mdl
        self.lbl_path = lbls
        self.conf = conf
        self.sess = None
        self.cls = {}
        if ort: self._ld()

    def _ld(self):
        try:
            with open(self.lbl_path, "r") as f:
                r = csv.DictReader(f)
                for row in r: self.cls[int(row["index"])] = row["display_name"]
            self.sess = ort.InferenceSession(self.mdl, providers=["CPUExecutionProvider"])
            log.info(f"Aud ready: {self.mdl}")
        except Exception as e: log.error(f"Aud fail: {e}")

    def run(self, data):
        if not self.sess: return []
        data = np.array(data, dtype=np.float32).reshape(1, 1, 96, 64)
        out = self.sess.run(None, {self.sess.get_inputs()[0].name: data})[0]
        scores = np.squeeze(out)
        res = []
        for i, s in enumerate(scores):
            if s > self.conf: res.append({"label": self.cls.get(i, "Unknown"), "conf": float(s)})
        return sorted(res, key=lambda x: x["conf"], reverse=True)
