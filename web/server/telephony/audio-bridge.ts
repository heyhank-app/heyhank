// ─── Audio Bridge ─────────────────────────────────────────────────────────────
// Bridges audio between FreeSWITCH (8kHz PCM via mod_audio_fork) and
// Gemini Live BidiGenerateContent API (16kHz PCM).
// This is the core of the telephony system — no STT/TTS needed,
// Gemini handles everything natively.
//
// Supports two backends:
//   1. Google AI Studio (default) — API key auth, no regional control
//   2. Vertex AI — Service account auth, regional endpoints (EU latency savings)
//
// Set GEMINI_BACKEND=vertexai to use Vertex AI. Requires:
//   GCP_PROJECT_ID, GCP_LOCATION, GCP_SERVICE_ACCOUNT_KEY

import type { CallState, TranscriptEntry } from "./call-types.js";
import { GoogleAuth } from "google-auth-library";

// ─── Gemini Backend Configuration ─────────────────────────────────────────────

// AI Studio uses gemini-3.1-flash-live-preview (latest live model)
// Vertex AI uses gemini-live-2.5-flash-native-audio (only live model available on Vertex)
const AISTUDIO_MODEL = "gemini-3.1-flash-live-preview";
const VERTEXAI_MODEL = "gemini-live-2.5-flash-native-audio";

// Google AI Studio endpoint (default — no regional control, traffic goes to US)
const AISTUDIO_WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// Vertex AI endpoint template (regional — use europe-west4 for EU)
const VERTEXAI_WS_TEMPLATE = "wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent";

// NOTE: proactive_audio and affective_dialog are available on gemini-live-2.5-flash-native-audio
// (Vertex AI) but NOT on gemini-3.1-flash-live-preview (AI Studio).
// TODO: Enable proactiveAudio and enableAffectiveDialog for Vertex AI backend.

interface VertexAIOverrides {
  enabled: boolean;
  projectId?: string;
  location?: string;
  serviceAccountKey?: string;
}

/** Detect which backend to use (config overrides env vars) */
function isVertexAI(overrides?: VertexAIOverrides): boolean {
  if (overrides) return overrides.enabled;
  return process.env.GEMINI_BACKEND === "vertexai";
}

/** Resolve a Vertex AI config value: config override → env var → default */
function vertexVal(overrides: VertexAIOverrides | undefined, field: "projectId" | "location" | "serviceAccountKey"): string {
  const envMap = { projectId: "GCP_PROJECT_ID", location: "GCP_LOCATION", serviceAccountKey: "GCP_SERVICE_ACCOUNT_KEY" };
  const defaults = { projectId: "", location: "europe-west4", serviceAccountKey: "" };
  return overrides?.[field] || process.env[envMap[field]] || defaults[field];
}

/** Build the WebSocket URL for Gemini Live */
function getGeminiEndpoint(apiKey: string, overrides?: VertexAIOverrides): string {
  if (isVertexAI(overrides)) {
    const location = vertexVal(overrides, "location");
    return VERTEXAI_WS_TEMPLATE.replace("{LOCATION}", location);
  }
  return `${AISTUDIO_WS_BASE}?key=${apiKey}`;
}

/** Build the model identifier for the setup message */
function getModelId(overrides?: VertexAIOverrides): string {
  if (isVertexAI(overrides)) {
    const project = vertexVal(overrides, "projectId");
    const location = vertexVal(overrides, "location");
    if (!project) throw new Error("GCP Project ID is required for Vertex AI. Configure in Telephony Settings or set GCP_PROJECT_ID env var.");
    return `projects/${project}/locations/${location}/publishers/google/models/${VERTEXAI_MODEL}`;
  }
  return `models/${AISTUDIO_MODEL}`;
}

// ─── Vertex AI Auth ───────────────────────────────────────────────────────────

// Cache GoogleAuth instances per key file path
const googleAuthCache = new Map<string, GoogleAuth>();

/**
 * Get a fresh OAuth2 access token for Vertex AI.
 * Tokens are valid for ~60 minutes. We fetch a new one per call (per WebSocket
 * connection) since phone calls rarely exceed 60 minutes.
 */
async function getVertexAIToken(overrides?: VertexAIOverrides): Promise<string> {
  const keyFile = vertexVal(overrides, "serviceAccountKey");
  if (!keyFile) {
    throw new Error(
      "Service account key file is required for Vertex AI. " +
      "Configure in Telephony Settings or set GCP_SERVICE_ACCOUNT_KEY env var.",
    );
  }

  let auth = googleAuthCache.get(keyFile);
  if (!auth) {
    auth = new GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    googleAuthCache.set(keyFile, auth);
  }

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error("Failed to obtain Vertex AI access token");
  }
  return tokenResponse.token;
}

