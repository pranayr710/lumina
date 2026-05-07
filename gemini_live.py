"""Gemini Live API bridge — real-time bidirectional streaming.

Falls back to standard Gemini generate_content when the Live API
SDK is not available, ensuring the node always works.
"""
import asyncio
import base64
import logging
import os
import time

log = logging.getLogger("lumina.gemini_live")

_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# Try the new google-genai SDK (supports Live API)
try:
    from google import genai as _new_genai
    from google.genai import types as _gtypes
    _HAS_LIVE_SDK = True
    log.info("Gemini Live SDK available (google-genai)")
except ImportError:
    _new_genai = None
    _gtypes = None
    _HAS_LIVE_SDK = False
    log.info("Gemini Live SDK not available — using standard Gemini API fallback")

# Legacy SDK fallback
try:
    import google.generativeai as _legacy_genai
    if _GOOGLE_API_KEY:
        _legacy_genai.configure(api_key=_GOOGLE_API_KEY)
    _fallback_mdl = _legacy_genai.GenerativeModel("gemini-2.0-flash")
    _HAS_LEGACY = True
except Exception:
    _legacy_genai = None
    _fallback_mdl = None
    _HAS_LEGACY = False


class GeminiLiveSession:
    """Manages a single Gemini Live streaming session per client.

    Usage:
        session = GeminiLiveSession(system_prompt="...", on_response=callback)
        await session.start()
        await session.send_frame(base64_image, prompt)
        await session.stop()
    """

    def __init__(self, system_prompt: str = "Analyze each frame.", on_response=None):
        self.system_prompt = system_prompt
        self.on_response = on_response
        self._session = None
        self._task: asyncio.Task | None = None
        self._frame_queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._running = False
        self._latencies: list[float] = []

    async def start(self):
        """Start the Gemini Live session."""
        self._running = True
        if _HAS_LIVE_SDK and _GOOGLE_API_KEY:
            await self._start_live()
        else:
            log.info("GeminiLiveSession: using standard API fallback mode")
            self._task = asyncio.create_task(self._fallback_loop())

    async def _start_live(self):
        """Start real-time session using google-genai Live API."""
        try:
            client = _new_genai.Client(api_key=_GOOGLE_API_KEY)
            config = _gtypes.LiveConnectConfig(
                response_modalities=["TEXT"],
                system_instruction=_gtypes.Content(
                    parts=[_gtypes.Part(text=self.system_prompt)]
                ),
            )
            self._task = asyncio.create_task(
                self._live_loop(client, config)
            )
        except Exception as e:
            log.error(f"Gemini Live start error: {e}")
            self._task = asyncio.create_task(self._fallback_loop())

    async def _live_loop(self, client, config):
        """Main loop for the Live API connection."""
        try:
            async with client.aio.live.connect(
                model="gemini-2.0-flash-live-001", config=config
            ) as session:
                self._session = session
                while self._running:
                    try:
                        image_b64, prompt = await asyncio.wait_for(
                            self._frame_queue.get(), timeout=1.0
                        )
                    except asyncio.TimeoutError:
                        continue

                    t0 = time.perf_counter()
                    # Send image as inline data
                    if "," in image_b64:
                        image_b64 = image_b64.split(",")[1]
                    image_data = base64.b64decode(image_b64)

                    await session.send(
                        input={
                            "parts": [
                                {"inline_data": {"mime_type": "image/jpeg", "data": image_b64}},
                                {"text": prompt or "What do you see?"},
                            ]
                        },
                        end_of_turn=True,
                    )

                    full_text = ""
                    async for response in session.receive():
                        for part in response.server_content.model_turn.parts:
                            if part.text:
                                full_text += part.text
                        if response.server_content.turn_complete:
                            break

                    lat = (time.perf_counter() - t0) * 1000
                    self._latencies.append(round(lat, 1))
                    if len(self._latencies) > 20:
                        self._latencies.pop(0)

                    if self.on_response and full_text:
                        self.on_response(full_text)

        except Exception as e:
            log.error(f"Gemini Live loop error: {e}")
            # Degrade gracefully to fallback
            self._task = asyncio.create_task(self._fallback_loop())

    async def _fallback_loop(self):
        """Fallback loop using standard Gemini API when Live SDK unavailable."""
        while self._running:
            try:
                image_b64, prompt = await asyncio.wait_for(
                    self._frame_queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue

            if not _HAS_LEGACY or not _fallback_mdl:
                if self.on_response:
                    self.on_response("[Gemini not configured]")
                continue

            t0 = time.perf_counter()
            try:
                if "," in image_b64:
                    image_b64 = image_b64.split(",")[1]
                data = base64.b64decode(image_b64)
                res = _fallback_mdl.generate_content([
                    prompt or "Describe what you see in detail.",
                    {"mime_type": "image/jpeg", "data": data},
                ])
                text = res.text
            except Exception as e:
                text = f"Error: {e}"

            lat = (time.perf_counter() - t0) * 1000
            self._latencies.append(round(lat, 1))

            if self.on_response and text:
                self.on_response(text)

    async def send_frame(self, image_b64: str, prompt: str = ""):
        """Queue a frame for analysis. Drops oldest frame if queue full."""
        if not self._running:
            return
        if self._frame_queue.full():
            try:
                self._frame_queue.get_nowait()  # drop oldest
            except asyncio.QueueEmpty:
                pass
        try:
            self._frame_queue.put_nowait((image_b64, prompt))
        except asyncio.QueueFull:
            pass

    async def stop(self):
        """Gracefully stop the session."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._session = None

    @property
    def avg_latency_ms(self) -> float:
        if not self._latencies:
            return 0.0
        return sum(self._latencies) / len(self._latencies)

    @property
    def mode(self) -> str:
        if _HAS_LIVE_SDK and self._session:
            return "live"
        elif _HAS_LEGACY:
            return "standard"
        return "offline"
