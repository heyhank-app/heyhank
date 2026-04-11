// ─── Call Manager ───────────────────���────────────────────────────���────────────
// Manages active phone calls: FreeSWITCH ESL control + Gemini Live audio bridge.
// Each call gets its own AudioBridge instance connected to Gemini.

import type { ServerWebSocket } from "bun";
import type { CallConfig, CallState, CallEvent, TranscriptEntry, CallFlow, TelephonyContact } from "./call-types.js";
import { AudioBridge, downsampleTo8k, base64ToBuffer } from "./audio-bridge.js";
import { getSettings, saveCall } from "./telephony-store.js";
import { getSettings as getMainSettings } from "../settings-manager.js";
import { eslCommand } from "./esl-client.js";
import { DEFAULT_PORT_DEV, DEFAULT_PORT_PROD } from "../constants.js";
import { randomUUID } from "node:crypto";

// Gemini tool declarations for telephony calls (subset — focused on conversation)
const TELEPHONY_TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: "end_call",
      description: "Hang up the phone. CRITICAL RULES: (1) NEVER call this tool proactively. (2) Only call this AFTER you said goodbye AND heard the other person's final response. (3) If you have a script, you MUST complete EVERY step first. (4) There must be a natural pause in the conversation before you use this. (5) When in doubt, do NOT hang up — let the other person hang up instead.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "transfer_call",
      description: "Request to transfer the call to a human or another number. Use when the AI can't handle the request.",
      parameters: {
        type: "OBJECT",
        properties: {
          reason: { type: "STRING", description: "Why the transfer is needed" },
        },
      },
    },
  ],
}];

type EventListener = (event: CallEvent) => void;

/**
 * CallManager orchestrates phone calls.
 *
 * Flow:
 * 1. startCall() → creates CallState, connects AudioBridge to Gemini
 * 2. FreeSWITCH sends audio via WebSocket to handleFreeSwitchAudio()
 * 3. AudioBridge sends audio to Gemini, gets response audio back
 * 4. Response audio sent back to FreeSWITCH via the same WebSocket
 * 5. endCall() → hangup FreeSWITCH, disconnect Gemini, save transcript
 */
export class CallManager {
  private activeCalls = new Map<string, {
    state: CallState;
    bridge: AudioBridge;
    fsSockets: Set<ServerWebSocket<unknown>>; // FreeSWITCH audio fork WebSockets
    transcriptSockets: Set<ServerWebSocket<unknown>>; // Browser WebSockets for live transcript
    listenSockets: Set<ServerWebSocket<unknown>>; // Browser WebSockets for live audio listen
    listenMode: boolean;
    maxDurationTimer?: ReturnType<typeof setTimeout>;
    pendingHangup?: boolean; // end_call was requested, waiting for audio to finish
  }>();

  private listeners = new Set<EventListener>();