// Log default backend on module load
if (isVertexAI()) {
  console.log(`[telephony] Default Gemini backend: Vertex AI`);
  console.log(`[telephony] Default region: ${process.env.GCP_LOCATION || "europe-west4"}`);
  console.log(`[telephony] GCP project: ${process.env.GCP_PROJECT_ID || "(not set — configure in Telephony Settings)"}`);
} else {
  console.log(`[telephony] Default Gemini backend: Google AI Studio (configure Vertex AI in Telephony Settings for EU routing)`);
}

// ─── AudioBridge ──────────────────────────────────────────────────────────────

export interface AudioBridgeConfig {
  geminiApiKey: string;
  voice: string;
  systemPrompt: string;
  tools: unknown[];
  onTranscript: (entry: TranscriptEntry) => void;
  onStatusChange: (status: CallState["status"]) => void;
  onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => Promise<Array<{ id: string; name: string; response: unknown }>>;
  // Vertex AI overrides (take precedence over env vars)
  vertexAI?: {
    enabled: boolean;
    projectId?: string;
    location?: string;
    serviceAccountKey?: string;
  };
}

/**
 * AudioBridge manages a single call's audio pipeline:
 * FreeSWITCH PCM (8kHz) → upsample → Gemini Live (16kHz) → downsample → FreeSWITCH
 */
export class AudioBridge {
  private geminiWs: WebSocket | null = null;
  private config: AudioBridgeConfig;
  private setupDone = false;
  private callId: string;
  private textBuffer = "";
  private useVertex = false;
  private backendLabel = "AI Studio";

