export interface FrameCaptureOptions {
  fps?: number;
  width?: number;
  height?: number;
  deviceId?: string;
}

export class FrameCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _fps: number;
  private _width: number;
  private _height: number;
  private _deviceId: string | undefined;
  private onFrame: ((base64: string) => void) | null = null;

  constructor(opts: FrameCaptureOptions = {}) {
    this._fps = opts.fps ?? 3;
    this._width = opts.width ?? 640;
    this._height = opts.height ?? 480;
    this._deviceId = opts.deviceId;
  }

  get fps() {
    return this._fps;
  }

  set fps(val: number) {
    this._fps = Math.max(1, Math.min(30, val));
    if (this.intervalId && this.onFrame) {
      this.stop();
      this.startCapture(this.onFrame);
    }
  }

  async init(): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: this._width },
        height: { ideal: this._height },
        ...(this._deviceId
          ? { deviceId: { exact: this._deviceId } }
          : { facingMode: "user" }),
      },
      audio: false,
    });

    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    await this.video.play();

    this.canvas = document.createElement("canvas");
    this.canvas.width = this._width;
    this.canvas.height = this._height;
    this.ctx = this.canvas.getContext("2d")!;

    return this.stream;
  }

  captureFrame(): string | null {
    if (!this.video || !this.ctx || !this.canvas) return null;
    this.ctx.drawImage(this.video, 0, 0, this._width, this._height);
    return this.canvas.toDataURL("image/jpeg", 0.85);
  }

  startCapture(callback: (base64: string) => void) {
    this.onFrame = callback;
    const intervalMs = Math.round(1000 / this._fps);
    this.intervalId = setInterval(() => {
      const frame = this.captureFrame();
      if (frame) callback(frame);
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.onFrame = null;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }
}
