import os
import time
import logging
import subprocess
import httpx
try:
    import google.generativeai as genai
except ImportError:
    genai = None

log = logging.getLogger("lumina.brain")

NX_API = "http://127.0.0.1:18181"
OL_API = "http://127.0.0.1:11434"
V_MDL = "NexaAI/OmniNeural-4B"
OL_LLM = os.environ.get("OLLAMA_LLM_MODEL", "gemma3:latest")
OL_VLM = os.environ.get("OLLAMA_VLM_MODEL", "gemma3:latest")

def _is_junk(t: str) -> bool:
    if not t or len(t) < 20: return False
    t = t.strip()
    for n in range(2, 11):
        s = t[:n]
        if not s.strip(): continue
        if t.count(s) * n >= 0.5 * len(t): return True
    return False

class Brain:
    def __init__(self):
        self.v_on = False
        self.l_on = False
        self.nx_p = None
        self.ol_p = None
        self.use_gt = False
        self.use_gv = False
        self.use_ol = False
        self.ol_mdls = []

        key = os.environ.get("GOOGLE_API_KEY")
        f_ot = os.environ.get("LUMINA_USE_OLLAMA_FOR_TEXT", "").lower() == "true"
        f_ov = os.environ.get("LUMINA_USE_OLLAMA_FOR_VISION", "").lower() == "true"

        if key and genai:
            try:
                genai.configure(api_key=key)
                self.g_mdl = genai.GenerativeModel("gemini-2.0-flash")
                self.use_gt = not f_ot
                self.use_gv = not f_ov
                log.info(f"Gemini: T={self.use_gt}, V={self.use_gv}")
            except Exception as e:
                log.error(f"Gemini err: {e}")

        if not self._ck_ol():
            try:
                self.ol_p = subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(10):
                    time.sleep(1)
                    if self._ck_ol(): break
            except: pass

        if self._ck_ol():
            try:
                r = httpx.get(f"{OL_API}/api/tags", timeout=2)
                self.use_ol = True
                self.ol_mdls = [m["name"] for m in r.json().get("models", [])]
            except: pass

    def load_v(self, m: str = "NexaAI/OmniNeural-4B"):
        global V_MDL
        V_MDL = m
        if self._ck_nx():
            self.v_on = True
            return
        try:
            self.nx_p = subprocess.Popen(["nexa", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for i in range(30):
                time.sleep(1)
                if self._ck_nx():
                    self.v_on = True
                    return
        except: pass

    def load_l(self):
        self.l_on = self.v_on

    def _ck_nx(self) -> bool:
        try: return httpx.get(f"{NX_API}/v1/models", timeout=1).status_code == 200
        except: return False

    def _ck_ol(self) -> bool:
        try: return httpx.get(f"{OL_API}/api/tags", timeout=1).status_code == 200
        except: return False

    @property
    def v_rdy(self) -> bool:
        ol_v = any(m.startswith(("llava", "moondream", "gemma3")) for m in self.ol_mdls)
        return self.use_gv or self.v_on or ol_v

    @property
    def l_rdy(self) -> bool:
        return self.use_gt or self.l_on or self.use_ol

    def run_v(self, img: str, p: str = "Describe", cid: str = "") -> dict:
        t0 = time.perf_counter()
        if not self.v_rdy: return {"analysis": "[Not ready]", "latency_ms": 0}
        if self.use_gv: return self._v_g(img, p)
        if self.v_on: pass
        elif self.use_ol:
            m = next((m for m in self.ol_mdls if m.startswith(("moondream", "llava", "gemma3"))), None)
            if m: return self._v_ol(img, p, m)
        return {"analysis": "[No engine]", "latency_ms": 0}

    def _v_g(self, img: str, p: str) -> dict:
        import base64 as b64
        t0 = time.perf_counter()
        try:
            if "," in img: img = img.split(",")[1]
            data = b64.b64decode(img)
            res = self.g_mdl.generate_content([p, {"mime_type": "image/jpeg", "data": data}])
            txt = res.text
        except Exception as e:
            log.error(f"G-V err: {e}")
            if self.use_ol:
                m = next((m for m in self.ol_mdls if m.startswith(("moondream", "llava", "gemma3"))), None)
                if m: return self._v_ol(img, p, m)
            txt = f"Err: {e}"
        dt = (time.perf_counter() - t0) * 1000
        return {"analysis": txt, "latency_ms": round(dt, 1)}

    def _v_ol(self, img: str, p: str, m: str) -> dict:
        t0 = time.perf_counter()
        try:
            if "," in img: img = img.split(",")[1]
            req = {"model": m, "prompt": p, "images": [img], "stream": False}
            r = httpx.post(f"{OL_API}/api/generate", json=req, timeout=60)
            txt = r.json().get("response", "")
        except Exception as e: txt = f"OL-V err: {e}"
        return {"analysis": txt, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}

    def gen_txt(self, p: str, max_tk: int = 1024, is_json: bool = False) -> dict:
        if self.use_gt:
            try:
                res = self.g_mdl.generate_content(p)
                return {"text": res.text}
            except Exception as e:
                log.error(f"G-T err: {e}")
        if self.use_ol:
            try:
                req = {"model": OL_LLM, "prompt": p, "stream": False}
                r = httpx.post(f"{OL_API}/api/generate", json=req, timeout=60)
                return {"text": r.json().get("response", "")}
            except Exception as e: return {"text": f"Err: {e}"}
        return {"text": "[No LLM]"}

    def shut(self):
        if self.nx_p: self.nx_p.terminate()
        if self.ol_p: self.ol_p.terminate()
