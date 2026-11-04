import os
import logging
import numpy as np
import csv
try:
    import onnxruntime as ort
except ImportError:
    ort = None

log = logging.getLogger("lumina.aud")

class Audio:
    def __init__(self, mdl: str, lbls: str, conf: float = 0.2):
        self.mdl = mdl
        self.lbl_path = lbls
        self.conf = conf
        self.sess = None
        self.inp_name = None
        self.cls = {}
        self._labels = None     # numpy array for vectorised lookup
        if ort: self._ld()

    def _ld(self):
        try:
            with open(self.lbl_path, "r") as f:
                r = csv.DictReader(f)
                for row in r: self.cls[int(row["index"])] = row["display_name"]
            self._labels = np.array(
                [self.cls.get(i, "Unknown") for i in range(max(self.cls) + 1)]
            )
            so = ort.SessionOptions()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.intra_op_num_threads = os.cpu_count() or 4
            self.sess = ort.InferenceSession(
                self.mdl, sess_options=so, providers=["CPUExecutionProvider"]
            )
            self.inp_name = self.sess.get_inputs()[0].name
            log.info(f"Audio ready: {self.mdl}")
        except Exception as e: log.error(f"Audio fail: {e}")

    def run(self, data):
        if not self.sess: return []
        data = np.array(data, dtype=np.float32).reshape(1, 1, 96, 64)
        out = self.sess.run(None, {self.inp_name: data})[0]
        scores = np.squeeze(out)

        # Vectorised threshold + sort instead of a per-class Python loop
        keep = np.where(scores > self.conf)[0]
        if keep.size == 0:
            return []
        order = keep[np.argsort(scores[keep])[::-1]]
        return [
            {"label": self._labels[i] if i < len(self._labels) else "Unknown",
             "conf": float(scores[i])}
            for i in order
        ]