  // Audio chunk batching: accumulate ~100ms of 16kHz PCM before sending
  // 16kHz × 2 bytes × 100ms = 3200 bytes per batch
  private static readonly BATCH_BYTES = 3200;
  private static readonly BATCH_FLUSH_MS = 100;
  private audioBatchBuffer: Uint8Array[] = [];
  private audioBatchSize = 0;
  private audioBatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callId: string, config: AudioBridgeConfig) {
    this.callId = callId;
    this.config = config;
  }

  /** Connect to Gemini Live API (AI Studio or Vertex AI) */
  async connect(): Promise<void> {
    const vx = this.config.vertexAI;
    this.useVertex = isVertexAI(vx);
    const url = getGeminiEndpoint(this.config.geminiApiKey, vx);
    this.backendLabel = this.useVertex ? `Vertex AI / ${vertexVal(vx, "location")}` : "AI Studio";
    const useVertex = this.useVertex;

    // For Vertex AI, we need a Bearer token instead of API key
    if (useVertex) {
      const location = vertexVal(vx, "location");
      const token = await getVertexAIToken(vx);
      console.log(`[telephony] Call ${this.callId}: connecting to Gemini (${this.backendLabel})`);
      this.geminiWs = new WebSocket(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      } as unknown as string[]);
    } else {
      console.log(`[telephony] Call ${this.callId}: connecting to Gemini (${this.backendLabel})`);
      this.geminiWs = new WebSocket(url);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Gemini connection timeout (${this.backendLabel})`));
      }, 15000);

      this.geminiWs!.onopen = () => {
        // Send setup with telephony-optimized config
        // Model ID format differs between AI Studio and Vertex AI
        const modelId = getModelId(vx);

        // Build generation config — thinkingConfig only supported on AI Studio model
        const genConfig: Record<string, unknown> = {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.config.voice },
            },
          },
        };
        if (!this.useVertex) {
          // thinkingConfig not supported on gemini-live-2.5-flash-native-audio (Vertex AI)
          genConfig.thinkingConfig = { thinkingLevel: "minimal" };
        }

        this.geminiWs!.send(JSON.stringify({
          setup: {
            model: modelId,
            generationConfig: genConfig,
            systemInstruction: {
              parts: [{ text: this.config.systemPrompt }],
            },
            tools: this.config.tools,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
        }));
      };

      this.geminiWs!.onmessage = async (event: MessageEvent) => {
        try {
          let text: string;
          if (event.data instanceof Blob) {
            text = await event.data.text();
          } else {
            text = event.data as string;
          }
          const msg = JSON.parse(text);
          this.handleGeminiMessage(msg, resolve, clearTimeout.bind(null, timeout));
        } catch {
          // ignore parse errors
        }
      };

      this.geminiWs!.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Gemini WebSocket error (${this.backendLabel})`));
      };

      this.geminiWs!.onclose = () => {
        this.setupDone = false;
        this.flushTextBuffer();
        this.config.onStatusChange("ended");
      };
    });
  }

  private flushTextBuffer(): void {
    if (this.textBuffer.trim()) {
      this.config.onTranscript({
        speaker: "ai",
        text: this.textBuffer.trim(),
        isFinal: true,
        ts: Date.now(),
      });
    }
    this.textBuffer = "";
  }

  private handleGeminiMessage(
    msg: Record<string, unknown>,
    onSetupResolve?: () => void,
    clearSetupTimeout?: () => void,
  ): void {
    // Setup complete
    if ("setupComplete" in msg) {
      this.setupDone = true;
      clearSetupTimeout?.();
      onSetupResolve?.();
      this.config.onStatusChange("active");
      this.config.onTranscript({
        speaker: "system",
        text: `AI connected to call (${this.backendLabel})`,
        isFinal: true,
        ts: Date.now(),
      });
      return;
    }

    // Tool calls
    if ("toolCall" in msg) {
      const tc = msg.toolCall as {
        functionCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
      };
      if (tc.functionCalls?.length) {
        const calls = tc.functionCalls.map((fc) => ({
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
        }));

        this.config.onTranscript({
          speaker: "system",
          text: `Tool: ${calls.map((c) => c.name).join(", ")}`,
          isFinal: true,
          ts: Date.now(),
        });

        // Execute tools and send response back
        this.config.onToolCall(calls).then((responses) => {
          this.sendToolResponse(responses);
        }).catch(() => {});
      }
      return;
    }

    // Server content
    if ("serverContent" in msg) {
      const content = msg.serverContent as Record<string, unknown>;

      // Output transcription (AI speech as text)
      const outputT = content.outputTranscription as { text?: string } | undefined;
      if (outputT?.text) {
        this.textBuffer += outputT.text;
      }

      // Input transcription (callee speech as text)
      const inputT = content.inputTranscription as { text?: string } | undefined;
      if (inputT?.text?.trim()) {
        this.config.onTranscript({
          speaker: "callee",
          text: inputT.text.trim(),
          isFinal: true,
          ts: Date.now(),
        });
      }

      // Turn complete — all audio for this turn has been sent
      if (content.turnComplete) {
        this.flushTextBuffer();
        this.onTurnComplete();
        return;
      }

      // Interrupted
      if (content.interrupted) {
        this.flushTextBuffer();
        return;
      }

      // Model turn parts — extract audio to send back to FreeSWITCH
      const modelTurn = content.modelTurn as {
        parts?: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }>;
      } | undefined;

      if (modelTurn?.parts) {
        for (const part of modelTurn.parts) {
          if (part.inlineData?.data) {
            // This is the AI's audio response — needs to go back to FreeSWITCH
            // The audio is 24kHz PCM from Gemini, needs downsampling to 8kHz for telephony
            this.onGeminiAudio(part.inlineData.data);
          }
        }
      }
    }
  }

  /** Callback for when Gemini produces audio — override to send to FreeSWITCH */
  public onGeminiAudio: (base64Pcm: string) => void = () => {};

  /** Callback for when Gemini finishes a turn (all audio sent) */
  public onTurnComplete: () => void = () => {};

  /**
   * Send a text trigger to make Gemini start speaking immediately.
   * Gemini Live API waits for user input before responding —
   * this sends a "start now" text message to kick off the greeting.
   */
  sendTrigger(text: string): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.setupDone) return;
    this.geminiWs.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    }));
  }

  /**
   * Feed audio from FreeSWITCH into Gemini.
   * Input: raw PCM 8kHz 16-bit mono from mod_audio_fork.
   * Upsamples to 16kHz and batches into ~100ms chunks before sending
   * to reduce WebSocket message overhead.
   */
  sendCallerAudio(pcm8kHz: Buffer | Uint8Array): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.setupDone) return;

    // Upsample 8kHz → 16kHz (linear interpolation)
    const upsampled = upsample8to16(pcm8kHz);

    // Accumulate into batch buffer
    this.audioBatchBuffer.push(upsampled);
    this.audioBatchSize += upsampled.byteLength;

    // Send when we have >= 100ms worth of audio (3200 bytes @ 16kHz 16-bit mono)
    if (this.audioBatchSize >= AudioBridge.BATCH_BYTES) {
      this.flushAudioBatch();
    } else if (!this.audioBatchTimer) {
      // Ensure we flush within 100ms even if not enough data arrives (e.g. silence/pause)
      this.audioBatchTimer = setTimeout(() => this.flushAudioBatch(), AudioBridge.BATCH_FLUSH_MS);
    }
  }

  /** Flush accumulated audio chunks as a single WebSocket message */
  private flushAudioBatch(): void {
    if (this.audioBatchTimer) {
      clearTimeout(this.audioBatchTimer);
      this.audioBatchTimer = null;
    }

    if (this.audioBatchBuffer.length === 0) return;
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.setupDone) {
      this.audioBatchBuffer = [];
      this.audioBatchSize = 0;
      return;
    }

    // Concatenate all buffered chunks into one
    const merged = new Uint8Array(this.audioBatchSize);
    let offset = 0;
    for (const chunk of this.audioBatchBuffer) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.audioBatchBuffer = [];
    this.audioBatchSize = 0;

    const base64 = bufferToBase64(merged);
    this.geminiWs.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      },
    }));
  }

  /** Send tool call results back to Gemini */
  private sendToolResponse(responses: Array<{ id: string; name: string; response: unknown }>): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.setupDone) return;

    this.geminiWs.send(JSON.stringify({
      toolResponse: {
        functionResponses: responses.map((r) => ({
          id: r.id,
          name: r.name,
          response: r.response,
        })),
      },
    }));
  }

  /** Disconnect from Gemini */
  disconnect(): void {
    this.flushTextBuffer();
    // Flush any remaining audio before closing
    this.flushAudioBatch();
    if (this.audioBatchTimer) {
      clearTimeout(this.audioBatchTimer);
      this.audioBatchTimer = null;
    }
    if (this.geminiWs) {
      this.geminiWs.onclose = null;
      this.geminiWs.close();
      this.geminiWs = null;
    }
    this.setupDone = false;
  }

  get isReady(): boolean {
    return this.setupDone && this.geminiWs?.readyState === WebSocket.OPEN;
  }
}

