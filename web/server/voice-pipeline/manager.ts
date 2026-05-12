// ─── Voice Engine Manager ────────────────────────────────────────────────────
// Decides per-call which engine to use (Pipeline vs Gemini Live).
// Handles caller-ID lookup for personalized greetings.
// On pipeline failure, falls back to Gemini Live.

import type { TelephonyContact, TranscriptEntry, CallState, TelephonySettings } from "../telephony/call-types.js";
import type { VoicePipelineSettings, PipelineSessionConfig, LLMToolCall, LLMToolDef, LLMToolResult } from "./types.js";
import { DEFAULT_VOICE_PIPELINE_SETTINGS } from "./types.js";
import { findContactByPhone, getOrRenderGreeting, buildGreetingText } from "./greeting-cache.js";
import { startPipelineSession } from "./pipeline.js";

/** Pipeline-friendly tool definitions (JSON-Schema instead of Gemini's OBJECT/STRING shape) */
export const PIPELINE_TELEPHONY_TOOLS: LLMToolDef[] = [
  {
    name: "end_call",
    description: "Hang up the phone. CRITICAL RULES: (1) NEVER call this tool proactively. (2) Only call this AFTER you said goodbye AND heard the other person's final response. (3) If you have a script, you MUST complete EVERY step first. (4) There must be a natural pause in the conversation before you use this. (5) When in doubt, do NOT hang up — let the other person hang up instead.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "transfer_call",
    description: "Request to transfer the call to a human or another number. Use when the AI can't handle the request.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the transfer is needed" },
      },
    },
  },
];

/**
 * Public interface — the call-manager creates one of these per call.
 * Mirrors the AudioBridge surface so call-manager doesn't need big refactors.
 */
export interface VoiceEngineSession {
  /** Connect/start the engine (idempotent) */
  connect(): Promise<void>;
  /** Push caller audio (PCM 8kHz from FreeSWITCH) */
  sendCallerAudio(pcm: Buffer | Uint8Array): void;
  /** Tear down */
  disconnect(): void;
  /** Engine identifier (for transcript label / debug) */
  readonly engineLabel: string;
  /** When connected, send pre-rendered greeting immediately (Pipeline only) */
  playGreetingIfReady?(): void;
  /** Audio out callback — call-manager sets this to forward PCM to FreeSWITCH */
  onAudio: (pcm8k: Uint8Array) => void;
  /** Turn-complete callback (Gemini parity) */
  onTurnComplete?: () => void;
  readonly isReady: boolean;
}

/**
 * Build the system prompt for an inbound call from an unknown caller.
 * Adds an instruction to ask for the name if the caller doesn't introduce themselves.
 */
function augmentInboundPromptForUnknownCaller(basePrompt: string): string {
  return basePrompt + `

ZUSÄTZLICHE ANWEISUNG (unbekannte Nummer):
Falls der Anrufer seinen Namen nicht von selbst nennt, frag höflich nach: "Mit wem spreche ich denn?"`;
}

/**
 * When a pre-rendered greeting is played server-side on call answer, the LLM
 * doesn't realise it has already greeted. Combined with prompt phrasing like
 * "Answer warmly" or "DEFAULT INBOUND CALL FLOW: 1. Answer warmly...", the LLM
 * tends to greet again on its first turn — caller hears the welcome twice.
 * This appendix tells the LLM exactly what was already said and to skip step 1.
 */
function augmentPromptForPreRenderedGreeting(basePrompt: string, greetingText: string): string {
  if (!greetingText) return basePrompt;
  return basePrompt + `

WICHTIG — BEGRÜSSUNG WURDE BEREITS GESPROCHEN:
Du hast soeben folgende Begrüssung gesagt (sie wurde bereits abgespielt, der Anrufer hat sie gehört):
"${greetingText}"
Wiederhole sie NICHT. Begrüsse den Anrufer nicht erneut. Reagiere stattdessen direkt und natürlich auf das, was der Anrufer als Nächstes sagt. Überspringe Schritt 1 ("Answer warmly" / "Greet the person") im Standard-Call-Flow — der ist bereits erledigt.`;
}

interface CreateEngineParams {
  callId: string;
  direction: "inbound" | "outbound";
  /** Remote phone number — for outbound, the number we're calling; for inbound, the caller's number */
  remoteNumber: string;
  /** Outbound: known contact; Inbound: looked up from caller-ID */
  contact: TelephonyContact | null;
  /** System prompt (script for outbound, inbound prompt for inbound) */
  systemPrompt: string;
  /** Settings to consult */
  telephonySettings: TelephonySettings;
  pipelineSettings: VoicePipelineSettings;
  /** LLM tool definitions the pipeline may invoke (default: PIPELINE_TELEPHONY_TOOLS) */
  tools?: LLMToolDef[];
  /** Tool-call handler — typically call-manager.handleToolCalls(callId, …) */
  onToolCall?: (calls: LLMToolCall[]) => Promise<LLMToolResult[]>;
  /** Callbacks (proxied through to engine) */
  onTranscript: (entry: TranscriptEntry) => void;
  onStatusChange: (status: CallState["status"]) => void;
}

/**
 * Resolve which engine to use for this call.
 * Returns "pipeline" or "gemini-live".
 */
export function resolveEngine(pipelineSettings: VoicePipelineSettings): "pipeline" | "gemini-live" {
  if (!pipelineSettings.enabled) return "gemini-live";
  return pipelineSettings.engine;
}

/**
 * Look up contact by phone number for inbound calls.
 * For outbound calls, the contact is already known from the UI selection.
 */
