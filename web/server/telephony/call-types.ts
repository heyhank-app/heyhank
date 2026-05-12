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
  listen?: boolean; // Stream live audio to browser (listen mode)
  useSavedScript?: boolean; // If true, inject contact.script/callFlow as PRIMARY OBJECTIVE. Default: false.
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
  direction: "outbound" | "inbound";
  trunkId: string;
  callerId: string;
  transcript: TranscriptEntry[];
  summary: string | null;
  durationSeconds: number;
  startedAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  error: string | null;
  listenMode: boolean;
  audioFile?: string | null; // Path to WAV recording (stereo: caller L, AI R)
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
  language?: string; // Call language (e.g. "de", "en") — default: "en"
  script?: string; // Simple call script (markdown prompt)
  callFlow?: CallFlow; // Enterprise: state machine call flow
}

// ─── Call Flow (State Machine) ────────────────────────────────────────────────

/** A node in the call flow graph */
export interface CallFlowNode {
  id: string;
  type: "start" | "say" | "ask" | "condition" | "action" | "end";
  label: string; // Short label for UI display
  prompt?: string; // What the AI should say/do at this node
  /** For "ask" nodes: what to listen for */
  expectedResponses?: string[];
  /** For "condition" nodes: variable to evaluate */
  conditionVariable?: string;
  /** For "action" nodes: tool to call (e.g. "save_note", "end_call") */
  actionTool?: string;
  actionArgs?: Record<string, unknown>;
  /** Position in visual editor (pixels) */
  position?: { x: number; y: number };
}

/** An edge connecting two nodes in the call flow */
export interface CallFlowEdge {
  id: string;
  from: string; // source node ID
  to: string; // target node ID
  label?: string; // condition label (e.g. "yes", "no", "timeout", "default")
  condition?: string; // optional match condition (regex or keyword)
}

/** A complete call flow definition (state machine) */
export interface CallFlow {
  id: string;
  name: string;
  description?: string;
  nodes: CallFlowNode[];
  edges: CallFlowEdge[];
  variables?: Record<string, string>; // template variables (e.g. {{companyName}})
  createdAt?: string;
  updatedAt?: string;
}

/** Telephony settings stored in ~/.heyhank/telephony.json */
export interface TelephonySettings {
  enabled: boolean;
  freeswitch: FreeSwitchConfig;
  trunks: SipTrunkConfig[];
  contacts: TelephonyContact[];
  defaultTrunkId: string | null;
  defaultVoice: string;
  defaultLanguage: string; // e.g. "de", "en" — used when contact has no language set
  maxCallDurationSeconds: number;
  geminiApiKey?: string; // Override; falls back to main Gemini key
  geminiBackend?: "aistudio" | "vertexai"; // Default: aistudio
  gcpProjectId?: string; // Required for Vertex AI
  gcpLocation?: string; // e.g. "europe-west4" (default for Vertex AI)
  gcpServiceAccountKey?: string; // Path to service account JSON key file
  // Inbound call handling
  inboundEnabled?: boolean;
  defaultInboundPrompt?: string; // System prompt for answering calls
  defaultInboundVoice?: string; // Voice for inbound (default: same as defaultVoice)
  inboundKnowledgeBase?: string; // Business info, FAQs, etc. injected into every inbound call
  /**
   * Country-code digits (no `+`) used to convert national-format inbound caller-IDs
   * to E.164 for contact lookup. If empty, the first enabled trunk's callerId is parsed.
   */
  defaultCountryCode?: string;
}

export const DEFAULT_TELEPHONY_SETTINGS: TelephonySettings = {
  enabled: false,
  freeswitch: {
    eslHost: "localhost",
    eslPort: 8021,
    eslPassword: "heyhank_esl_secret",
  },
  trunks: [],
  contacts: [],
  defaultTrunkId: null,
  defaultVoice: "Kore",
  defaultLanguage: "de",
  maxCallDurationSeconds: 600, // 10 min safety limit
  inboundEnabled: false,
  defaultInboundPrompt: "You are Hank, a helpful AI assistant answering the phone. Be friendly, concise, and helpful. Ask the caller how you can help them.",
};
