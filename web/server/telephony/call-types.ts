// ─── Telephony Types ──────────────────────────────────────────────────────────
// Types for the KI-Telephony system: FreeSWITCH ↔ Gemini Live bridge.

export interface SipTrunkConfig {
  id: string;
  name: string;
  provider: "sipgate" | "easybell" | "peoplefone" | "custom";
  username: string;
  password: string;
  server: string;
  callerId: string; // e.g. "+4312345678"
  enabled: boolean;
}

export interface FreeSwitchConfig {
  eslHost: string;
  eslPort: number;
  eslPassword: string;
}

export interface CallConfig {
  phone: string; // E.164 format: "+4366412345"
  prompt: string; // Task/persona for Gemini
  voice?: string; // Gemini voice (default: "Kore")
  trunkId?: string; // Which SIP trunk to use
  callerId?: string; // Override caller ID
  maxDurationSeconds?: number; // Auto-hangup after N seconds (safety)
}

export type CallStatus =
  | "initiating" // Server preparing the call
  | "dialing" // FreeSWITCH placing the call
  | "ringing" // Remote phone ringing
  | "active" // Call connected, AI speaking
  | "ended" // Call ended normally
  | "failed" // Call failed (busy, no answer, error)
  | "cancelled"; // Cancelled by user before connecting

export interface TranscriptEntry {
  speaker: "callee" | "ai" | "system";
  text: string;
  isFinal: boolean;
  ts: number;
}

export interface CallState {
  id: string;
  phone: string;
  prompt: string;
  voice: string;
  status: CallStatus;
  trunkId: string;
  callerId: string;
  transcript: TranscriptEntry[];
  summary: string | null;
  durationSeconds: number;
  startedAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  error: string | null;
}

/** Message from FreeSWITCH audio fork WebSocket (PCM audio chunks) */
export interface AudioChunk {
  data: Buffer | Uint8Array;
  sampleRate: number; // 8000 from FreeSWITCH
  channels: 1;
}

/** Events emitted by CallManager */
export type CallEvent =
  | { type: "status"; callId: string; status: CallStatus }
  | { type: "transcript"; callId: string; entry: TranscriptEntry }
  | { type: "ended"; callId: string; summary: string | null };

/** A phone contact that Gemini can look up and call by name */
export interface TelephonyContact {
  id: string;
  name: string; // Display name (e.g. "Mama", "Restaurant Steirereck")
  phone: string; // E.164 format (e.g. "+4366412345")
  notes?: string; // Optional context (e.g. "Mon-Sat 10-18 Uhr")
}

/** Telephony settings stored in ~/.heyhank/telephony.json */
export interface TelephonySettings {
  enabled: boolean;
  freeswitch: FreeSwitchConfig;
  trunks: SipTrunkConfig[];
  contacts: TelephonyContact[];
  defaultTrunkId: string | null;
  defaultVoice: string;
  maxCallDurationSeconds: number;
  geminiApiKey?: string; // Override; falls back to main Gemini key
}

export const DEFAULT_TELEPHONY_SETTINGS: TelephonySettings = {
  enabled: false,
  freeswitch: {
    eslHost: "localhost",
    eslPort: 8021,
    eslPassword: "ClueCon",
  },
  trunks: [],
  contacts: [],
  defaultTrunkId: null,
  defaultVoice: "Kore",
  maxCallDurationSeconds: 600, // 10 min safety limit
};