  /** Subscribe to call events */
  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CallEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  /** Start a new outbound call */
  async startCall(config: CallConfig): Promise<CallState> {
    const telSettings = getSettings();

    if (!telSettings.enabled) {
      throw new Error("Telephony is not enabled. Configure it in Settings → Telephony.");
    }

    // Resolve Gemini API key
    const mainSettings = getMainSettings();
    const geminiKey = telSettings.geminiApiKey || mainSettings.geminiApiKey;
    if (!geminiKey) {
      throw new Error("Gemini API key not configured.");
    }

    // Resolve SIP trunk
    const trunkId = config.trunkId || telSettings.defaultTrunkId;
    const trunk = trunkId ? telSettings.trunks.find((t) => t.id === trunkId) : telSettings.trunks[0];
    if (!trunk) {
      throw new Error("No SIP trunk configured. Add one in Settings → Telephony.");
    }

    const callId = randomUUID();
    const voice = config.voice || telSettings.defaultVoice || "Kore";
    const maxDuration = config.maxDurationSeconds || telSettings.maxCallDurationSeconds || 600;

    // Resolve contact for this phone number (for script/callFlow/language injection)
    const contact = telSettings.contacts.find(c => c.phone === config.phone) || null;

    // Build telephony-specific system prompt
    const systemPrompt = buildTelephonyPrompt(config.prompt, config.phone, contact, contact?.language || "en");

    // Create call state
    const callState: CallState = {
      id: callId,
      phone: config.phone,
      prompt: config.prompt,
      voice,
      status: "initiating",
      trunkId: trunk.id,
      callerId: config.callerId || trunk.callerId,
      transcript: [],
      summary: null,
      durationSeconds: 0,
      startedAt: Date.now(),
      connectedAt: null,
      endedAt: null,
      error: null,
      listenMode: config.listen ?? false,
    };

    // Create audio bridge to Gemini
    const bridge = new AudioBridge(callId, {
      geminiApiKey: geminiKey,
      voice,
      systemPrompt,
      // Pass Vertex AI config from telephony settings (overrides env vars)
      vertexAI: telSettings.geminiBackend === "vertexai" ? {
        enabled: true,
        projectId: telSettings.gcpProjectId,
        location: telSettings.gcpLocation,
        serviceAccountKey: telSettings.gcpServiceAccountKey,
      } : undefined,
      tools: [...TELEPHONY_TOOL_DECLARATIONS, { googleSearch: {} }],
      onTranscript: (entry) => {
        callState.transcript.push(entry);
        this.emit({ type: "transcript", callId, entry });
        this.broadcastTranscript(callId, entry);
      },
      onStatusChange: (status) => {
        callState.status = status;
        if (status === "active" && !callState.connectedAt) {
          callState.connectedAt = Date.now();
        }
        this.emit({ type: "status", callId, status });
      },
      onToolCall: async (calls) => {
        return this.handleToolCalls(callId, calls);
      },
    });

    // When Gemini finishes a turn, check if we're waiting to hang up
    let hangupScheduled = false;
    bridge.onTurnComplete = () => {
      const call = this.activeCalls.get(callId);
      if (call?.pendingHangup && !hangupScheduled) {
        hangupScheduled = true;
        console.log(`[telephony] Call ${callId}: turn complete after end_call — hanging up in 5s`);
        // Grace period for remaining audio to play through the phone line
        // 5s accounts for audio buffering in FreeSWITCH + network latency
        setTimeout(() => this.endCall(callId).catch(() => {}), 5000);
      }
    };

    // When Gemini produces response audio, send it to FreeSWITCH + listen sockets
    bridge.onGeminiAudio = (base64Pcm: string) => {
      const pcm = base64ToBuffer(base64Pcm);
      // Gemini outputs 24kHz PCM, FreeSWITCH expects 8kHz
      const downsampled = downsampleTo8k(pcm, 24000);
      const call = this.activeCalls.get(callId);
      if (call) {
        for (const ws of call.fsSockets) {
          try {
            ws.send(downsampled);
          } catch { /* socket closed */ }
        }
        // Stream AI audio to listen sockets (browser)
        if (call.listenMode) {
          const msg = JSON.stringify({ type: "audio", speaker: "ai", data: base64Pcm });
          for (const ws of call.listenSockets) {
            try { ws.send(msg); } catch { /* ignore */ }
          }
        }
      }
    };

    this.activeCalls.set(callId, {
      state: callState,
      bridge,
      fsSockets: new Set(),
      transcriptSockets: new Set(),
      listenSockets: new Set(),
      listenMode: config.listen ?? false,
    });

    // Connect to Gemini first
    try {
      await bridge.connect();
    } catch (err) {
      callState.status = "failed";
      callState.error = err instanceof Error ? err.message : "Gemini connection failed";
      callState.endedAt = Date.now();
      saveCall(callState);
      this.activeCalls.delete(callId);
      throw err;
    }

    // Now initiate the FreeSWITCH call via ESL
    callState.status = "dialing";
    this.emit({ type: "status", callId, status: "dialing" });

    try {
      await this.eslOriginate(callId, config.phone, trunk, callState.callerId);
    } catch (err) {
      callState.status = "failed";
      callState.error = err instanceof Error ? err.message : "FreeSWITCH originate failed";
      callState.endedAt = Date.now();
      bridge.disconnect();
      saveCall(callState);
      this.activeCalls.delete(callId);
      throw err;
    }

    // Safety: auto-hangup after max duration
    const timer = setTimeout(() => {
      console.log(`[telephony] Call ${callId} hit max duration (${maxDuration}s), hanging up`);
      this.endCall(callId).catch(() => {});
    }, maxDuration * 1000);

    const call = this.activeCalls.get(callId);
    if (call) call.maxDurationTimer = timer;

    saveCall(callState);
    return callState;
  }

