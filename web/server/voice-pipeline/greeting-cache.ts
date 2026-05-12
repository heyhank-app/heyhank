// ─── Greeting Cache ─────────────────────────────────────────────────────────
// Pre-renders greeting MP3s/PCM for instant playback at call answer.
// Cache key: contactId + direction + voice + text-hash.
// Auto-invalidates when contact name/script changes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelephonyContact } from "../telephony/call-types.js";
import type { TTSConfig, VoicePipelineSettings } from "./types.js";
import { getTTSProvider } from "./providers/index.js";
import { normalizePhoneE164 } from "../telephony/phone-utils.js";

const CACHE_DIR = join(homedir(), ".heyhank", "telephony", "greetings");

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Build cache file path */
function cachePath(key: string, format: "pcm" | "mp3"): string {
  return join(CACHE_DIR, `${key}.${format}`);
}

/** Options to customize the greeting text without changing every call site. */
export interface GreetingTextOptions {
  /** Operator name to mention (e.g. "Markus Stöger"). Empty → no operator clause. */
  operatorName?: string;
  /** Append AI + recording disclosure (EU AI Act Art. 50 + DSGVO Art. 13). Default: true. */
  legalDisclosure?: boolean;
}

/** Build the greeting text from contact + direction. */
export function buildGreetingText(
  direction: "inbound" | "outbound",
  contact: TelephonyContact | null,
  options: GreetingTextOptions = {},
): string {
  const operator = options.operatorName?.trim();
  const disclose = options.legalDisclosure !== false;
  const ofOperator = operator ? ` von ${operator}` : "";
  const aiLabel = disclose ? "der KI-Assistent" : "der Assistent";
  const recordingClause = disclose
    ? " Dieses Gespräch wird aufgezeichnet und mit künstlicher Intelligenz verarbeitet."
    : "";

  if (direction === "outbound") {
    if (contact) {
      return `Servus ${contact.name}! Hier ist Hank, ${aiLabel}${ofOperator}.${recordingClause} Hast du kurz Zeit?`;
    }
    return `Hallo, hier ist Hank, ${aiLabel}${ofOperator}.${recordingClause}`;
  }
  // inbound
  if (contact) {
    return `Servus ${contact.name}! Hier ist Hank, ${aiLabel}${ofOperator}.${recordingClause} Was kann ich für dich tun?`;
  }
  // unknown caller
  return `Hallo, hier ist Hank, ${aiLabel}${ofOperator}.${recordingClause} Wie kann ich dir helfen?`;
}

/** Build a cache key for the given parameters */
function buildKey(params: {
  direction: "inbound" | "outbound";
  contactId: string | null;
  voice: string;
  text: string;
}): string {
  const contactPart = params.contactId || "unknown";
  return `${params.direction}-${contactPart}-${params.voice}-${hashText(params.text)}`;
}

/** Get or render a greeting → returns PCM 8kHz bytes for FreeSWITCH */
export async function getOrRenderGreeting(params: {
  direction: "inbound" | "outbound";
  contact: TelephonyContact | null;
  settings: VoicePipelineSettings;
  /** Optional override text (else built from contact + direction) */
  overrideText?: string;
}): Promise<{ pcm: Uint8Array; text: string; cached: boolean }> {
  ensureDir();
  const text = params.overrideText || buildGreetingText(params.direction, params.contact, {
    operatorName: params.settings.operatorName,
    legalDisclosure: params.settings.legalDisclosureInGreeting,
  });
  const voice = params.settings.tts.voice;
  const key = buildKey({
    direction: params.direction,
    contactId: params.contact?.id ?? null,
    voice,
    text,
  });

  const pcmPath = cachePath(key, "pcm");
  if (existsSync(pcmPath)) {
    return { pcm: readFileSync(pcmPath), text, cached: true };
  }

  // Render via TTS
  const ttsProvider = getTTSProvider(params.settings.tts.provider);
  const config: TTSConfig = {
    voice,
    language: params.settings.stt.language,
    format: "PCM_8000",
    speakingRate: params.settings.tts.speakingRate,
  };
  // Phonetic fix: German TTS says "Hank" with a long A ("Haank").
  // Spelling it "Henk" yields the English short-A pronunciation.
  const ttsText = text.replace(/\bHank\b/g, "Henk");
  const result = await ttsProvider.synthesize(ttsText, config);

  // Save to cache
  writeFileSync(pcmPath, Buffer.from(result.audio));

  return { pcm: result.audio, text, cached: false };
}

/**
 * Pre-render greetings for ALL contacts (background task).
 * Called on contact create/update or settings change.
 * Renders both inbound + outbound personalized greetings + the unknown-caller default.
 */
export async function preRenderAllGreetings(
  contacts: TelephonyContact[],
  settings: VoicePipelineSettings,
): Promise<{ rendered: number; cached: number; errors: number }> {
  if (!settings.preRenderGreetings) {
    return { rendered: 0, cached: 0, errors: 0 };
  }

  let rendered = 0;
  let cached = 0;
  let errors = 0;

  // Default unknown-caller inbound greeting
  try {
    const r = await getOrRenderGreeting({ direction: "inbound", contact: null, settings });
    if (r.cached) cached++; else rendered++;
  } catch {
    errors++;
  }

  // Per-contact greetings (both directions)
  for (const c of contacts) {
    for (const dir of ["inbound", "outbound"] as const) {
      try {
        const r = await getOrRenderGreeting({ direction: dir, contact: c, settings });
        if (r.cached) cached++; else rendered++;
      } catch {
        errors++;
      }
    }
  }

  return { rendered, cached, errors };
}

/**
 * Find contact by phone number. Normalizes to E.164 first, so a caller-ID
 * arriving as "06508920611" (national format) still matches a contact stored
 * as "+436508920611". Pass the trunk's country-code digits (no `+`) as
 * `defaultCountryCode` to enable national→E.164 conversion.
 */
export function findContactByPhone(
  contacts: TelephonyContact[],
  phone: string,
  defaultCountryCode: string = "",
): TelephonyContact | null {
  if (!phone) return null;
  const target = normalizePhoneE164(phone, defaultCountryCode);
  return contacts.find((c) => normalizePhoneE164(c.phone, defaultCountryCode) === target) || null;
}

/**
 * Wipe stale cache entries — call when settings change (different voice).
 * Deletes all PCM files; they'll be re-rendered on demand.
 */
export function clearCache(): { deleted: number } {
  ensureDir();
  let deleted = 0;
  try {
    for (const file of readdirSync(CACHE_DIR)) {
      if (file.endsWith(".pcm") || file.endsWith(".mp3")) {
        try {
          unlinkSync(join(CACHE_DIR, file));
          deleted++;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return { deleted };
}
