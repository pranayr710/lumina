import { usePipelineControlStore } from "./pipelineControlStore";

type MessageHandler = (data: any) => void;

// Configurable via env var — falls back to localhost for Electron
const BACKEND_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";

// Types that always go through even when pipeline is paused. These are either
// control messages or node-triggered actions/streams that fire from their own
// upstream trigger (not from the global Run toggle), matching how the dedicated
// send* methods (sendDetect/sendEmail/…) already bypass the isRunning gate.
const CONTROL_TYPES = new Set([
  "auto_connect", "generate_workflow", "chat_refine", "tool_use",
  "gemini_live_start", "gemini_live_stop",
  "file_append", "gsheets_append", "ip_camera_connect",
  // One-shot action sends, fired by an upstream trigger (like sendEmail/sendSms
  // which already bypass the gate) — not continuous streams.
  "slack_notify", "discord_notify", "mqtt_publish",
]);

export class PipelineSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  // Tracks voluntary disconnect() calls so onclose doesn't re-trigger reconnect
  private _intentionalDisconnect = false;

  get connected() {
    return this._connected;
  }

  connect() {
    // Guard both OPEN and CONNECTING — prevents duplicate sockets during handshake
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    // Clear any stale reconnect timer before a fresh connect attempt
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws = new WebSocket(BACKEND_WS_URL);

      this.ws.onopen = () => {
        this._connected = true;
        this._intentionalDisconnect = false;
        this.emit("status", { connected: true });
        console.log("[PipelineSocket] Connected to Lumina backend");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type) {
            this.emit(data.type, data.payload);
          }
        } catch {
          // ignore parse errors
        }
      };

      this.ws.onclose = (ev) => {
        this._connected = false;
        this.emit("status", { connected: false });
        // Only auto-reconnect on unintentional disconnects
        if (!this._intentionalDisconnect) {
          console.log(`[PipelineSocket] Disconnected (code=${ev.code}), reconnecting in 3s…`);
          this.scheduleReconnect();
        }
        this._intentionalDisconnect = false;
      };

      this.ws.onerror = (err) => {
        // onerror fires before onclose on some environments.
        // In some Electron/browser versions onclose may not fire after a refused connection,
        // so we schedule reconnect here too — scheduleReconnect() is idempotent (guards timer).
        this._connected = false;
        console.warn("[PipelineSocket] WebSocket error:", err);
        this.scheduleReconnect();
      };
    } catch (e) {
      console.error("[PipelineSocket] Failed to create WebSocket:", e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    // Idempotent — only one timer at a time
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this._intentionalDisconnect) {
        this.connect();
      }
    }, 3000);
  }

  sendFrame(base64: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (!usePipelineControlStore.getState().isRunning) return;
    this.ws.send(
      JSON.stringify({
        type: "frame",
        payload: { image: base64, node_id: nodeId },
      })
    );
  }

  sendVlmAnalyze(image: string, prompt: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "vlm_analyze",
        payload: { image, prompt, node_id: nodeId },
      })
    );
  }

  sendDetect(image: string, nodeId: string, confidence: number) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "detect",
        payload: { image, node_id: nodeId, confidence },
      })
    );
  }

  sendAudioAnalyze(audio: string, nodeId: string, confidence: number) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "audio_analyze",
        payload: { audio, node_id: nodeId, confidence },
      })
    );
  }

  sendAudioLlmAnalyze(audio: string, prompt: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "audio_llm_analyze",
        payload: { audio, prompt, node_id: nodeId },
      })
    );
  }

  // Dedicated method (like sendAudioAnalyze/sendDetect) so transcription is
  // driven by the mic capture itself and not gated behind the global Run state.
  sendWhisper(audio: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "whisper_stt",
        payload: { audio, node_id: nodeId },
      })
    );
  }

  sendTextGen(prompt: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "text_gen",
        payload: { prompt, node_id: nodeId },
      })
    );
  }

  sendEmail(to: string, subject: string, body: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "send_email",
        payload: { to, subject, body, node_id: nodeId },
      })
    );
  }

  sendSms(to: string, body: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "send_sms",
        payload: { to, body, node_id: nodeId },
      })
    );
  }

  sendGenerateWorkflow(description: string) {
    this.send("generate_workflow", { description });
  }

  sendAutoConnect(
    nodes: { id: string; type?: string }[],
    existingEdges: { source: string; target: string }[],
    description: string = ""
  ) {
    this.send("auto_connect", { nodes, existing_edges: existingEdges, description });
  }

  sendGeminiLiveFrame(image: string, prompt: string, nodeId: string) {
    this.send("gemini_live_frame", { image, prompt, node_id: nodeId });
  }

  send(type: string, payload: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (!CONTROL_TYPES.has(type) && !usePipelineControlStore.getState().isRunning) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: MessageHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  disconnect() {
    this._intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.emit("status", { connected: false });
  }
}

// Singleton instance
export const pipelineSocket = new PipelineSocket();
