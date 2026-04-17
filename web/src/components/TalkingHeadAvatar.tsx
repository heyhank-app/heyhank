// @ts-expect-error - no type definitions shipped by @met4citizen/talkinghead
import { TalkingHead as TalkingHeadLib } from "@met4citizen/talkinghead";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// ─── Minimal structural types for the third-party lib ────────────────────────
// The package does not ship .d.ts files; we declare only what we actually call.
type Mood = "neutral" | "happy" | "angry" | "sad" | "fear" | "disgust" | "love" | "sleep";

type StreamStartOpt = {
  sampleRate?: number;
  gain?: number;
  lipsyncLang?: string;
  lipsyncType?: "visemes" | "words" | "blendshapes";
  waitForAudioChunks?: boolean;
  mood?: Mood;
};

type Anim = {
  name: string;
  dt: number[];
  vs: Record<string, number[]>;
};

type StreamAudioPayload = {
  audio: ArrayBuffer | Int16Array | Uint8Array | Float32Array;
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  anims?: Anim[];
};

type TalkingHeadInstance = {
  showAvatar(avatar: { url: string; body?: "F" | "M"; avatarMood?: Mood; lipsyncLang?: string; ttsLang?: string; ttsVoice?: string }): Promise<void>;
  streamStart(
    opt?: StreamStartOpt,
    onAudioStart?: () => void,
    onAudioEnd?: () => void,
    onSubtitles?: (s: string) => void,
    onMetrics?: (m: unknown) => void,
  ): Promise<void>;
  streamAudio(r: StreamAudioPayload): void;
  streamNotifyEnd(): void;
  streamInterrupt(): void;
  streamStop(): void;
  setMood(mood: Mood): void;
  playGesture(name: string, duration?: number, mirror?: boolean, transitionMs?: number): void;
  stopGesture(transitionMs?: number): void;
  start(): void;
  stop(): void;
};

type TalkingHeadCtor = new (node: HTMLElement, opt: Record<string, unknown>) => TalkingHeadInstance;

// ─── Public ref API ──────────────────────────────────────────────────────────
export interface TalkingHeadAvatarHandle {
  /** Feed a chunk of Gemini PCM16 LE audio (24kHz mono). Component auto-handles envelope-based lipsync. */
  feedPcm(bytes: Uint8Array): void;
  /** Signal that no more audio is coming for this turn (fade out mouth). */
  notifyEnd(): void;
  /** Immediate stop: clear queue, close mouth. */
  interrupt(): void;
  /** Set emotion state. */
  setMood(mood: Mood): void;
  /** Play a named gesture (e.g. "thumbup", "index", "shrug"). */
  playGesture(name: string, durationSec?: number): void;
}

export interface TalkingHeadAvatarProps {
  avatarUrl: string;
  /** Default mood applied after load. */
  mood?: Mood;
  /** Called once the avatar GLB is loaded and streaming is ready. */
  onReady?: () => void;
  /** Called if loading or WebGL init fails. */
  onError?: (err: Error) => void;
  /** CSS className for the container. */
  className?: string;
  /** Camera framing: "full" | "upper" | "head" | "mid". */
  cameraView?: "full" | "upper" | "head" | "mid";
}

// ─── WebGL availability check ────────────────────────────────────────────────
function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// ─── RMS envelope → jawOpen blendshape anim ──────────────────────────────────
// Gemini Live delivers raw PCM audio without viseme or word timestamps. To drive
// mouth motion we compute a short-time RMS envelope of each chunk and emit a
// synchronous `anims` payload with `jawOpen` + `mouthOpen` values. This yields a
// convincing "talking mouth" without needing transcription.
const SAMPLE_RATE_HZ = 24000;
const FRAME_MS = 33; // ~30 fps
const SAMPLES_PER_FRAME = Math.floor((SAMPLE_RATE_HZ * FRAME_MS) / 1000);

function computeJawEnvelope(bytes: Uint8Array): { dt: number[]; jawOpen: number[]; mouthOpen: number[] } {
  const numSamples = Math.floor(bytes.byteLength / 2);
  if (numSamples === 0) return { dt: [], jawOpen: [], mouthOpen: [] };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numFrames = Math.max(1, Math.ceil(numSamples / SAMPLES_PER_FRAME));
  const jaw: number[] = [];
  const mouth: number[] = [];
  const dt: number[] = [];

  for (let f = 0; f < numFrames; f++) {
    const start = f * SAMPLES_PER_FRAME;
    const end = Math.min(start + SAMPLES_PER_FRAME, numSamples);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const s = view.getInt16(i * 2, true) / 32768;
      sumSq += s * s;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    // Non-linear map: emphasize vocal peaks while keeping quiet frames closed
    const jawVal = Math.min(0.55, Math.pow(rms * 3, 0.8));
    jaw.push(jawVal);
    mouth.push(jawVal * 0.75);
    dt.push(FRAME_MS);
  }

  return { dt, jawOpen: jaw, mouthOpen: mouth };
}