  /** End an active call */
  async endCall(callId: string): Promise<CallState | null> {
    const call = this.activeCalls.get(callId);
    if (!call) return null;

    const { state, bridge } = call;

    // Clear safety timer
    if (call.maxDurationTimer) clearTimeout(call.maxDurationTimer);

    // Disconnect Gemini
    bridge.disconnect();

    // Hangup FreeSWITCH
    try {
      await this.eslHangup(callId);
    } catch { /* might already be hung up */ }

    // Calculate duration
    state.status = "ended";
    state.endedAt = Date.now();
    if (state.connectedAt) {
      state.durationSeconds = Math.round((state.endedAt - state.connectedAt) / 1000);
    }

    // Generate summary from transcript
    state.summary = this.generateSummary(state);

    this.emit({ type: "ended", callId, summary: state.summary });
    saveCall(state);
    this.activeCalls.delete(callId);

    return state;
  }

  /** Handle audio from FreeSWITCH mod_audio_fork WebSocket */
  handleFreeSwitchAudio(callId: string, data: Buffer | Uint8Array): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    call.bridge.sendCallerAudio(data);
    // Stream callee audio to listen sockets (browser)
    if (call.listenMode && call.listenSockets.size > 0) {
      let binary = "";
      for (let i = 0; i < data.byteLength; i++) {
        binary += String.fromCharCode(data[i]);
      }
      const base64 = btoa(binary);
      const msg = JSON.stringify({ type: "audio", speaker: "callee", data: base64 });
      for (const ws of call.listenSockets) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
    }
  }

  /** Register a FreeSWITCH audio WebSocket for a call */
  addFreeSwitchSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.fsSockets.add(ws);
      // Audio fork connected = callee picked up. Trigger Gemini to start speaking immediately.
      // Without this, Gemini waits for caller audio before responding (several seconds of silence).
      if (call.fsSockets.size === 1) {
        console.log(`[telephony] Call ${callId}: audio connected — triggering greeting`);
        call.bridge.sendTrigger("The callee just picked up the phone. Start speaking NOW — greet them immediately according to your instructions.");
      }
    }
  }

  removeFreeSwitchSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) call.fsSockets.delete(ws);
  }

  /** Register a browser WebSocket for live transcript */
  addTranscriptSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.transcriptSockets.add(ws);
      // Send existing transcript
      for (const entry of call.state.transcript) {
        try {
          ws.send(JSON.stringify({ type: "transcript", entry }));
        } catch { /* ignore */ }
      }
    }
  }

  removeTranscriptSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) call.transcriptSockets.delete(ws);
  }

  /** Register a browser WebSocket for live audio listen */
  addListenSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) call.listenSockets.add(ws);
  }

  removeListenSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) call.listenSockets.delete(ws);
  }

  /** Check if call has listen mode */
  isListenMode(callId: string): boolean {
    return this.activeCalls.get(callId)?.listenMode ?? false;
  }

  private broadcastTranscript(callId: string, entry: TranscriptEntry): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    const msg = JSON.stringify({ type: "transcript", entry });
    for (const ws of call.transcriptSockets) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  /** Get state of a specific call */
  getCallState(callId: string): CallState | null {
    return this.activeCalls.get(callId)?.state || null;
  }

  /** List all active calls */
  getActiveCalls(): CallState[] {
    return Array.from(this.activeCalls.values()).map((c) => c.state);
  }

  /** Handle tool calls from Gemini during a phone call */
  private async handleToolCalls(
    callId: string,
    calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  ): Promise<Array<{ id: string; name: string; response: unknown }>> {
    const results: Array<{ id: string; name: string; response: unknown }> = [];

    for (const call of calls) {
      switch (call.name) {
        case "end_call": {
          // Gemini decided to hang up — don't disconnect immediately!
          // Set flag and wait for turnComplete (= all audio has been sent),
          // then add a grace period for audio to play through the phone line.
          const activeCall = this.activeCalls.get(callId);
          if (activeCall) {
            activeCall.pendingHangup = true;
            console.log(`[telephony] Call ${callId}: end_call requested — waiting for turn to complete`);
            // Safety: if turnComplete never comes, force hangup after 15s
            setTimeout(() => {
              const c = this.activeCalls.get(callId);
              if (c?.pendingHangup) {
                console.log(`[telephony] Call ${callId}: force hangup (turnComplete timeout)`);
                this.endCall(callId).catch(() => {});
              }
            }, 15000);
          }
          results.push({ id: call.id, name: call.name, response: { success: true, message: "Will hang up after finishing current speech" } });
          break;
        }
        case "transfer_call":
          results.push({ id: call.id, name: call.name, response: { error: "Transfer not yet implemented" } });
          break;
        default:
          // Forward to main tool handler (for todos, notes, etc.)
          try {
            const toolPort = Number(process.env.PORT) || (process.env.NODE_ENV === "production" ? DEFAULT_PORT_PROD : DEFAULT_PORT_DEV);
            const res = await fetch(`http://127.0.0.1:${toolPort}/api/gemini/tool-call`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: call.name, args: call.args }),
            });
            const data = await res.json();
            results.push({ id: call.id, name: call.name, response: data.result || { error: "No result" } });
          } catch (err) {
            results.push({ id: call.id, name: call.name, response: { error: String(err) } });
          }
      }
    }

    return results;
  }

  // ─── FreeSWITCH ESL Commands (TCP) ──────────────────────────────────────────

  /** Originate a call via FreeSWITCH ESL TCP. */
  private async eslOriginate(
    callId: string,
    phone: string,
    trunk: { id: string; name: string },
    callerId: string,
  ): Promise<void> {
    const settings = getSettings();

    // Sanitize gateway name to match what freeswitch-sync generates
    const gwName = `heyhank_${trunk.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()}`;

    const vars = [
      `origination_caller_id_number=${callerId}`,
      `origination_caller_id_name=HeyHank`,
      `effective_caller_id_number=${callerId}`,
      `effective_caller_id_name=HeyHank`,
      `origination_uuid=${callId}`,
      `ignore_early_media=true`,
    ].join(",");

    // playback silence_stream keeps the media path active for mod_audio_fork.
    // -1 = infinite duration. 1400 = comfort noise level.
    const cmd = `originate {${vars}}sofia/gateway/${gwName}/${phone} &playback(silence_stream://-1;1400)`;
    console.log(`[telephony] ESL originate: ${cmd}`);

    try {
      // Use api with 60s timeout — originate blocks until answered/rejected/timeout
      const result = await eslCommand(cmd, settings.freeswitch, 60000);
      console.log(`[telephony] ESL originate result: ${result.trim()}`);
      if (result.includes("-ERR")) {
        throw new Error(`FreeSWITCH error: ${result.trim()}`);
      }

      // Call connected — start audio fork to stream audio via WebSocket
      await this.startAudioFork(callId, settings.freeswitch);
    } catch (err) {
      console.error(`[telephony] ESL originate failed:`, err);
      throw err;
    }
  }

  /** Start mod_audio_fork to stream call audio to our WebSocket endpoint */
  private async startAudioFork(
    callId: string,
    fsConfig: { eslHost: string; eslPort: number; eslPassword: string },
  ): Promise<void> {
    const defaultPort = process.env.NODE_ENV === "production" ? DEFAULT_PORT_PROD : DEFAULT_PORT_DEV;
    const port = Number(process.env.PORT) || defaultPort;
    const wsUrl = `ws://127.0.0.1:${port}/ws/telephony/audio/${callId}`;
    // Bidirectional mode: callee audio → WebSocket → Gemini, Gemini audio → WebSocket → callee
    const forkCmd = `uuid_audio_fork ${callId} start ${wsUrl} mono 8000 heyhank {} true true 8000`;
    console.log(`[telephony] Starting audio fork: ${forkCmd}`);

    try {
      const result = await eslCommand(forkCmd, fsConfig, 10000);
      console.log(`[telephony] Audio fork result: ${result.trim()}`);
      if (result.includes("-ERR")) {
        console.error(`[telephony] Audio fork failed: ${result.trim()}`);
      }
    } catch (err) {
      console.error(`[telephony] Audio fork error:`, err);
      // Don't throw — call is still connected, just no audio bridge
    }
  }

  private async eslHangup(callId: string): Promise<void> {
    const settings = getSettings();
    try {
      await eslCommand(`uuid_kill ${callId}`, settings.freeswitch);
    } catch {
      // Might already be disconnected
    }
  }

  /** Generate a simple summary from the transcript */
  private generateSummary(state: CallState): string {
    const meaningful = state.transcript.filter((t) => t.speaker !== "system");
    if (meaningful.length === 0) return "No conversation recorded.";

    const lines = meaningful.map((t) =>
      `${t.speaker === "callee" ? "Callee" : "AI"}: ${t.text}`
    );

    return `Call to ${state.phone} (${state.durationSeconds}s). ` +
      `${meaningful.filter((t) => t.speaker === "callee").length} callee messages, ` +
      `${meaningful.filter((t) => t.speaker === "ai").length} AI responses.\n\n` +
      lines.slice(-6).join("\n"); // Last 6 lines as summary
  }

  /** Shutdown: end all calls */
  async shutdown(): Promise<void> {
    const callIds = Array.from(this.activeCalls.keys());
    await Promise.all(callIds.map((id) => this.endCall(id)));
  }
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German (Deutsch)",
  en: "English",
  fr: "French (Français)",
  it: "Italian (Italiano)",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  nl: "Dutch (Nederlands)",
  pl: "Polish (Polski)",
  cs: "Czech (Čeština)",
  hu: "Hungarian (Magyar)",
  ro: "Romanian (Română)",
  tr: "Turkish (Türkçe)",
  ru: "Russian (Русский)",
  ja: "Japanese (日本語)",
  zh: "Chinese (中文)",
  ko: "Korean (한국어)",
  ar: "Arabic (العربية)",
};

