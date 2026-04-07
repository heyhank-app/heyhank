// ─── Call Manager ───────────────────���────────────────────────────���────────────
// Manages active phone calls: FreeSWITCH ESL control + Gemini Live audio bridge.
// Each call gets its own AudioBridge instance connected to Gemini.

import type { ServerWebSocket } from "bun";
import type { CallConfig, CallState, CallEvent, TranscriptEntry } from "./call-types.js";
import { AudioBridge, downsampleTo8k, base64ToBuffer } from "./audio-bridge.js";
import { getSettings, saveCall } from "./telephony-store.js";
import { getSettings as getMainSettings } from "../settings-manager.js";
import { randomUUID } from "node:crypto";

// Gemini tool declarations for telephony calls (subset — focused on conversation)
const TELEPHONY_TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: "end_call",
      description: "End/hang up the current phone call. Use when the conversation is complete, the task is done, or the other person wants to end the call.",
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
    maxDurationTimer?: ReturnType<typeof setTimeout>;
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

    // Build telephony-specific system prompt
    const systemPrompt = buildTelephonyPrompt(config.prompt, config.phone);

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
    };

    // Create audio bridge to Gemini
    const bridge = new AudioBridge(callId, {
      geminiApiKey: geminiKey,
      voice,
      systemPrompt,
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

    // When Gemini produces response audio, send it to FreeSWITCH
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
      }
    };

    this.activeCalls.set(callId, {
      state: callState,
      bridge,
      fsSockets: new Set(),
      transcriptSockets: new Set(),
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
  }

  /** Register a FreeSWITCH audio WebSocket for a call */
  addFreeSwitchSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) call.fsSockets.add(ws);
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
        case "end_call":
          // Gemini decided to hang up
          setTimeout(() => this.endCall(callId).catch(() => {}), 500); // short delay for final audio
          results.push({ id: call.id, name: call.name, response: { success: true, message: "Hanging up" } });
          break;
        case "transfer_call":
          results.push({ id: call.id, name: call.name, response: { error: "Transfer not yet implemented" } });
          break;
        default:
          // Forward to main tool handler (for todos, notes, etc.)
          try {
            const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/gemini/tool-call`, {
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

  // ─── FreeSWITCH ESL Commands ────���──────────────────────────────────────────

  /**
   * Originate a call via FreeSWITCH ESL.
   * Uses HTTP API (mod_xml_rpc or mod_httapi) for simplicity —
   * no need for a persistent ESL TCP connection.
   */
  private async eslOriginate(
    callId: string,
    phone: string,
    trunk: { id: string; name: string },
    callerId: string,
  ): Promise<void> {
    const settings = getSettings();
    const { eslHost, eslPort, eslPassword } = settings.freeswitch;

    // FreeSWITCH ESL over HTTP (mod_xml_rpc)
    // Format: api originate {vars}sofia/gateway/trunk/number &park()
    const vars = [
      `origination_caller_id_number=${callerId}`,
      `origination_caller_id_name=HeyHank`,
      `origination_uuid=${callId}`,
      `ignore_early_media=true`,
    ].join(",");

    const cmd = `originate {${vars}}sofia/gateway/${trunk.name}/${phone} &park()`;

    console.log(`[telephony] ESL originate: ${cmd}`);

    // Try ESL HTTP API first (port 8080 default for mod_xml_rpc)
    try {
      const eslUrl = `http://${eslHost}:${eslPort}/api`;
      const res = await fetch(eslUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Authorization": `Basic ${btoa(`freeswitch:${eslPassword}`)}`,
        },
        body: cmd,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ESL error: ${res.status} ${text}`);
      }

      const result = await res.text();
      console.log(`[telephony] ESL originate result: ${result.trim()}`);

      if (result.includes("-ERR")) {
        throw new Error(`FreeSWITCH error: ${result.trim()}`);
      }
    } catch (err) {
      console.error(`[telephony] ESL originate failed:`, err);
      throw err;
    }
  }

  private async eslHangup(callId: string): Promise<void> {
    const settings = getSettings();
    const { eslHost, eslPort, eslPassword } = settings.freeswitch;

    try {
      const eslUrl = `http://${eslHost}:${eslPort}/api`;
      await fetch(eslUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Authorization": `Basic ${btoa(`freeswitch:${eslPassword}`)}`,
        },
        body: `uuid_kill ${callId}`,
      });
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

function buildTelephonyPrompt(taskPrompt: string, phoneNumber: string): string {
  return `You are conducting a PHONE CALL. You are speaking to a real person on the telephone.

YOUR TASK: ${taskPrompt}

CRITICAL PHONE CALL RULES:
- You are on a TELEPHONE. Speak naturally, briefly, and conversationally.
- Maximum 2-3 short sentences per response. Nobody likes long monologues on the phone.
- Use natural filler words ("well", "I see", "right", "exactly") — this sounds human.
- If you don't understand something, politely ask them to repeat.
- When your task is complete, summarize the result and say goodbye politely.
- If asked directly whether you're an AI, be honest.
- NEVER mention that you are calling on behalf of "HeyHank" or a "platform" unless asked.
- Speak in the same language as the person you're calling.
- The phone number you're calling is: ${phoneNumber}

CALL FLOW:
1. Greet the person naturally (e.g., "Hello, good day!")
2. State your request concisely
3. Listen and respond to their questions
4. When done, thank them and say goodbye
5. Use the end_call tool when the conversation is finished

You also have access to Google Search if you need to look something up during the call.
When the task is completed, call end_call to hang up.`;
}

// Export singleton
export const callManager = new CallManager();
