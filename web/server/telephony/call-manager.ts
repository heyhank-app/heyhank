// ─── Call Manager ───────────────────���────────────────────────────���────────────
// Manages active phone calls: FreeSWITCH ESL control + Gemini Live audio bridge.
// Each call gets its own AudioBridge instance connected to Gemini.

import type { ServerWebSocket } from "bun";
import type { CallConfig, CallState, CallEvent, TranscriptEntry, CallFlow, TelephonyContact } from "./call-types.js";
import { AudioRecorder } from "./audio-recorder.js";
import { getSettings, saveCall } from "./telephony-store.js";
import { getSettings as getMainSettings } from "../settings-manager.js";
import { eslCommand, eslSubscribe } from "./esl-client.js";
import { normalizePhoneE164, extractCountryCode } from "./phone-utils.js";
import { DEFAULT_PORT_DEV, DEFAULT_PORT_PROD } from "../constants.js";
import { randomUUID } from "node:crypto";
import { createGeminiLiveEngine } from "../voice-pipeline/gemini-live-adapter.js";
import { createPipelineEngine, getPipelineSettingsFrom, prepareGreeting, lookupContactForCall, resolveEngine, type VoiceEngineSession } from "../voice-pipeline/manager.js";
import { addNotification } from "../hank-notifications-store.js";
import { heyHankBus } from "../event-bus.js";

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

