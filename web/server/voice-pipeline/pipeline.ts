// ─── Voice Pipeline Orchestrator ────────────────────────────────────────────
// Connects STT → LLM → TTS for a single call.
//
// Flow:
//  1. Caller audio (8kHz LINEAR16) → STT.pushAudio()
//  2. STT emits final transcript → LLM.generateStream()
//  3. LLM tokens accumulated until sentence boundary → TTS.synthesize()
//  4. TTS PCM 8kHz → onAudioOut()
//
// Turn-taking:
//  - Whenever caller speaks (interim STT result), we cancel any in-flight LLM/TTS (barge-in).
//  - Final transcript triggers a new LLM turn.

import type {
  LLMMessage,
  PipelineSession,
  PipelineSessionConfig,
  STTResult,
  STTSession,
  TTSConfig,
} from "./types.js";
import { getLLMProvider, getSTTProvider, getTTSProvider } from "./providers/index.js";

/** Split text into sentence-like chunks for incremental TTS playback */
function* splitSentences(buffer: string): Generator<{ sentence: string; rest: string }> {
  // Split on sentence-ending punctuation followed by space or end
  const re = /([^.!?…]+[.!?…]+)(\s+|$)/g;
  let match;
  let lastIdx = 0;
  while ((match = re.exec(buffer)) !== null) {
    yield { sentence: match[1].trim(), rest: "" };
    lastIdx = match.index + match[0].length;
  }
  // Return any unfinished tail as `rest`
  if (lastIdx < buffer.length) {
    yield { sentence: "", rest: buffer.slice(lastIdx) };
  } else {
    yield { sentence: "", rest: "" };
  }
}

class PipelineSessionImpl implements PipelineSession {
  private stt: STTSession | null = null;
  private history: LLMMessage[] = [];
  private closed = false;
  private ready = false;
  /** Counter to invalidate in-flight LLM/TTS when user starts talking */
  private currentTurnId = 0;
  /** Initial greeting PCM (set in constructor for instant playback) */
  private greetingPcm: Uint8Array | null = null;
  /** Whether we've already sent the greeting */
  private greetingSent = false;
  /** Buffer for accumulating LLM tokens until sentence boundary */
  private llmBuffer = "";

  constructor(private config: PipelineSessionConfig) {
    this.greetingPcm = config.greetingPcm ?? null;
    // Seed history with the system prompt
    this.history.push({ role: "system", content: config.systemPrompt });
    // If we have a greeting, prime the assistant's first turn so the LLM knows
    // what was already said and continues naturally.
    // We'll add the greeting to history when sendGreeting() runs.
  }

  async start(): Promise<void> {
    // Start STT stream
    const sttProvider = getSTTProvider(this.config.settings.stt.provider);
    this.stt = await sttProvider.start({
      language: this.config.settings.stt.language,
      sampleRateHertz: 8000,
      interimResults: true,
    });

    this.stt.onResult((r) => this.handleSTTResult(r));
    this.stt.onError((err) => {
      console.error(`[voice-pipeline] STT error on call ${this.config.callId}:`, err.message);
    });

    this.ready = true;
    this.config.onStatusChange("active");
    this.config.onTranscript({
      speaker: "system",
      text: `Pipeline engine connected (Google STT/TTS, ${this.config.settings.llm.provider} LLM)`,
      isFinal: true,
      ts: Date.now(),
    });
  }

  /** Send pre-rendered greeting immediately on call answer */
  sendGreetingNow(greetingText: string): void {
    if (this.greetingSent || !this.greetingPcm) return;
    this.greetingSent = true;

    // Stream PCM to FreeSWITCH
    this.config.onAudioOut(this.greetingPcm);

    // Add greeting to history + transcript
    this.history.push({ role: "assistant", content: greetingText });
    this.config.onTranscript({
      speaker: "ai",
      text: greetingText,
      isFinal: true,
      ts: Date.now(),
    });
  }

  pushAudio(pcm: Buffer | Uint8Array): void {
    if (this.closed || !this.stt) return;
    this.stt.pushAudio(pcm);
  }

  async sendText(text: string, role: "user" | "system" = "user"): Promise<void> {
    this.history.push({ role, content: text });
    if (role === "user") {
      await this.runLLMTurn();
    }
  }

  getGreetingPcm(): Uint8Array | null {
    return this.greetingPcm;
  }

