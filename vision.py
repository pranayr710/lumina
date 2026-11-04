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

class Vision:
    def __init__(self, mdl: str, conf: float = 0.45, iou: float = 0.45, cpu: bool = False):
        self.mdl_path = mdl
        self.conf = conf
        self.iou = iou          # NMS IoU threshold
        self.cpu = cpu
        self.sess = None
        self.inp_name = None    # cached — avoids a dict lookup per inference
        self.meta = {}
        if ort: self._ld()

    def _ld(self):
        try:
            so = ort.SessionOptions()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.intra_op_num_threads = os.cpu_count() or 4
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            self.sess = ort.InferenceSession(
                self.mdl_path, sess_options=so, providers=["CPUExecutionProvider"]
            )
            self.inp_name = self.sess.get_inputs()[0].name
            log.info(f"Vision ready: {self.mdl_path} (threads={so.intra_op_num_threads})")
        except Exception as e:
            log.error(f"Vision fail: {e}")

    def run(self, frame):
        if not self.sess: return []
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(frame, 1/255.0, (640, 640), swapRB=True, crop=False)
        out = self.sess.run(None, {self.inp_name: blob})[0]

        # YOLOv8 output: [1, 84, 8400] -> [8400, 84]; cols 0-3 box, 4: class scores.
        # Fully vectorised — the old per-row Python loop over 8400 preds was the
        # bottleneck, and emitting every box (no NMS) produced dozens of dupes.
        preds = np.squeeze(out).T
        cls_scores = preds[:, 4:]
        class_ids = np.argmax(cls_scores, axis=1)
        confs = cls_scores[np.arange(cls_scores.shape[0]), class_ids]

        keep = confs > self.conf
        if not np.any(keep):
            return []
        preds, class_ids, confs = preds[keep], class_ids[keep], confs[keep]

        # Scale boxes from 640x640 model space back to original frame
        sx, sy = w / 640.0, h / 640.0
        cx, cy, bw, bh = preds[:, 0], preds[:, 1], preds[:, 2], preds[:, 3]
        x1 = (cx - bw / 2) * sx
        y1 = (cy - bh / 2) * sy
        ww = bw * sx
        hh = bh * sy
        boxes = np.stack([x1, y1, ww, hh], axis=1)

        # Non-max suppression — collapses overlapping detections of the same object
        idxs = cv2.dnn.NMSBoxes(boxes.tolist(), confs.tolist(), self.conf, self.iou)
        if len(idxs) == 0:
            return []
        idxs = np.array(idxs).flatten()

        return [
            {"box": [int(x1[i]), int(y1[i]), int(ww[i]), int(hh[i])],
             "conf": float(confs[i]), "cid": int(class_ids[i])}
            for i in idxs
        ]