function buildTelephonyPrompt(taskPrompt: string, phoneNumber: string, contact?: TelephonyContact | null, language?: string): string {
  const langCode = language || "de";
  const langName = LANGUAGE_NAMES[langCode] || langCode;

  let prompt = `You are conducting a PHONE CALL. You are speaking to a real person on the telephone.

YOUR TASK: ${taskPrompt}

LANGUAGE: You MUST speak ${langName}. All your responses must be in ${langName}. This is non-negotiable.

CRITICAL PHONE CALL RULES:
- You are on a TELEPHONE. Speak naturally, briefly, and conversationally.
- When you receive the signal that the callee picked up, START SPEAKING IMMEDIATELY with your greeting. Do not wait for them to say something first.
- Maximum 2-3 short sentences per response. Nobody likes long monologues on the phone.
- Use natural filler words appropriate for ${langName}.
- If you don't understand something, politely ask them to repeat.
- When your task is complete, summarize the result and say goodbye politely.
- If asked directly whether you're an AI, be honest.
- NEVER mention that you are calling on behalf of "HeyHank" or a "platform" unless asked.
- The phone number you're calling is: ${phoneNumber}`;

  // Inject contact info
  if (contact) {
    prompt += `\n\nCONTACT INFO:\n- Name: ${contact.name}`;
    if (contact.notes) prompt += `\n- Notes: ${contact.notes}`;
  }

  // Inject call script (simple markdown) or call flow (state machine)
  if (contact?.callFlow && contact.callFlow.nodes.length > 0) {
    prompt += `\n\n${buildCallFlowInstructions(contact.callFlow)}`;
  } else if (contact?.script) {
    prompt += `\n\nCALL SCRIPT — THIS IS YOUR PRIMARY OBJECTIVE. Follow each step IN ORDER. Do NOT skip any steps. Do NOT end the call until you have completed the LAST step. After each question, WAIT for their response before moving to the next step:\n${contact.script}`;
  }

  const hasScript = (contact?.callFlow && contact.callFlow.nodes.length > 0) || contact?.script;

  if (!hasScript) {
    prompt += `\n\nDEFAULT CALL FLOW:
1. Greet the person naturally (e.g., "Hello, good day!")
2. State your request concisely
3. Listen and respond to their questions
4. When done, thank them and say goodbye
5. Use the end_call tool when the conversation is finished`;
  }

  prompt += `\n\nYou also have access to Google Search if you need to look something up during the call.

HANGING UP — FOLLOW THESE RULES STRICTLY:
- ${hasScript ? "You MUST complete EVERY step in the script before even thinking about hanging up." : "Complete your full task before hanging up."}
- After your final goodbye, WAIT for the other person to respond or say goodbye back.
- Only call end_call after a clear mutual goodbye — NEVER during or right after speaking.
- If unsure whether to hang up, DON'T. Let the other person end the conversation naturally.
- It is MUCH better to stay on the line too long than to hang up too early.`;

  return prompt;
}

