/**
 * AudioCapture — Web Audio API wrapper for microphone capture.
 * Captures 16kHz mono PCM and delivers ~1 second chunks as base64 float32.
 */

export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private callback: ((base64Pcm: string) => void) | null = null;
  private _level: number = 0;

  private readonly SAMPLE_RATE = 16000;
  private readonly CHUNK_SAMPLES = 16000; // 1 second
  private readonly BUFFER_SIZE = 4096;

  /** Request microphone access and set up audio graph. */
  async init(deviceId?: string): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: this.SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });

    this.audioCtx = new AudioContext({ sampleRate: this.SAMPLE_RATE });
    this.source = this.audioCtx.createMediaStreamSource(this.stream);

    // ScriptProcessorNode for raw PCM access
    this.processor = this.audioCtx.createScriptProcessor(
      this.BUFFER_SIZE,
      1,
      1
    );

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);

      // Compute RMS level
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      this._level = Math.sqrt(sum / input.length);

      if (!this.callback) return;

      // Accumulate samples
      const merged = new Float32Array(this.buffer.length + input.length);
      merged.set(this.buffer);
      merged.set(input, this.buffer.length);
      this.buffer = merged;

      // When we have enough, emit a chunk
      if (this.buffer.length >= this.CHUNK_SAMPLES) {
        const chunk = this.buffer.slice(0, this.CHUNK_SAMPLES);
        this.buffer = this.buffer.slice(this.CHUNK_SAMPLES);

        // Encode float32 PCM as base64
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        this.callback(b64);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
  }

  /** Start delivering audio chunks via callback. */
  startCapture(callback: (base64Pcm: string) => void) {
    this.callback = callback;
    this.buffer = new Float32Array(0);
  }

  /** Stop delivering chunks (keeps mic open). */
  stop() {
    this.callback = null;
  }

  /** Get current RMS amplitude (0-1) for UI level meter. */
  getLevel(): number {
    return this._level;
  }

  /** Full cleanup — stop tracks, disconnect nodes. */
  destroy() {
    this.stop();
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this._level = 0;
  }
}
