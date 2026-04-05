// ─── Gemini Audio Utilities ──────────────────────────────────────────────────
// AudioRecorder: captures PCM Int16 mono 16kHz from microphone
// AudioStreamer: plays PCM Int16 mono 24kHz audio chunks from Gemini

// ─── AudioRecorder ───────────────────────────────────────────────────────────

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const float32 = input[0];
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

export type AudioChunkCallback = (base64: string) => void;

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private onChunk: AudioChunkCallback | null = null;
  private _muted = false;

  async start(onChunk: AudioChunkCallback): Promise<void> {
    this.onChunk = onChunk;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Create worklet from inline source via Blob URL
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-capture-processor");

    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (this._muted || !this.onChunk) return;
      const buffer: ArrayBuffer = event.data;
      const bytes = new Uint8Array(buffer);
      const base64 = arrayBufferToBase64(bytes);
      this.onChunk(base64);
    };

    this.source.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
  }

  set muted(value: boolean) {
    this._muted = value;
  }

  get muted(): boolean {
    return this._muted;
  }

  stop(): void {
    this.onChunk = null;
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}

// ─── AudioStreamer ────────────────────────────────────────────────────────────

export class AudioStreamer {
  private audioContext: AudioContext;
  private scheduledTime = 0;
  private playing = false;
  private queue: AudioBufferSourceNode[] = [];

  constructor() {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
  }

  /** Feed a PCM16 chunk (raw bytes from Gemini, 24kHz mono) */
  addPcm16Chunk(bytes: Uint8Array): void {
    if (bytes.length === 0) return;

    // Convert Int16 LE to Float32
    const numSamples = Math.floor(bytes.length / 2);
    const audioBuffer = this.audioContext.createBuffer(1, numSamples, 24000);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let i = 0; i < numSamples; i++) {
      const int16 = view.getInt16(i * 2, true); // little-endian
      channelData[i] = int16 / 32768;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Schedule for gapless playback
    const now = this.audioContext.currentTime;
    if (!this.playing || this.scheduledTime < now) {
      this.scheduledTime = now + 0.01; // small buffer
      this.playing = true;
    }

    source.start(this.scheduledTime);
    this.scheduledTime += audioBuffer.duration;
    this.queue.push(source);

    // Clean up finished sources
    source.onended = () => {
      const idx = this.queue.indexOf(source);
      if (idx !== -1) this.queue.splice(idx, 1);
    };
  }

  stop(): void {
    for (const src of this.queue) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.queue = [];
    this.scheduledTime = 0;
    this.playing = false;
  }

  destroy(): void {
    this.stop();
    this.audioContext.close().catch(() => {});
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