/** Convert a CallFlow state machine into natural language instructions for Gemini */
function buildCallFlowInstructions(flow: CallFlow): string {
  const lines: string[] = [];
  lines.push(`CALL FLOW: "${flow.name}"${flow.description ? ` — ${flow.description}` : ""}`);
  lines.push("Follow this conversation flow strictly. Each step is a state — transition based on the callee's response.\n");

  // Find the start node
  const startNode = flow.nodes.find(n => n.type === "start");
  if (!startNode) {
    lines.push("(No start node defined — use your best judgment)");
    return lines.join("\n");
  }

  // Build adjacency map
  const edgeMap = new Map<string, typeof flow.edges>();
  for (const edge of flow.edges) {
    const existing = edgeMap.get(edge.from) || [];
    existing.push(edge);
    edgeMap.set(edge.from, existing);
  }

  // Walk the graph in BFS to produce ordered instructions
  const visited = new Set<string>();
  const queue = [startNode.id];
  let stepNum = 1;

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = flow.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const outEdges = edgeMap.get(nodeId) || [];
    const typeLabel = node.type === "say" ? "SAY" : node.type === "ask" ? "ASK" : node.type === "condition" ? "CHECK" : node.type === "action" ? "DO" : node.type === "end" ? "END" : "START";

    lines.push(`Step ${stepNum} [${typeLabel}]: ${node.label}`);
    if (node.prompt) lines.push(`  → ${node.prompt}`);
    if (node.expectedResponses?.length) {
      lines.push(`  Listen for: ${node.expectedResponses.join(", ")}`);
    }
    if (node.actionTool) {
      lines.push(`  Action: call ${node.actionTool}${node.actionArgs ? ` with ${JSON.stringify(node.actionArgs)}` : ""}`);
    }

    if (outEdges.length > 0) {
      for (const edge of outEdges) {
        const target = flow.nodes.find(n => n.id === edge.to);
        const label = edge.label || edge.condition || "then";
        lines.push(`  → If "${label}": go to "${target?.label || edge.to}"`);
        if (!visited.has(edge.to)) queue.push(edge.to);
      }
    }

    if (node.type === "end") {
      lines.push("  → Call end_call to hang up.");
    }

    lines.push("");
    stepNum++;
  }

  // Substitute template variables
  let result = lines.join("\n");
  if (flow.variables) {
    for (const [key, value] of Object.entries(flow.variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
  }

  return result;
}

// Export singleton
export const callManager = new CallManager();
