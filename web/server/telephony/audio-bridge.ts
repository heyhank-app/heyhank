// ─── Audio Bridge ─────────────────────────────────────────────────────────────
// Bridges audio between FreeSWITCH (8kHz PCM via mod_audio_fork) and
// Gemini Live BidiGenerateContent API (16kHz PCM).
// This is the core of the telephony system — no STT/TTS needed,
// Gemini handles everything natively.

import type { CallState, TranscriptEntry } from "./call-types.js";

// Gemini Live WebSocket endpoint
const GEMINI_WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const GEMINI_MODEL = "models/gemini-2.0-flash-live-001";

export interface AudioBridgeConfig {
  geminiApiKey: string;
  voice: string;
  systemPrompt: string;
  tools: unknown[];
  onTranscript: (entry: TranscriptEntry) => void;
  onStatusChange: (status: CallState["status"]) => void;
  onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => Promise<Array<{ id: string; name: string; response: unknown }>>;
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

  constructor(callId: string, config: AudioBridgeConfig) {
    this.callId = callId;
    this.config = config;
  }

  /** Connect to Gemini Live API */
  async connect(): Promise<void> {
    const url = `${GEMINI_WS_BASE}?key=${this.config.geminiApiKey}`;
    this.geminiWs = new WebSocket(url);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Gemini connection timeout"));
      }, 15000);

      this.geminiWs!.onopen = () => {
        // Send setup with telephony-optimized config
        this.geminiWs!.send(JSON.stringify({
          setup: {
            model: GEMINI_MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: this.config.voice },
                },
              },
            },
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
        reject(new Error("Gemini WebSocket error"));
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
        text: "AI connected to call",
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

      // Turn complete
      if (content.turnComplete) {
        this.flushTextBuffer();
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

  /**
   * Feed audio from FreeSWITCH into Gemini.
   * Input: raw PCM 8kHz 16-bit mono from mod_audio_fork
   * Gemini expects: PCM 16kHz
   */
  sendCallerAudio(pcm8kHz: Buffer | Uint8Array): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.setupDone) return;

    // Upsample 8kHz → 16kHz (simple linear interpolation)
    const upsampled = upsample8to16(pcm8kHz);
    const base64 = bufferToBase64(upsampled);

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
 * Takes every Nth sample (simple decimation).
 */
export function downsampleTo8k(input: Uint8Array, inputRate: number): Uint8Array {
  const ratio = inputRate / 8000;
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const inputSamples = input.byteLength / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = new Uint8Array(outputSamples * 2);
  const outputView = new DataView(output.buffer);

  for (let i = 0; i < outputSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    if (srcIdx * 2 + 1 < input.byteLength) {
      const sample = inputView.getInt16(srcIdx * 2, true);
      outputView.setInt16(i * 2, sample, true);
    }
  }

  return output;
}

/** Convert Uint8Array/Buffer to base64 string */
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