// ─── Component ───────────────────────────────────────────────────────────────
export const TalkingHeadAvatar = forwardRef<TalkingHeadAvatarHandle, TalkingHeadAvatarProps>(
  function TalkingHeadAvatar(
    { avatarUrl, mood = "neutral", onReady, onError, className, cameraView = "upper" },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<TalkingHeadInstance | null>(null);
    const readyRef = useRef(false);
    const [status, setStatus] = useState<"loading" | "ready" | "error" | "unsupported">("loading");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Stash callbacks so the init effect doesn't re-run on every render
    const onReadyRef = useRef(onReady);
    const onErrorRef = useRef(onError);
    useEffect(() => {
      onReadyRef.current = onReady;
      onErrorRef.current = onError;
    }, [onReady, onError]);

    // Mount: create TalkingHead, load avatar, start streaming
    useEffect(() => {
      if (!isWebGLAvailable()) {
        setStatus("unsupported");
        return;
      }
      const node = containerRef.current;
      if (!node) return;

      let cancelled = false;
      const Ctor = TalkingHeadLib as unknown as TalkingHeadCtor;
      const head = new Ctor(node, {
        // Avatar + lipsync
        lipsyncModules: ["en", "de"],
        lipsyncLang: "en",
        pcmSampleRate: SAMPLE_RATE_HZ,
        // We don't use built-in TTS — Gemini provides audio.
        ttsEndpoint: null,
        // Rendering
        modelPixelRatio: Math.min(2, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1),
        modelFPS: 30,
        cameraView,
        avatarMood: mood,
      });
      headRef.current = head;

      (async () => {
        try {
          await head.showAvatar({
            url: avatarUrl,
            body: "F",
            avatarMood: mood,
            lipsyncLang: "en",
          });
          if (cancelled) return;

          await head.streamStart({
            sampleRate: SAMPLE_RATE_HZ,
            gain: 1.0,
            lipsyncLang: "en",
            lipsyncType: "blendshapes",
            waitForAudioChunks: true,
            mood,
          });
          if (cancelled) return;

          readyRef.current = true;
          setStatus("ready");
          onReadyRef.current?.();
        } catch (err) {
          if (cancelled) return;
          const e = err instanceof Error ? err : new Error(String(err));
          setStatus("error");
          setErrorMsg(e.message);
          onErrorRef.current?.(e);
        }
      })();

      return () => {
        cancelled = true;
        readyRef.current = false;
        try {
          head.streamStop();
        } catch { /* already stopped */ }
        try {
          head.stop();
        } catch { /* ignore */ }
        headRef.current = null;
      };
      // avatarUrl / cameraView are the only inputs that warrant re-mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [avatarUrl, cameraView]);

    // Apply mood changes without re-mounting
    useEffect(() => {
      if (readyRef.current) {
        try { headRef.current?.setMood(mood); } catch { /* ignore */ }
      }
    }, [mood]);

    useImperativeHandle(ref, () => ({
      feedPcm(bytes: Uint8Array) {
        const head = headRef.current;
        if (!head || !readyRef.current) return;
        if (bytes.byteLength === 0) return;
        const { dt, jawOpen, mouthOpen } = computeJawEnvelope(bytes);
        // Copy the buffer slice so the transfer in streamAudio doesn't detach caller memory.
        // Cast to ArrayBuffer: Uint8Array backed by a regular ArrayBuffer always produces
        // an ArrayBuffer from slice(), but TS widens to ArrayBuffer|SharedArrayBuffer.
        const audioBuf = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        try {
          head.streamAudio({
            audio: audioBuf,
            anims: dt.length > 0
              ? [{ name: "blendshapes", dt, vs: { jawOpen, mouthOpen } }]
              : undefined,
          });
        } catch { /* transient frame error */ }
      },
      notifyEnd() {
        try { headRef.current?.streamNotifyEnd(); } catch { /* ignore */ }
      },
      interrupt() {
        try { headRef.current?.streamInterrupt(); } catch { /* ignore */ }
      },
      setMood(m: Mood) {
        try { headRef.current?.setMood(m); } catch { /* ignore */ }
      },
      playGesture(name: string, durationSec = 3) {
        try { headRef.current?.playGesture(name, durationSec, false, 1000); } catch { /* ignore */ }
      },
    }), []);

    return (
      <div className={className ?? "relative w-full h-full bg-cc-card"}>
        <div ref={containerRef} className="absolute inset-0" />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-cc-muted">
            Loading avatar...
          </div>
        )}
        {status === "unsupported" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-cc-muted text-center px-4">
            3D avatar unavailable (WebGL not supported)
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400 text-center px-4">
            Avatar failed to load{errorMsg ? `: ${errorMsg}` : ""}
          </div>
        )}
      </div>
    );
  },
);

export default TalkingHeadAvatar;
