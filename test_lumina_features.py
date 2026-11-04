import asyncio
import base64
import json
import httpx
import time

BASE_URL = "http://localhost:8000"

# Mock 1x1 JPG image (Base64)
MOCK_IMAGE_B64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="

# Mock dummy WAV audio (Base64) - small header just to pass basic decode
MOCK_AUDIO_B64 = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

async def test_endpoint(client, name, method, url, payload=None):
    print(f"Testing {name} ({url})... ", end="")
    try:
        t0 = time.time()
        if method.upper() == "GET":
            r = await client.get(url, timeout=10)
        else:
            r = await client.post(url, json=payload, timeout=30)
        dur = round(time.time() - t0, 2)
        if r.status_code < 300:
            print(f"[OK] ({dur}s) - {r.text[:50]}")
            return True, r.json()
        else:
            print(f"[FAILED] ({r.status_code}) - {r.text}")
            return False, r.text
    except Exception as e:
        print(f"[ERROR] - {e}")
        return False, str(e)


async def main():
    async with httpx.AsyncClient() as client:
        print("=== Lumina Features Automated Test ===\n")

        # 1. System Health
        await test_endpoint(client, "Health Check", "GET", f"{BASE_URL}/health")
        await test_endpoint(client, "History", "GET", f"{BASE_URL}/api/history")
        await test_endpoint(client, "Dashboard Stats", "GET", f"{BASE_URL}/api/dashboard")

        # 2. Vision Models
        print("\n--- Vision Models ---")
        img_payload = {"node_id": "test_vis", "image": MOCK_IMAGE_B64}
        await test_endpoint(client, "Object Detection (YOLO)", "POST", f"{BASE_URL}/api/detect", img_payload)
        img_prompt = {"node_id": "test_vlm", "image": MOCK_IMAGE_B64, "prompt": "What do you see?"}
        await test_endpoint(client, "VLM Analysis", "POST", f"{BASE_URL}/api/vlm", img_prompt)
        await test_endpoint(client, "Face Match", "POST", f"{BASE_URL}/api/face-match", img_payload)
        await test_endpoint(client, "OCR", "POST", f"{BASE_URL}/api/ocr", img_payload)
        await test_endpoint(client, "Pose Estimation", "POST", f"{BASE_URL}/api/pose", img_payload)

        # 3. Audio Models
        print("\n--- Audio Models ---")
        aud_payload = {"node_id": "test_aud", "audio": MOCK_AUDIO_B64}
        await test_endpoint(client, "Audio Detect (YamNet)", "POST", f"{BASE_URL}/api/audio-detect", aud_payload)
        await test_endpoint(client, "Speech to Text (Whisper)", "POST", f"{BASE_URL}/api/whisper", aud_payload)
        aud_llm_payload = {"node_id": "test_aud_llm", "context": "Loud noise", "prompt": "Analyze"}
        await test_endpoint(client, "Audio LLM", "POST", f"{BASE_URL}/api/audio-llm", aud_llm_payload)

        # 4. Text & Logic
        print("\n--- Text & Logic Models ---")
        llm_payload = {"node_id": "test_llm", "prompt": "Say hello world", "max_tokens": 10}
        await test_endpoint(client, "LLM Gen", "POST", f"{BASE_URL}/api/llm", llm_payload)
        tool_payload = {
            "node_id": "test_tool", 
            "input_text": "Fetch weather for Tokyo", 
            "tool_name": "get_weather", 
            "tool_description": "Gets weather", 
            "tool_parameters": {"location": "string"}
        }
        await test_endpoint(client, "Tool Use", "POST", f"{BASE_URL}/api/tool-use", tool_payload)

        # 5. Integrations / Notifications
        print("\n--- Integrations & Notifications ---")
        notify_payload = {"node_id": "test_notify", "message": "Test notification"}
        await test_endpoint(client, "System Notify", "POST", f"{BASE_URL}/api/notify", notify_payload)
        
        # Test mock script execution
        script_payload = {"node_id": "test_script", "script": "print('hello from sandboxed script')", "input": {}}
        # Wait, the script endpoint isn't exposed via REST directly, it's WS only! 
        # But wait, looking at srv.py: `run_script` is a WS handler `_h_script`. It's not a REST endpoint.
        # Let's check which REST endpoints exist for notifications.
        # There's /api/notify, /api/screenshot, /api/sound, /api/speak.
        # Let's test those.
        await test_endpoint(client, "Sound Alert", "POST", f"{BASE_URL}/api/sound", {"sound": "alert"})
        await test_endpoint(client, "Speak Text", "POST", f"{BASE_URL}/api/speak", {"text": "hello"})
        await test_endpoint(client, "Screenshot", "POST", f"{BASE_URL}/api/screenshot", {})

if __name__ == "__main__":
    asyncio.run(main())