// ─── Audio Utilities ──────────────────────────────────────────────────────────

/**
 * Upsample 8kHz PCM (16-bit LE) to 16kHz using linear interpolation.
 * Every sample gets doubled with an interpolated sample in between.
 */
function upsample8to16(input: Buffer | Uint8Array): Uint8Array {
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const sampleCount = input.byteLength / 2; // 16-bit samples
  const output = new Uint8Array(sampleCount * 4); // 2x samples, 2 bytes each
  const outputView = new DataView(output.buffer);

  for (let i = 0; i < sampleCount; i++) {
    const sample = inputView.getInt16(i * 2, true); // little-endian
    const nextSample = i + 1 < sampleCount
      ? inputView.getInt16((i + 1) * 2, true)
      : sample;
    const interpolated = Math.round((sample + nextSample) / 2);

    outputView.setInt16(i * 4, sample, true);
    outputView.setInt16(i * 4 + 2, interpolated, true);
  }

  return output;
}

/**
 * Downsample 24kHz/16kHz PCM to 8kHz for FreeSWITCH.
 * Applies a moving-average low-pass filter before decimation to prevent aliasing.
 */
export function downsampleTo8k(input: Uint8Array, inputRate: number): Uint8Array {
  const ratio = inputRate / 8000;
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const inputSamples = input.byteLength / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = new Uint8Array(outputSamples * 2);
  const outputView = new DataView(output.buffer);

  // Moving-average window size matches decimation ratio for anti-aliasing
  const filterSize = Math.ceil(ratio);
  const halfFilter = Math.floor(filterSize / 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = Math.floor(i * ratio);

    // Average over filterSize samples centered on srcIndex
    let sum = 0;
    let count = 0;
    const start = Math.max(0, srcIndex - halfFilter);
    const end = Math.min(inputSamples, srcIndex + halfFilter + 1);
    for (let j = start; j < end; j++) {
      sum += inputView.getInt16(j * 2, true);
      count++;
    }

    const sample = Math.max(-32768, Math.min(32767, Math.round(sum / count)));
    outputView.setInt16(i * 2, sample, true);
  }

  return output;
}

/**
 * Convert Uint8Array/Buffer to base64 string.
 * NOTE: The Gemini Live BidiGenerateContent API currently only supports JSON
 * WebSocket frames with base64-encoded audio. There is no binary/raw PCM
 * transport mode available. The ~33% base64 overhead adds ~0.5ms encoding
 * time per chunk — not critical, but worth revisiting if Google adds binary
 * frame support in the future.
 */
function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.byteLength; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array */
export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
