// ─── Gemini Live Adapter ─────────────────────────────────────────────────────
// Wraps the existing AudioBridge (Gemini Live) so it conforms to the
// VoiceEngineSession interface. Lets call-manager use both engines uniformly.

import type { ServerWebSocket } from "bun";
import { AudioBridge, base64ToBuffer, downsampleTo8k } from "../telephony/audio-bridge.js";
import type { TelephonyContact, TranscriptEntry, CallState, TelephonySettings } from "../telephony/call-types.js";
import type { VoiceEngineSession } from "./manager.js";

interface GeminiLiveAdapterParams {
  callId: string;
  voice: string;
  systemPrompt: string;
  geminiKey: string;
  telSettings: TelephonySettings;
  tools: unknown[];
  isInbound: boolean;
  onTranscript: (entry: TranscriptEntry) => void;
  onStatusChange: (status: CallState["status"]) => void;
  onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => Promise<Array<{ id: string; name: string; response: unknown }>>;
  /** For listen-mode: receives raw 24kHz base64 PCM from Gemini before downsampling */
  onRawGeminiAudio?: (base64Pcm: string) => void;
}

export function createGeminiLiveEngine(params: GeminiLiveAdapterParams): VoiceEngineSession & { bridge: AudioBridge } {
  const { callId, voice, systemPrompt, geminiKey, telSettings, tools, isInbound, onTranscript, onStatusChange, onToolCall, onRawGeminiAudio } = params;

  const bridge = new AudioBridge(callId, {
    geminiApiKey: geminiKey,
    voice,
    systemPrompt,
    vertexAI: telSettings.geminiBackend === "vertexai" ? {
      enabled: true,
      projectId: telSettings.gcpProjectId,
      location: telSettings.gcpLocation,
      serviceAccountKey: telSettings.gcpServiceAccountKey,
    } : undefined,
    tools,
    onTranscript,
    onStatusChange,
    onToolCall,
  });

  let onAudioCb: (pcm8k: Uint8Array) => void = () => {};
  let onTurnCompleteCb: (() => void) | undefined;

  // Gemini emits base64 24kHz PCM → downsample to 8kHz for FreeSWITCH
  bridge.onGeminiAudio = (base64Pcm: string) => {
    onRawGeminiAudio?.(base64Pcm);
    const pcm = base64ToBuffer(base64Pcm);
    const downsampled = downsampleTo8k(pcm, 24000);
    onAudioCb(downsampled);
  };

  bridge.onTurnComplete = () => {
    onTurnCompleteCb?.();
  };

  const engine: VoiceEngineSession & { bridge: AudioBridge } = {
    bridge,
    engineLabel: telSettings.geminiBackend === "vertexai" ? "Gemini Live (Vertex AI)" : "Gemini Live (AI Studio)",
    onAudio: () => {},
    async connect() {
      await bridge.connect();
    },
    sendCallerAudio(pcm) {
      bridge.sendCallerAudio(pcm);
    },
    playGreetingIfReady() {
      // Gemini Live needs a text trigger to start speaking (no pre-rendered greeting)
      bridge.sendTrigger(isInbound
        ? "A caller is now on the line. Start speaking NOW — greet them warmly and ask how you can help."
        : "The callee just picked up the phone. Start speaking NOW — greet them immediately according to your instructions.");
    },
    disconnect() {
      bridge.disconnect();
    },
    get isReady() {
      return bridge.isReady;
    },
  };

  // Wire the audio callback so call-manager can patch it
  Object.defineProperty(engine, "onAudio", {
    get() { return onAudioCb; },
    set(fn: (pcm8k: Uint8Array) => void) { onAudioCb = fn; },
  });
  Object.defineProperty(engine, "onTurnComplete", {
    get() { return onTurnCompleteCb; },
    set(fn: () => void) { onTurnCompleteCb = fn; },
  });

  return engine;
}

// Re-export for convenience
export type { ServerWebSocket };