const MAX_CONCURRENT_CALLS = 5;

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
    engine: VoiceEngineSession;
    recorder: AudioRecorder;
    fsSockets: Set<ServerWebSocket<unknown>>; // FreeSWITCH audio fork WebSockets
    transcriptSockets: Set<ServerWebSocket<unknown>>; // Browser WebSockets for live transcript
    listenSockets: Set<ServerWebSocket<unknown>>; // Browser WebSockets for live audio listen
    listenMode: boolean;
    maxDurationTimer?: ReturnType<typeof setTimeout>;
    /** Ad-hoc timers (end_call grace period, force-hangup safeties) — all cleared on endCall */
    pendingTimers: Set<ReturnType<typeof setTimeout>>;
    pendingHangup?: boolean; // end_call was requested, waiting for audio to finish
    /** Whether the greeting has been triggered yet (for pipeline engine) */
    greetingTriggered?: boolean;
  }>();

  /** Register a setTimeout that belongs to a call so it gets cleared on endCall */
  private trackTimer(callId: string, timer: ReturnType<typeof setTimeout>): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.pendingTimers.add(timer);
    } else {
      // Call already ended before we could register — clear immediately to avoid a leak
      clearTimeout(timer);
    }
  }

  private listeners = new Set<EventListener>();
  private inboundSubscription: { stop: () => void } | null = null;
  /**
   * For inbound calls, the FreeSWITCH audio-fork WebSocket may connect
   * before the ESL CHANNEL_CREATE event has been processed. We hold such
   * sockets here for a short grace period (keyed by callId), and attach
   * them once `handleInboundCall` has registered the call state.
   */
  private pendingFsSockets = new Map<string, { sockets: Set<ServerWebSocket<unknown>>; timer: ReturnType<typeof setTimeout> }>();
  private readonly FS_SOCKET_GRACE_MS = 3000;

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
    // Validate phone number to prevent ESL command injection
    if (!config.phone || !/^\+?[0-9\-\s]+$/.test(config.phone)) {
      throw new Error("Invalid phone number. Only digits, spaces, hyphens, and an optional leading + are allowed.");
    }

    // Enforce concurrent calls limit
    if (this.activeCalls.size >= MAX_CONCURRENT_CALLS) {
      throw new Error(`Maximum concurrent calls limit reached (${MAX_CONCURRENT_CALLS}). Please wait for an active call to end.`);
    }

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
    const systemPrompt = buildTelephonyPrompt(config.prompt, config.phone, contact, contact?.language || telSettings.defaultLanguage || "de", "outbound", undefined, config.useSavedScript === true);

    // Create call state
    const callState: CallState = {
      id: callId,
      phone: config.phone,
      prompt: config.prompt,
      voice,
      status: "initiating",
      direction: "outbound",
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

    // Create audio recorder for this call
    const recorder = new AudioRecorder(callId);

    // Common transcript/status callbacks
    const onTranscript = (entry: TranscriptEntry) => {
      // Only persist final entries — interim STT results flood the transcript
      // with partial ngrams ("ich", "ich möchte", "ich möchte eine", ...).
      // Live browsers still receive all entries via broadcastTranscript for real-time UX.
      if (entry.isFinal) {
        callState.transcript.push(entry);
      }
      this.emit({ type: "transcript", callId, entry });
      this.broadcastTranscript(callId, entry);
    };
    const onStatusChange = (status: CallState["status"]) => {
      callState.status = status;
      if (status === "active" && !callState.connectedAt) {
        callState.connectedAt = Date.now();
      }
      this.emit({ type: "status", callId, status });
    };

    // Decide engine: pipeline (with greeting) or Gemini Live
    const pipelineSettings = getPipelineSettingsFrom(telSettings);
    const chosenEngine = resolveEngine(pipelineSettings);

    let engine: VoiceEngineSession;
    if (chosenEngine === "pipeline") {
      try {
        const greeting = await prepareGreeting({ direction: "outbound", contact, pipelineSettings });
        engine = await createPipelineEngine({
          callId,
          direction: "outbound",
          remoteNumber: config.phone,
          contact,
          systemPrompt,
          telephonySettings: telSettings,
          pipelineSettings,
          greetingText: greeting.text,
          greetingPcm: greeting.pcm,
          onToolCall: (calls) => this.handleToolCalls(callId, calls),
          onTranscript,
          onStatusChange,
        });
      } catch (err) {
        console.error(`[telephony] Pipeline engine failed, fallback to Gemini Live:`, err);
        if (!pipelineSettings.fallbackToGeminiLive) throw err;
        engine = createGeminiLiveEngine({
          callId,
          voice,
          systemPrompt,
          geminiKey,
          telSettings,
          tools: [...TELEPHONY_TOOL_DECLARATIONS, { googleSearch: {} }],
          isInbound: false,
          onTranscript,
          onStatusChange,
          onToolCall: (calls) => this.handleToolCalls(callId, calls),
        });
      }
    } else {
      engine = createGeminiLiveEngine({
        callId,
        voice,
        systemPrompt,
        geminiKey,
        telSettings,
        tools: [...TELEPHONY_TOOL_DECLARATIONS, { googleSearch: {} }],
        isInbound: false,
        onTranscript,
        onStatusChange,
        onToolCall: (calls) => this.handleToolCalls(callId, calls),
      });
    }

    // Wire AI audio → FreeSWITCH + listen sockets + recorder
    engine.onAudio = (pcm8k: Uint8Array) => {
      recorder.addAiAudio(pcm8k);
      const call = this.activeCalls.get(callId);
      if (!call) return;
      for (const ws of call.fsSockets) {
        try { ws.send(pcm8k); } catch { /* socket closed */ }
      }
      if (call.listenMode) {
        const base64 = Buffer.from(pcm8k).toString('base64');
        const msg = JSON.stringify({ type: "audio", speaker: "ai", data: base64 });
        for (const ws of call.listenSockets) {
          try { ws.send(msg); } catch { /* ignore */ }
        }
      }
    };

    // Hangup-after-turn-complete logic
    let hangupScheduled = false;
    if ("onTurnComplete" in engine) {
      engine.onTurnComplete = () => {
        const call = this.activeCalls.get(callId);
        if (call?.pendingHangup && !hangupScheduled) {
          hangupScheduled = true;
          console.log(`[telephony] Call ${callId}: turn complete after end_call — hanging up in 5s`);
          this.trackTimer(callId, setTimeout(() => this.endCall(callId).catch(() => {}), 5000));
        }
      };
    }

    this.activeCalls.set(callId, {
      state: callState,
      engine,
      recorder,
      fsSockets: new Set(),
      transcriptSockets: new Set(),
      listenSockets: new Set(),
      listenMode: config.listen ?? false,
      pendingTimers: new Set(),
    });

    // Connect engine
    try {
      await engine.connect();
    } catch (err) {
      callState.status = "failed";
      callState.error = err instanceof Error ? err.message : "Engine connection failed";
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
      engine.disconnect();
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

    // Delete from activeCalls FIRST to prevent concurrent entry (race condition guard)
    this.activeCalls.delete(callId);

    // Clear any pending audio-fork buffer entry so late arrivals don't leak
    const pending = this.pendingFsSockets.get(callId);
    if (pending) {
      clearTimeout(pending.timer);
      for (const s of pending.sockets) { try { s.close(); } catch { /* ignore */ } }
      this.pendingFsSockets.delete(callId);
    }

    // Store references before cleanup
    const { state, engine, recorder, maxDurationTimer, pendingTimers } = call;

    // Clear safety timer
    if (maxDurationTimer) clearTimeout(maxDurationTimer);
    // Clear all ad-hoc pending timers (end_call grace, force-hangup safety) to prevent leaks
    for (const t of pendingTimers) clearTimeout(t);
    pendingTimers.clear();

    // Disconnect engine (Pipeline or Gemini Live)
    engine.disconnect();

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

    // Save audio recording
    try {
      const audioFile = recorder.save();
      if (audioFile) {
        state.audioFile = audioFile;
      }
    } catch (err) {
      console.error(`[telephony] Failed to save recording for ${callId}:`, err);
    }

    // Generate summary from transcript
    state.summary = this.generateSummary(state);

    this.emit({ type: "ended", callId, summary: state.summary });
    saveCall(state);

    // Persist a HankChat notification so Hank can summarise the call for the user.
    try {
      const telSettings = getSettings();
      const contact = telSettings.contacts.find((c) => c.phone === state.phone) || null;
      const notification = addNotification({
        type: "call-ended",
        callId,
        phone: state.phone,
        contactName: contact?.name ?? null,
        direction: state.direction,
        durationSeconds: state.durationSeconds,
        summary: state.summary,
        transcript: state.transcript,
      });
      heyHankBus.emit("telephony:call-ended", {
        notificationId: notification.id,
        callId,
        phone: state.phone,
        contactName: contact?.name ?? null,
        direction: state.direction,
        durationSeconds: state.durationSeconds,
        summary: state.summary,
      });
    } catch (err) {
      console.error(`[telephony] Failed to create HankChat notification for ${callId}:`, err);
    }

    return state;
  }

  /** Handle audio from FreeSWITCH mod_audio_fork WebSocket */
  handleFreeSwitchAudio(callId: string, data: Buffer | Uint8Array): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    // Record caller audio (8kHz PCM)
    call.recorder.addCallerAudio(data);
    call.engine.sendCallerAudio(data);
    // Stream callee audio to listen sockets (browser)
    if (call.listenMode && call.listenSockets.size > 0) {
      const base64 = Buffer.from(data).toString('base64');
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
      this.attachFsSocket(call, callId, ws);
      return;
    }

    // Inbound race: audio fork connected before ESL CHANNEL_CREATE was processed.
    // Buffer the socket and try to attach once handleInboundCall registers the call.
    console.log(`[telephony] Audio socket for ${callId} arrived before call state — buffering (${this.FS_SOCKET_GRACE_MS}ms grace)`);
    let pending = this.pendingFsSockets.get(callId);
    if (!pending) {
      const timer = setTimeout(() => {
        const p = this.pendingFsSockets.get(callId);
        if (p) {
          console.warn(`[telephony] No call state for ${callId} within grace period — closing ${p.sockets.size} buffered audio socket(s)`);
          for (const s of p.sockets) {
            try { s.close(); } catch { /* ignore */ }
          }
          this.pendingFsSockets.delete(callId);
        }
      }, this.FS_SOCKET_GRACE_MS);
      pending = { sockets: new Set(), timer };
      this.pendingFsSockets.set(callId, pending);
    }
    pending.sockets.add(ws);
  }

  /** Attach (possibly buffered) FreeSWITCH sockets and trigger greeting if needed */
  private attachFsSocket(
    call: NonNullable<ReturnType<CallManager["activeCalls"]["get"]>>,
    callId: string,
    ws: ServerWebSocket<unknown>,
  ): void {
    call.fsSockets.add(ws);
    // Audio fork connected = callee picked up. Play greeting immediately.
    // For Pipeline: pre-rendered greeting MP3 plays at 0ms latency.
    // For Gemini Live: text trigger makes it start speaking (1-2s latency).
    if (call.fsSockets.size === 1 && !call.greetingTriggered) {
      const isInbound = call.state.direction === "inbound";
      console.log(`[telephony] Call ${callId}: audio connected (${isInbound ? "inbound" : "outbound"}) — triggering greeting via ${call.engine.engineLabel}`);
      call.greetingTriggered = true;
      call.engine.playGreetingIfReady?.();
    }
  }

  /** Flush any buffered FreeSWITCH audio sockets for a call that just became known */
  private flushPendingFsSockets(callId: string): void {
    const pending = this.pendingFsSockets.get(callId);
    if (!pending) return;
    const call = this.activeCalls.get(callId);
    clearTimeout(pending.timer);
    this.pendingFsSockets.delete(callId);
    if (!call) return;
    console.log(`[telephony] Flushing ${pending.sockets.size} buffered audio socket(s) for call ${callId}`);
    for (const s of pending.sockets) {
      this.attachFsSocket(call, callId, s);
    }
  }

  removeFreeSwitchSocket(callId: string, ws: ServerWebSocket<unknown>): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.fsSockets.delete(ws);
      // If no more FreeSWITCH sockets remain, the caller has hung up — end the call
      if (call.fsSockets.size === 0 && call.state.status === "active") {
        console.log(`[telephony] Call ${callId}: all audio sockets closed — caller hung up, ending call`);
        this.endCall(callId).catch(() => {});
      }
    }
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
            this.trackTimer(callId, setTimeout(() => {
              const c = this.activeCalls.get(callId);
              if (c?.pendingHangup) {
                console.log(`[telephony] Call ${callId}: force hangup (turnComplete timeout)`);
                this.endCall(callId).catch(() => {});
              }
            }, 15000));
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

  /** Handle an inbound call detected by ESL event subscription */
  async handleInboundCall(uuid: string, callerNumber: string): Promise<void> {
    const telSettings = getSettings();
    const mainSettings = getMainSettings();

    if (!telSettings.inboundEnabled) {
      console.log(`[telephony] Inbound call from ${callerNumber} ignored — inbound disabled`);
      return;
    }

    // Check if we already have this call (avoid duplicates)
    if (this.activeCalls.has(uuid)) {
      console.log(`[telephony] Inbound call ${uuid} already tracked`);
      return;
    }

    // Enforce concurrent calls limit
    if (this.activeCalls.size >= MAX_CONCURRENT_CALLS) {
      console.log(`[telephony] Inbound call from ${callerNumber} rejected — max concurrent calls (${MAX_CONCURRENT_CALLS}) reached`);
      return;
    }

    const geminiKey = telSettings.geminiApiKey || mainSettings.geminiApiKey;
    if (!geminiKey) {
      console.error("[telephony] Cannot handle inbound call — no Gemini API key");
      return;
    }

    console.log(`[telephony] Handling inbound call from ${callerNumber} (UUID: ${uuid})`);

    // Look up contact by phone number — normalize to E.164 first so peoplefone-style
    // national caller-IDs ("06508920611") match contacts stored as "+436508920611".
    // Country code comes from explicit settings, else parsed from the first enabled trunk's callerId.
    const firstTrunkCallerId = telSettings.trunks.find(t => t.enabled)?.callerId;
    const defaultCountryCode = telSettings.defaultCountryCode || extractCountryCode(firstTrunkCallerId);
    const normalizedCaller = normalizePhoneE164(callerNumber, defaultCountryCode);
    const contact = telSettings.contacts.find(c =>
      normalizePhoneE164(c.phone, defaultCountryCode) === normalizedCaller
    ) || null;

    const voice = telSettings.defaultInboundVoice || telSettings.defaultVoice || "Kore";
    const prompt = contact?.script || telSettings.defaultInboundPrompt || "You are Hank, a helpful AI assistant answering the phone.";
    const maxDuration = telSettings.maxCallDurationSeconds || 600;

    // Build telephony-specific system prompt (include knowledge base for inbound)
    const systemPrompt = buildTelephonyPrompt(prompt, callerNumber, contact, contact?.language || telSettings.defaultLanguage || "de", "inbound", telSettings.inboundKnowledgeBase, true);

    // Create call state — already answered by dialplan
    const callState: CallState = {
      id: uuid,
      phone: callerNumber,
      prompt,
      voice,
      status: "active",
      direction: "inbound",
      trunkId: "",
      callerId: callerNumber,
      transcript: [],
      summary: null,
      durationSeconds: 0,
      startedAt: Date.now(),
      connectedAt: Date.now(), // Already connected (dialplan answered)
      endedAt: null,
      error: null,
      listenMode: false,
    };

    // Create audio recorder for inbound call
    const recorder = new AudioRecorder(uuid);

    // Common transcript/status callbacks
    const onTranscript = (entry: TranscriptEntry) => {
      // Only persist final entries (see outbound onTranscript for rationale).
      if (entry.isFinal) {
        callState.transcript.push(entry);
      }
      this.emit({ type: "transcript", callId: uuid, entry });
      this.broadcastTranscript(uuid, entry);
    };
    const onStatusChange = (status: CallState["status"]) => {
      callState.status = status;
      this.emit({ type: "status", callId: uuid, status });
    };

    // Decide engine
    const pipelineSettings = getPipelineSettingsFrom(telSettings);
    const chosenEngine = resolveEngine(pipelineSettings);
    const lookupContact = lookupContactForCall("inbound", callerNumber, contact, telSettings.contacts, defaultCountryCode);

    let engine: VoiceEngineSession;
    if (chosenEngine === "pipeline") {
      try {
        const greeting = await prepareGreeting({ direction: "inbound", contact: lookupContact, pipelineSettings });
        engine = await createPipelineEngine({
          callId: uuid,
          direction: "inbound",
          remoteNumber: callerNumber,
          contact: lookupContact,
          systemPrompt,
          telephonySettings: telSettings,
          pipelineSettings,
          greetingText: greeting.text,
          greetingPcm: greeting.pcm,
          onToolCall: (calls) => this.handleToolCalls(uuid, calls),
          onTranscript,
          onStatusChange,
        });
      } catch (err) {
        console.error(`[telephony] Inbound pipeline failed, fallback to Gemini Live:`, err);
        if (!pipelineSettings.fallbackToGeminiLive) {
          callState.status = "failed";
          callState.error = err instanceof Error ? err.message : "Pipeline init failed";
          callState.endedAt = Date.now();
          saveCall(callState);
          return;
        }
        engine = createGeminiLiveEngine({
          callId: uuid,
          voice,
          systemPrompt,
          geminiKey,
          telSettings,
          tools: [...TELEPHONY_TOOL_DECLARATIONS, { googleSearch: {} }],
          isInbound: true,
          onTranscript,
          onStatusChange,
          onToolCall: (calls) => this.handleToolCalls(uuid, calls),
        });
      }
    } else {
      engine = createGeminiLiveEngine({
        callId: uuid,
        voice,
        systemPrompt,
        geminiKey,
        telSettings,
        tools: [...TELEPHONY_TOOL_DECLARATIONS, { googleSearch: {} }],
        isInbound: true,
        onTranscript,
        onStatusChange,
        onToolCall: (calls) => this.handleToolCalls(uuid, calls),
      });
    }

    // Wire AI audio → FreeSWITCH + recorder
    engine.onAudio = (pcm8k: Uint8Array) => {
      recorder.addAiAudio(pcm8k);
      const call = this.activeCalls.get(uuid);
      if (!call) return;
      for (const ws of call.fsSockets) {
        try { ws.send(pcm8k); } catch { /* socket closed */ }
      }
    };

    // Hangup-after-turn-complete
    let hangupScheduled = false;
    if ("onTurnComplete" in engine) {
      engine.onTurnComplete = () => {
        const call = this.activeCalls.get(uuid);
        if (call?.pendingHangup && !hangupScheduled) {
          hangupScheduled = true;
          console.log(`[telephony] Inbound call ${uuid}: turn complete after end_call — hanging up in 5s`);
          this.trackTimer(uuid, setTimeout(() => this.endCall(uuid).catch(() => {}), 5000));
        }
      };
    }

    this.activeCalls.set(uuid, {
      state: callState,
      engine,
      recorder,
      fsSockets: new Set(),
      transcriptSockets: new Set(),
      listenSockets: new Set(),
      listenMode: false,
      pendingTimers: new Set(),
    });

    // If the FreeSWITCH audio fork already connected before we got here, attach it now.
    this.flushPendingFsSockets(uuid);

    // Connect engine
    try {
      await engine.connect();
      console.log(`[telephony] Inbound call ${uuid}: ${engine.engineLabel} connected, waiting for audio fork`);
    } catch (err) {
      console.error(`[telephony] Inbound call ${uuid}: engine connection failed:`, err);
      callState.status = "failed";
      callState.error = err instanceof Error ? err.message : "Engine connection failed";
      callState.endedAt = Date.now();
      saveCall(callState);
      this.activeCalls.delete(uuid);
      return;
    }

    // Safety: auto-hangup after max duration
    const timer = setTimeout(() => {
      console.log(`[telephony] Inbound call ${uuid} hit max duration (${maxDuration}s), hanging up`);
      this.endCall(uuid).catch(() => {});
    }, maxDuration * 1000);

    const call = this.activeCalls.get(uuid);
    if (call) call.maxDurationTimer = timer;

    // Safety: if no audio fork attaches within 30s AND no CHANNEL_HANGUP_COMPLETE
    // arrives, treat as a ghost/orphaned channel and clean up. Prevents phantom
    // "active" calls in the dashboard when FS drops the channel silently.
    this.trackTimer(uuid, setTimeout(() => {
      const c = this.activeCalls.get(uuid);
      if (c && c.fsSockets.size === 0) {
        console.warn(`[telephony] Inbound call ${uuid}: no audio fork within 30s — orphaned, cleaning up`);
        this.endCall(uuid).catch(() => {});
      }
    }, 30000));

    saveCall(callState);
    this.emit({ type: "status", callId: uuid, status: "active" });
  }

  /** Start listening for inbound calls via ESL event subscription */
  startInboundListener(): void {
    const telSettings = getSettings();
    if (!telSettings.inboundEnabled) {
      console.log("[telephony] Inbound listener not started — inbound disabled");
      return;
    }

    if (this.inboundSubscription) {
      this.inboundSubscription.stop();
    }

    console.log("[telephony] Starting inbound call listener");
    this.inboundSubscription = eslSubscribe(
      telSettings.freeswitch,
      ({ uuid, callerNumber }) => {
        this.handleInboundCall(uuid, callerNumber).catch(err => {
          console.error("[telephony] Failed to handle inbound call:", err);
        });
      },
      ({ uuid }) => {
        // FS channel ended — clean up our call state so phantom "active" calls don't accumulate.
        if (this.activeCalls.has(uuid)) {
          console.log(`[telephony] CHANNEL_HANGUP_COMPLETE for ${uuid} — ending call`);
          this.endCall(uuid).catch(err => {
            console.error("[telephony] endCall on hangup failed:", err);
          });
        } else {
          // Also clear any buffered audio-fork sockets for calls that never registered.
          this.pendingFsSockets.get(uuid)?.sockets.forEach(ws => {
            try { ws.close(1000, "channel hung up"); } catch { /* ignore */ }
          });
          const pending = this.pendingFsSockets.get(uuid);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingFsSockets.delete(uuid);
          }
        }
      },
    );
  }

  /** Stop inbound listener */
  stopInboundListener(): void {
    if (this.inboundSubscription) {
      this.inboundSubscription.stop();
      this.inboundSubscription = null;
      console.log("[telephony] Inbound listener stopped");
    }
  }

  /** Shutdown: end all calls */
  async shutdown(): Promise<void> {
    this.stopInboundListener();
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

function buildTelephonyPrompt(taskPrompt: string, phoneNumber: string, contact?: TelephonyContact | null, language?: string, direction: "outbound" | "inbound" = "outbound", knowledgeBase?: string, useSavedScript: boolean = false): string {
  const langCode = language || "de";
  const langName = LANGUAGE_NAMES[langCode] || langCode;
  const isInbound = direction === "inbound";

  let prompt = `You are ${isInbound ? "ANSWERING" : "conducting"} a PHONE CALL. You are speaking to a real person on the telephone.

YOUR TASK: ${taskPrompt}

LANGUAGE: You MUST speak ${langName}. All your responses must be in ${langName}. This is non-negotiable.

CRITICAL PHONE CALL RULES:
- You are on a TELEPHONE. Speak naturally, briefly, and conversationally.
- ${isInbound
    ? "Someone is calling YOU. Answer warmly and ask how you can help."
    : "When you receive the signal that the callee picked up, START SPEAKING IMMEDIATELY with your greeting. Do not wait for them to say something first."}
- Maximum 2-3 short sentences per response. Nobody likes long monologues on the phone.
- Use natural filler words appropriate for ${langName}.
- If you don't understand something, politely ask them to repeat.
- When the conversation is complete, say goodbye politely.
- If asked directly whether you're an AI, be honest.
- NEVER mention that you are calling on behalf of "HeyHank" or a "platform" unless asked.
- ${isInbound ? `The caller's phone number is: ${phoneNumber}` : `The phone number you're calling is: ${phoneNumber}`}`;

  // Inject contact info
  if (contact) {
    prompt += `\n\nCONTACT INFO:\n- Name: ${contact.name}`;
    if (contact.notes) prompt += `\n- Notes: ${contact.notes}`;
  }

  // Inject call script (simple markdown) or call flow (state machine) — only when explicitly requested
  if (useSavedScript && contact?.callFlow && contact.callFlow.nodes.length > 0) {
    prompt += `\n\n${buildCallFlowInstructions(contact.callFlow)}`;
  } else if (useSavedScript && contact?.script) {
    prompt += `\n\nCALL SCRIPT — THIS IS YOUR PRIMARY OBJECTIVE. Follow each step IN ORDER. Do NOT skip any steps. Do NOT end the call until you have completed the LAST step. After each question, WAIT for their response before moving to the next step:\n${contact.script}`;
  }

  const hasScript = useSavedScript && ((contact?.callFlow && contact.callFlow.nodes.length > 0) || contact?.script);

  if (!hasScript) {
    prompt += isInbound
      ? `\n\nDEFAULT INBOUND CALL FLOW:
1. Answer warmly (e.g., "Hello, how can I help you?")
2. Listen to what the caller needs
3. Help them to the best of your ability
4. If you cannot help, politely explain and suggest alternatives
5. When the caller is satisfied, thank them and say goodbye
6. Use the end_call tool when the conversation is finished`
      : `\n\nDEFAULT CALL FLOW:
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

  // Inject knowledge base for inbound calls
  if (knowledgeBase?.trim()) {
    prompt += `\n\nKNOWLEDGE BASE — Use this information to answer the caller's questions accurately:\n${knowledgeBase.trim()}`;
    // KB-grounded inbound calls tend to make the LLM repeat the same overview
    // ("X bietet … Webentwicklung, WordPress, E-Commerce …") in every turn.
    // The rules below force tighter, non-repetitive answers.
    prompt += `

ANTWORT-STIL (verbindlich, gilt für jede Antwort):
- Maximal 2 kurze Sätze. Niemals Listen oder Aufzählungen vorlesen.
- Wiederhole NICHT, was du in vorherigen Turns schon gesagt hast — auch nicht in umformulierter Form. Beantworte nur das, was gerade gefragt wurde.
- Knüpfe direkt an die letzte Aussage des Anrufers an. Stelle bei Bedarf EINE konkrete Rückfrage statt mehrere Optionen aufzuzählen.
- Die Knowledge Base ist Hintergrund — nicht jeden Turn wiederkäuen. Liefere nur die für die aktuelle Frage relevante Information.`;
  }

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
