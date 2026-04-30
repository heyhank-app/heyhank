// ─── Google Cloud STT Provider (streaming) ──────────────────────────────────
// Streams 8kHz LINEAR16 from FreeSWITCH directly into Cloud Speech-to-Text.
// Uses the v2 streaming gRPC client for low latency.

import { v1 as speechV1 } from "@google-cloud/speech";
import type { STTConfig, STTProvider, STTResult, STTSession } from "../types.js";

// Re-use the same service account key as Vertex AI (configured in telephony settings)
function getKeyFile(): string {
  return process.env.GCP_SERVICE_ACCOUNT_KEY
    || "/opt/agentplatform/gcp-service-account.json";
}

// Google Cloud streaming recognize has a hard 305s limit per stream and the
// underlying gRPC stream gets destroyed on any transient error. To keep the
// call alive we auto-restart the stream whenever it ends/errors, unless the
// session was explicitly closed.
const STREAM_MAX_AGE_MS = 4 * 60 * 1000; // 4 min, safely below Google's 5 min cap

class GoogleSTTSession implements STTSession {
  private stream: ReturnType<speechV1.SpeechClient["streamingRecognize"]> | null = null;
  private resultHandlers: Array<(r: STTResult) => void> = [];
  private errorHandlers: Array<(e: Error) => void> = [];
  private closed = false;
  private streamStartedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restarting = false;

  constructor(private client: speechV1.SpeechClient, private config: STTConfig) {
    this.start();
  }

  private start(): void {
    const request = {
      config: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: this.config.sampleRateHertz,
        languageCode: this.config.language,
        enableAutomaticPunctuation: true,
        // `latest_long` is best for conversational telephony
        model: "latest_long",
        useEnhanced: true,
      },
      interimResults: this.config.interimResults ?? true,
      // Single-utterance is FALSE — we want continuous turn-taking
      singleUtterance: false,
    };

    this.streamStartedAt = Date.now();
    this.restarting = false;

    this.stream = this.client
      .streamingRecognize(request)
      .on("data", (data: {
        results?: Array<{
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
          isFinal?: boolean;
        }>;
      }) => {
        const result = data.results?.[0];
        const alt = result?.alternatives?.[0];
        if (!alt?.transcript) return;
        const out: STTResult = {
          text: alt.transcript,
          isFinal: !!result?.isFinal,
          confidence: alt.confidence,
        };
        for (const h of this.resultHandlers) h(out);
      })
      .on("error", (err: Error) => {
        // Log once per stream instance, then restart silently so the call stays live
        for (const h of this.errorHandlers) h(err);
        this.scheduleRestart();
      })
      .on("end", () => {
        this.scheduleRestart();
      });
  }

  private scheduleRestart(): void {
    if (this.closed || this.restarting) return;
    this.restarting = true;
    // Destroy the old stream reference so pushAudio() stops trying to write to it
    const old = this.stream;
    this.stream = null;
    try { old?.destroy(); } catch { /* ignore */ }
    // Small backoff to avoid hammering the API if something is truly broken
    this.restartTimer = setTimeout(() => {
      if (this.closed) return;
      try {
        this.start();
      } catch (e) {
        for (const h of this.errorHandlers) h(e instanceof Error ? e : new Error(String(e)));
      }
    }, 150);
  }

  pushAudio(pcm: Buffer | Uint8Array): void {
    if (this.closed) return;
    // Rotate stream before Google cuts us off at ~5 min
    if (this.stream && Date.now() - this.streamStartedAt > STREAM_MAX_AGE_MS) {
      this.scheduleRestart();
    }
    const s = this.stream;
    if (!s || (s as unknown as { destroyed?: boolean }).destroyed) return;
    try {
      // The helper client wraps raw audio bytes into { audioContent } itself
      // via its internal PassThrough transform — writing an object here would
      // end up double-wrapped and Google rejects it as "Malordered Data".
      s.write(Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm));
    } catch {
      // Stream was destroyed between the check and the write — recover silently
      this.scheduleRestart();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.stream?.end();
    } catch {
      // ignore
    }
    this.stream = null;
  }

  onResult(handler: (r: STTResult) => void): void {
    this.resultHandlers.push(handler);
  }

  onError(handler: (e: Error) => void): void {
    this.errorHandlers.push(handler);
  }
}

export class GoogleSTTProvider implements STTProvider {
  readonly id = "google" as const;
  private client: speechV1.SpeechClient | null = null;

  private getClient(): speechV1.SpeechClient {
    if (!this.client) {
      this.client = new speechV1.SpeechClient({
        keyFilename: getKeyFile(),
      });
    }
    return this.client;
  }

  async start(config: STTConfig): Promise<STTSession> {
    return new GoogleSTTSession(this.getClient(), config);
  }
}
