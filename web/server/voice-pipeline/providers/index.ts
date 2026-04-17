// ─── Provider Registry ───────────────────────────────────────────────────────

import type {
  LLMProvider,
  LLMProviderId,
  STTProvider,
  STTProviderId,
  TTSProvider,
  TTSProviderId,
} from "../types.js";
import { GoogleSTTProvider } from "./stt-google.js";
import { GoogleTTSProvider } from "./tts-google.js";
import { InternalLLMProvider } from "./llm-internal.js";

const sttRegistry = new Map<STTProviderId, STTProvider>();
const ttsRegistry = new Map<TTSProviderId, TTSProvider>();
/** Keyed by LLMProviderId — each instance is pre-configured with its preferred provider */
const llmRegistry = new Map<LLMProviderId, LLMProvider>();

// Lazy-init providers (so missing creds don't break import)
function ensureRegistered(): void {
  if (!sttRegistry.has("google")) sttRegistry.set("google", new GoogleSTTProvider());
  if (!ttsRegistry.has("google")) ttsRegistry.set("google", new GoogleTTSProvider());
}

export function getSTTProvider(id: STTProviderId): STTProvider {
  ensureRegistered();
  const p = sttRegistry.get(id);
  if (!p) throw new Error(`STT provider not available: ${id}`);
  return p;
}

export function getTTSProvider(id: TTSProviderId): TTSProvider {
  ensureRegistered();
  const p = ttsRegistry.get(id);
  if (!p) throw new Error(`TTS provider not available: ${id}`);
  return p;
}

export function getLLMProvider(id: LLMProviderId): LLMProvider {
  let p = llmRegistry.get(id);
  if (!p) {
    p = new InternalLLMProvider(id);
    llmRegistry.set(id, p);
  }
  return p;
}
