// ─── Voice Pipeline Types ─────────────────────────────────────────────────────
// Provider-agnostic STT → LLM → TTS pipeline as alternative to Gemini Live.
// Designed for low-latency telephony with pre-rendered greetings.

import type { TranscriptEntry, CallState } from "../telephony/call-types.js";

// ─── Provider IDs ─────────────────────────────────────────────────────────────

export type STTProviderId = "google" | "deepgram";
export type TTSProviderId = "google" | "cartesia" | "elevenlabs";
/**
 * LLM provider for the voice pipeline — must be an explicit provider-registry id.
 * The chosen provider must be configured & enabled under Settings → Providers.
 */
export type LLMProviderId = "anthropic" | "groq" | "openai" | "openrouter" | "mistral" | "deepseek" | "together" | "xai" | "qwen" | "venice" | "moonshot";

// ─── Audio formats ────────────────────────────────────────────────────────────

/** Telephony audio format from FreeSWITCH (mod_audio_fork) */
export interface TelephonyAudioFormat {
  encoding: "LINEAR16";
  sampleRateHertz: 8000;
  channels: 1;
}

export const TELEPHONY_AUDIO: TelephonyAudioFormat = {
  encoding: "LINEAR16",
  sampleRateHertz: 8000,
  channels: 1,
};

// ─── STT Provider ─────────────────────────────────────────────────────────────

export interface STTConfig {
  language: string; // e.g. "de-DE"
  sampleRateHertz: number; // 8000 for telephony
  interimResults?: boolean; // emit partial results
  /** Provider-specific extras */
  options?: Record<string, unknown>;
}

export interface STTResult {
  text: string;
  isFinal: boolean;
  /** 0.0 - 1.0 if available */
  confidence?: number;
}

/** Streaming STT — caller pushes audio chunks, gets back transcripts */
export interface STTSession {
  /** Push raw PCM audio (8kHz LINEAR16 from FreeSWITCH) */
  pushAudio(pcm: Buffer | Uint8Array): void;
  /** Stop accepting audio + close stream */
  close(): Promise<void>;
  /** Subscribe to transcript events */
  onResult(handler: (result: STTResult) => void): void;
  /** Subscribe to errors */
  onError(handler: (err: Error) => void): void;
}

export interface STTProvider {
  readonly id: STTProviderId;
  start(config: STTConfig): Promise<STTSession>;
}

// ─── TTS Provider ─────────────────────────────────────────────────────────────

export interface TTSConfig {
  voice: string; // e.g. "de-DE-Chirp-HD-D"
  language: string; // e.g. "de-DE"
  /** Output format — telephony needs PCM 8kHz, browser playback prefers MP3 */
  format: "PCM_8000" | "MP3" | "OGG_OPUS";
  speakingRate?: number;
}

export interface TTSResult {
  /** Audio bytes in the requested format */
  audio: Uint8Array;
  format: TTSConfig["format"];
  /** Voice that was actually used */
  voice: string;
  /** Total bytes synthesized */
  bytes: number;
}

export interface TTSProvider {
  readonly id: TTSProviderId;
  /** Synthesize text → audio (single call, not streaming) */
  synthesize(text: string, config: TTSConfig): Promise<TTSResult>;
  /** List available voices for a language */
  listVoices(language: string): Promise<Array<{ name: string; gender?: string; type?: string }>>;
}

// ─── LLM Provider ─────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMToolDef {
  name: string;
  description: string;
  /** JSON Schema for tool parameters */
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMToolResult {
  id: string;
  name: string;
  response: unknown;
}

export interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Stream tokens (lower latency) */
  stream?: boolean;
  /** Tools the LLM may call */
  tools?: LLMToolDef[];
}

export interface LLMStreamCallbacks {
  /** Streaming text deltas */
  onChunk: (chunk: string) => void;
  /**
   * Called when the LLM emits one or more tool calls. Must return tool results
   * which the provider will append + continue the conversation with.
   */
  onToolCalls?: (calls: LLMToolCall[]) => Promise<LLMToolResult[]>;
}

export interface LLMProvider {
  readonly id: LLMProviderId;
  /** Generate a single response (full text — non-streaming) */
  generate(messages: LLMMessage[], config?: LLMConfig): Promise<{ text: string; ok: boolean; error?: string }>;
  /** Stream tokens one chunk at a time. Emits done() when finished. */
  generateStream?(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    config?: LLMConfig,
  ): Promise<{ text: string; ok: boolean; error?: string }>;
}

// ─── Pipeline Engine ──────────────────────────────────────────────────────────

export type VoiceEngineId = "pipeline" | "gemini-live";

export interface VoicePipelineSettings {
  /** Master switch — if false, always use Gemini Live */
  enabled: boolean;
  /** Default engine for new calls */
  engine: VoiceEngineId;
  /** Fall back to Gemini Live if pipeline init fails */
  fallbackToGeminiLive: boolean;
  stt: {
    provider: STTProviderId;
    language: string; // "de-DE"
  };
  tts: {
    provider: TTSProviderId;
    voice: string; // "de-DE-Chirp-HD-D"
    speakingRate?: number;
  };
  llm: {
    provider: LLMProviderId;
    model?: string;
    temperature?: number;
  };
  /** Pre-render greetings on contact create/update for instant playback */
  preRenderGreetings: boolean;
}

export const DEFAULT_VOICE_PIPELINE_SETTINGS: VoicePipelineSettings = {
  enabled: false, // opt-in initially
  engine: "pipeline",
  fallbackToGeminiLive: true,
  stt: { provider: "google", language: "de-DE" },
  tts: { provider: "google", voice: "de-DE-Chirp-HD-D" },
  llm: { provider: "groq" }, // Best for voice (low TTFT)
  preRenderGreetings: true,
};

// ─── Pipeline Session (per call) ──────────────────────────────────────────────

export interface PipelineSessionConfig {
  callId: string;
  direction: "inbound" | "outbound";
  /** Contact info if known (for personalized greeting) */
  contact?: {
    id: string;
    name: string;
    phone: string;
  } | null;
  /** Phone number of remote party (for caller-ID lookup on inbound) */
  remoteNumber: string;
  /** System prompt for the LLM */
  systemPrompt: string;
  /** Pre-rendered greeting MP3 (PCM 8kHz to send to FreeSWITCH on answer) */
  greetingPcm?: Uint8Array | null;
  /** Hank tools (LLM tool definitions in provider-agnostic JSON Schema form) */
  tools?: LLMToolDef[];
  /** Pipeline settings */
  settings: VoicePipelineSettings;
  /** Callbacks */
  onTranscript: (entry: TranscriptEntry) => void;
  onStatusChange: (status: CallState["status"]) => void;
  onAudioOut: (pcm8k: Uint8Array) => void;
  /** Invoked when the LLM requests one or more tool calls during a turn */
  onToolCall?: (calls: LLMToolCall[]) => Promise<LLMToolResult[]>;
  /** Optional: emitted when the assistant has finished speaking a full turn (audio dispatched) */
  onTurnComplete?: () => void;
}

export interface PipelineSession {
  /** Send caller audio (PCM 8kHz) into the pipeline */
  pushAudio(pcm: Buffer | Uint8Array): void;
  /** Send a text message manually (e.g. trigger greeting) */
  sendText(text: string, role?: "user" | "system"): Promise<void>;
  /** Get the cached greeting PCM if ready (for immediate play on call answer) */
  getGreetingPcm(): Uint8Array | null;
  /** Tear down */
  close(): Promise<void>;
  readonly isReady: boolean;
}
