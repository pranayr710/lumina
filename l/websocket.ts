type MessageHandler = (data: any) => void;

const BACKEND_WS_URL = "ws://localhost:8000/ws";

export class PipelineSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  get connected() {
    return this._connected;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(BACKEND_WS_URL);

      this.ws.onopen = () => {
        this._connected = true;
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

      this.ws.onclose = () => {
        this._connected = false;
        this.emit("status", { connected: false });
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this._connected = false;
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  sendFrame(base64: string, nodeId: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
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

  send(type: string, payload: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}

// Singleton instance
export const pipelineSocket = new PipelineSocket();
