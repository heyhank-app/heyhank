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

class GoogleSTTSession implements STTSession {
  private stream: ReturnType<speechV1.SpeechClient["streamingRecognize"]> | null = null;
  private resultHandlers: Array<(r: STTResult) => void> = [];
  private errorHandlers: Array<(e: Error) => void> = [];
  private closed = false;

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
        for (const h of this.errorHandlers) h(err);
      })
      .on("end", () => {
        this.closed = true;
      });
  }

  pushAudio(pcm: Buffer | Uint8Array): void {
    if (this.closed || !this.stream) return;
    try {
      // Streaming API expects the data inside { audioContent: <Buffer> }
      this.stream.write({ audioContent: Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm) });
    } catch (e) {
      for (const h of this.errorHandlers) h(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async close(): Promise<void> {
    if (this.closed || !this.stream) return;
    this.closed = true;
    try {
      this.stream.end();
    } catch {
      // ignore
    }
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