export function lookupContactForCall(
  direction: "inbound" | "outbound",
  remoteNumber: string,
  knownContact: TelephonyContact | null,
  contacts: TelephonyContact[],
  defaultCountryCode: string = "",
): TelephonyContact | null {
  if (knownContact) return knownContact;
  if (direction === "inbound") {
    return findContactByPhone(contacts, remoteNumber, defaultCountryCode);
  }
  return null;
}

/**
 * Pre-render the greeting for an upcoming call.
 * For OUTBOUND: render immediately so it's ready by the time the call connects.
 * For INBOUND: should already be cached (rendered on contact create/settings change).
 */
export async function prepareGreeting(params: {
  direction: "inbound" | "outbound";
  contact: TelephonyContact | null;
  pipelineSettings: VoicePipelineSettings;
}): Promise<{ text: string; pcm: Uint8Array | null }> {
  if (!params.pipelineSettings.enabled) return { text: "", pcm: null };
  try {
    const r = await getOrRenderGreeting({
      direction: params.direction,
      contact: params.contact,
      settings: params.pipelineSettings,
    });
    return { text: r.text, pcm: r.pcm };
  } catch (e) {
    console.error("[voice-pipeline] greeting prep failed:", e);
    return { text: buildGreetingText(params.direction, params.contact), pcm: null };
  }
}

/**
 * Create a Pipeline-engine voice session for a call.
 * Throws on init failure → caller should catch and fall back to Gemini Live.
 */
export async function createPipelineEngine(params: CreateEngineParams & {
  greetingText: string;
  greetingPcm: Uint8Array | null;
}): Promise<VoiceEngineSession> {
  // Augment inbound prompt for unknown callers
  let finalPrompt = (params.direction === "inbound" && !params.contact)
    ? augmentInboundPromptForUnknownCaller(params.systemPrompt)
    : params.systemPrompt;
  // If we have a pre-rendered greeting, tell the LLM it was already played
  // so the LLM doesn't greet again on its first turn (caller would hear it twice).
  if (params.greetingPcm && params.greetingText) {
    finalPrompt = augmentPromptForPreRenderedGreeting(finalPrompt, params.greetingText);
  }

  // Wire callbacks: onAudio (patched by caller) + onTurnComplete (patched by call-manager)
  let onAudioCallback: (pcm: Uint8Array) => void = () => {};
  let onTurnCompleteCallback: (() => void) | undefined;

  const sessionConfig: PipelineSessionConfig = {
    callId: params.callId,
    direction: params.direction,
    contact: params.contact ? { id: params.contact.id, name: params.contact.name, phone: params.contact.phone } : null,
    remoteNumber: params.remoteNumber,
    systemPrompt: finalPrompt,
    greetingPcm: params.greetingPcm,
    tools: params.tools ?? PIPELINE_TELEPHONY_TOOLS,
    settings: params.pipelineSettings,
    onTranscript: params.onTranscript,
    onStatusChange: params.onStatusChange,
    onAudioOut: (pcm) => onAudioCallback(pcm),
    onToolCall: params.onToolCall,
    onTurnComplete: () => onTurnCompleteCallback?.(),
  };

  const session = await startPipelineSession(sessionConfig);

  const wrapper: VoiceEngineSession = {
    engineLabel: "Pipeline (Google STT/TTS)",
    onAudio: () => {},
    async connect() {
      // Pipeline starts on construction — no extra connect step needed
    },
    sendCallerAudio(pcm) {
      session.pushAudio(pcm);
    },
    playGreetingIfReady() {
      if (params.greetingPcm) {
        // The PipelineSessionImpl exposes a .sendGreetingNow() method
        (session as unknown as { sendGreetingNow: (txt: string) => void }).sendGreetingNow(params.greetingText);
      }
    },
    disconnect() {
      session.close().catch(() => {});
    },
    get isReady() {
      return session.isReady;
    },
  };

  // Wire the audio callback to whoever sets wrapper.onAudio
  Object.defineProperty(wrapper, "onAudio", {
    get() { return onAudioCallback; },
    set(fn: (pcm: Uint8Array) => void) { onAudioCallback = fn; },
  });
  // Wire onTurnComplete getter/setter (so call-manager's pendingHangup logic works)
  Object.defineProperty(wrapper, "onTurnComplete", {
    get() { return onTurnCompleteCallback; },
    set(fn: () => void) { onTurnCompleteCallback = fn; },
  });

  return wrapper;
}

// ─── Pipeline settings persistence ───────────────────────────────────────────
// Stored alongside telephony settings as a sub-object: settings.voicePipeline

export function getPipelineSettingsFrom(telephonySettings: TelephonySettings): VoicePipelineSettings {
  const fromSettings = (telephonySettings as TelephonySettings & { voicePipeline?: VoicePipelineSettings }).voicePipeline;
  if (!fromSettings) return { ...DEFAULT_VOICE_PIPELINE_SETTINGS };
  const merged: VoicePipelineSettings = {
    ...DEFAULT_VOICE_PIPELINE_SETTINGS,
    ...fromSettings,
    stt: { ...DEFAULT_VOICE_PIPELINE_SETTINGS.stt, ...(fromSettings.stt || {}) },
    tts: { ...DEFAULT_VOICE_PIPELINE_SETTINGS.tts, ...(fromSettings.tts || {}) },
    llm: { ...DEFAULT_VOICE_PIPELINE_SETTINGS.llm, ...(fromSettings.llm || {}) },
  };
  // Migrate legacy "auto" value → the new default (groq). "auto" was removed
  // in favor of explicit per-pipeline selection.
  if ((merged.llm.provider as string) === "auto") {
    merged.llm.provider = DEFAULT_VOICE_PIPELINE_SETTINGS.llm.provider;
  }
  return merged;
}