  private handleSTTResult(r: STTResult): void {
    if (this.closed) return;

    // Interim result → barge-in: cancel any in-flight LLM/TTS
    if (!r.isFinal) {
      // Increment turnId so any in-flight TTS becomes stale
      this.currentTurnId++;
      // Optionally emit interim transcript (for live UI)
      if (r.text.trim()) {
        this.config.onTranscript({
          speaker: "callee",
          text: r.text.trim(),
          isFinal: false,
          ts: Date.now(),
        });
      }
      return;
    }

    // Final transcript → add to history + run LLM turn
    const trimmed = r.text.trim();
    if (!trimmed) return;
    this.config.onTranscript({
      speaker: "callee",
      text: trimmed,
      isFinal: true,
      ts: Date.now(),
    });
    this.history.push({ role: "user", content: trimmed });
    this.runLLMTurn().catch((e) => {
      console.error(`[voice-pipeline] LLM turn error:`, e);
    });
  }

  private async runLLMTurn(): Promise<void> {
    const myTurnId = ++this.currentTurnId;
    const llm = getLLMProvider(this.config.settings.llm.provider);
    const ttsProvider = getTTSProvider(this.config.settings.tts.provider);

    // Reset buffer for this turn
    this.llmBuffer = "";
    let assistantText = "";
    /** Track in-flight TTS promises so we can await them before signalling turn-complete */
    const ttsInflight: Promise<void>[] = [];

    const ttsConfig: TTSConfig = {
      voice: this.config.settings.tts.voice,
      language: this.config.settings.stt.language,
      format: "PCM_8000",
      speakingRate: this.config.settings.tts.speakingRate,
    };

    /** Synthesize a sentence and pipe to FreeSWITCH (if turn still active) */
    const speakSentence = async (sentence: string): Promise<void> => {
      if (!sentence.trim()) return;
      if (myTurnId !== this.currentTurnId) return; // barge-in cancelled this turn
      try {
        const result = await ttsProvider.synthesize(sentence, ttsConfig);
        if (myTurnId !== this.currentTurnId) return; // double-check after await
        this.config.onAudioOut(result.audio);
      } catch (e) {
        console.error(`[voice-pipeline] TTS error:`, e);
      }
    };

    const enqueueTts = (sentence: string): void => {
      const p = speakSentence(sentence);
      ttsInflight.push(p);
    };

    const onChunk = (chunk: string): void => {
      assistantText += chunk;
      this.llmBuffer += chunk;
      // Try to extract a complete sentence and speak it immediately (low latency)
      let sentence = "";
      let rest = this.llmBuffer;
      for (const part of splitSentences(this.llmBuffer)) {
        if (part.sentence) {
          sentence = part.sentence;
          rest = part.rest;
          break;
        }
      }
      if (sentence) {
        this.llmBuffer = rest;
        enqueueTts(sentence);
      }
    };

    /** Forward LLM tool calls to the call-manager handler */
    const onToolCalls = this.config.onToolCall
      ? async (calls: import("./types.js").LLMToolCall[]) => {
          if (myTurnId !== this.currentTurnId) return [];
          this.config.onTranscript({
            speaker: "system",
            text: `Tool calls: ${calls.map((c) => c.name).join(", ")}`,
            isFinal: true,
            ts: Date.now(),
          });
          return await this.config.onToolCall!(calls);
        }
      : undefined;

    const result = llm.generateStream
      ? await llm.generateStream(
          this.history,
          { onChunk, onToolCalls },
          { ...this.config.settings.llm, tools: this.config.tools },
        )
      : await llm.generate(this.history, { ...this.config.settings.llm, tools: this.config.tools });

    if (!result.ok) {
      console.error(`[voice-pipeline] LLM error: ${result.error}`);
      return;
    }

    // Speak any leftover buffer (last sentence without trailing punctuation)
    if (this.llmBuffer.trim()) {
      enqueueTts(this.llmBuffer.trim());
      this.llmBuffer = "";
    }

    // Wait for all TTS to finish dispatching (so onTurnComplete fires after audio is sent)
    await Promise.allSettled(ttsInflight);

    // Save assistant turn to history
    if (myTurnId === this.currentTurnId && assistantText.trim()) {
      this.history.push({ role: "assistant", content: assistantText.trim() });
      this.config.onTranscript({
        speaker: "ai",
        text: assistantText.trim(),
        isFinal: true,
        ts: Date.now(),
      });
    }

    // Signal turn-complete (used by call-manager's pendingHangup logic)
    if (myTurnId === this.currentTurnId) {
      try { this.config.onTurnComplete?.(); } catch { /* ignore */ }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.stt) {
      try { await this.stt.close(); } catch { /* ignore */ }
      this.stt = null;
    }
    this.config.onStatusChange("ended");
  }

  get isReady(): boolean {
    return this.ready && !this.closed;
  }
}

/**
 * Create + start a new pipeline session.
 * Returns the session and (if greeting available) the greeting text/pcm.
 */
export async function startPipelineSession(
  config: PipelineSessionConfig,
): Promise<PipelineSessionImpl> {
  const session = new PipelineSessionImpl(config);
  await session.start();
  return session;
}
