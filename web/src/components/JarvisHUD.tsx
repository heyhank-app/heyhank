// Jarvis-inspired HUD visualization — faceless, audio-reactive, low-CPU.
// Replaces the previous 3D TalkingHead avatar.
//
// Visual design:
//   • Concentric rotating rings, segmented mid ring, reticle ticks, glowing
//     energy core — Iron-man-HUD vibe without copying Marvel's Jarvis 1:1
//     (Marvel's Jarvis look & name are trademarked).
//   • Works in two layouts:
//       - compact (desktop: ~220px tile inside the overlay)
//       - immersive (mobile: fullscreen tile, label overlaid, bigger HUD)
//   • Dark teal background so the cyan HUD pops regardless of the app theme.
//
// Performance:
//   • Idle state renders pure CSS keyframes; no JS runs.
//   • A single rAF loop activates only while audio is actively arriving,
//     writes one CSS custom property per frame, and auto-stops after decay.
//   • Obeys prefers-reduced-motion by disabling animations.
//
// API compat: `JarvisHUDHandle` is a superset of the old
// `TalkingHeadAvatarHandle` so HankChat can swap components without
// reshuffling its ref calls.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type Mood = "neutral" | "happy" | "angry" | "sad" | "fear" | "disgust" | "love" | "sleep";

export interface JarvisHUDHandle {
  feedPcm(bytes: Uint8Array): void;
  notifyEnd(): void;
  interrupt(): void;
  setMood(mood: Mood): void;
  /** Compat — triggers a short "flare" on the outer ring. */
  playGesture(name: string, durationSec?: number): void;
}

export interface JarvisHUDProps {
  mood?: Mood;
  /** Immediate — there's nothing to load. Called on mount. */
  onReady?: () => void;
  /** Never called; kept for API compat with the old avatar component. */
  onError?: (err: Error) => void;
  className?: string;
  /** Parent-driven state (wins over audio-inferred state). */
  state?: "idle" | "listening" | "thinking" | "speaking";
  /** Short text shown under / over the HUD to describe current activity. */
  label?: string;
}

// PCM params — matches Gemini-Live (24 kHz mono, 16-bit LE).
const BYTES_PER_SAMPLE = 2;

/** Running RMS over a PCM16 LE chunk, normalized to ~[0,1]. */
function chunkRms(bytes: Uint8Array): number {
  const n = Math.floor(bytes.byteLength / BYTES_PER_SAMPLE);
  if (n === 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * BYTES_PER_SAMPLE, true) / 32768;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  // Voice-ish content rarely exceeds 0.3 RMS — expand to visible range.
  return Math.min(1, rms * 3.2);
}

export const JarvisHUD = forwardRef<JarvisHUDHandle, JarvisHUDProps>(
  function JarvisHUD({ onReady, className, state, label }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const targetAmpRef = useRef(0);
    const smoothedAmpRef = useRef(0);
    const rafIdRef = useRef<number | null>(null);
    const lastAudioAtRef = useRef(0);
    const gestureUntilRef = useRef(0);
    const [localState, setLocalState] = useState<"idle" | "speaking" | "flared">("idle");

    // Announce ready immediately — no async GLB to fetch.
    useEffect(() => {
      onReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function tick() {
      const now = performance.now();
      const msSinceAudio = now - lastAudioAtRef.current;
      if (msSinceAudio > 120) targetAmpRef.current *= 0.92;

      const t = targetAmpRef.current;
      const s = smoothedAmpRef.current;
      // Asymmetric EMA: fast attack, slow release — mimics perceived mouth motion.
      const alpha = t > s ? 0.35 : 0.08;
      const next = s + (t - s) * alpha;
      smoothedAmpRef.current = next;

      const el = rootRef.current;
      if (el) el.style.setProperty("--jarvis-amp", next.toFixed(3));

      const stillFlared = now < gestureUntilRef.current;
      if (next < 0.01 && targetAmpRef.current < 0.01 && !stillFlared) {
        if (el) el.style.setProperty("--jarvis-amp", "0");
        smoothedAmpRef.current = 0;
        rafIdRef.current = null;
        setLocalState("idle");
        return;
      }

      if (next > 0.05 && !stillFlared) setLocalState("speaking");
      else if (stillFlared) setLocalState("flared");
      rafIdRef.current = requestAnimationFrame(tick);
    }

    function ensureRaf() {
      if (rafIdRef.current == null) rafIdRef.current = requestAnimationFrame(tick);
    }

    useEffect(() => {
      return () => {
        if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      feedPcm(bytes: Uint8Array) {
        if (bytes.byteLength === 0) return;
        const amp = chunkRms(bytes);
        targetAmpRef.current = Math.max(targetAmpRef.current * 0.6, amp);
        lastAudioAtRef.current = performance.now();
        ensureRaf();
      },
      notifyEnd() {
        targetAmpRef.current *= 0.5;
        ensureRaf();
      },
      interrupt() {
        targetAmpRef.current = 0;
        smoothedAmpRef.current = 0;
        const el = rootRef.current;
        if (el) el.style.setProperty("--jarvis-amp", "0");
      },
      setMood(_mood: Mood) { /* reserved for future hue shift */ },
      playGesture(_name: string, durationSec = 1.5) {
        gestureUntilRef.current = performance.now() + durationSec * 1000;
        ensureRaf();
        setLocalState("flared");
      },
    }), []);

    // Parent-provided state wins so "thinking" shows even before any audio.
    const renderState = state ?? (localState === "flared" ? "thinking" : localState);

    return (
      <div
        ref={rootRef}
        className={className ?? "absolute inset-0 flex items-center justify-center overflow-hidden"}
        data-jarvis-state={renderState}
        style={{ ["--jarvis-amp" as string]: "0" }}
      >
        <style>{jarvisCss}</style>

        {/* Subtle radial vignette so the dark container has depth */}
        <div className="jarvis-bg" aria-hidden="true" />

        <svg viewBox="0 0 200 200" className="jarvis-svg" aria-hidden="true">
          <defs>
            <radialGradient id="jarvisOrb" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#d8f3ff" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#3aa8ff" stopOpacity="0.8" />
              <stop offset="70%" stopColor="#0a5ec4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0a5ec4" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="jarvisCore" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#8ad4ff" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#2b8bff" stopOpacity="0" />
            </radialGradient>
            <filter id="jarvisGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer ring with ticks — slow rotation */}
          <g className="jarvis-ring-outer" transform="translate(100 100)">
            <circle r="94" fill="none" stroke="#3aa8ff" strokeOpacity="0.25" strokeWidth="0.5" />
            <circle
              r="90"
              fill="none"
              stroke="#7fd0ff"
              strokeOpacity="0.55"
              strokeWidth="0.8"
              strokeDasharray="1.5 5"
            />
          </g>

          {/* Mid ring — 4 bold arc segments, reverse rotation */}
          <g className="jarvis-ring-mid" transform="translate(100 100)">
            {[0, 90, 180, 270].map((a) => (
              <path
                key={a}
                d={describeArc(0, 0, 72, a + 8, a + 82)}
                fill="none"
                stroke="#5bbcff"
                strokeOpacity="0.85"
                strokeWidth="1.3"
                filter="url(#jarvisGlow)"
              />
            ))}
            {[0, 90, 180, 270].map((a) => {
              const rad = ((a - 3) * Math.PI) / 180;
              return (
                <line
                  key={`t-${a}`}
                  x1={68 * Math.cos(rad)}
                  y1={68 * Math.sin(rad)}
                  x2={78 * Math.cos(rad)}
                  y2={78 * Math.sin(rad)}
                  stroke="#5bbcff"
                  strokeOpacity="0.9"
                  strokeWidth="1.2"
                />
              );
            })}
          </g>

          {/* Audio-reactive ring — scales with --jarvis-amp */}
          <g className="jarvis-ring-react" transform="translate(100 100)">
            <circle
              r="55"
              fill="none"
              stroke="#7fd0ff"
              strokeOpacity="0.9"
              strokeWidth="1.5"
              filter="url(#jarvisGlow)"
            />
          </g>

          {/* Reticle crosshair — static */}
          <g stroke="#5bbcff" strokeOpacity="0.4" strokeWidth="0.7">
            <line x1="100" y1="38" x2="100" y2="50" />
            <line x1="100" y1="150" x2="100" y2="162" />
            <line x1="38" y1="100" x2="50" y2="100" />
            <line x1="150" y1="100" x2="162" y2="100" />
          </g>

          {/* Energy core — scales + glows with --jarvis-amp */}
          <g className="jarvis-core" transform="translate(100 100)">
            <circle r="40" fill="url(#jarvisOrb)" />
            <circle r="22" fill="url(#jarvisCore)" />
            <circle r="3.5" fill="#eafaff" fillOpacity="0.95" />
          </g>

          {/* Scan line — only visible while thinking */}
          <g className="jarvis-scan" transform="translate(100 100)">
            <line
              x1="-62"
              y1="0"
              x2="62"
              y2="0"
              stroke="#7fd0ff"
              strokeOpacity="0.55"
              strokeWidth="0.9"
              filter="url(#jarvisGlow)"
            />
          </g>
        </svg>

        {label && (
          <div className="jarvis-label">
            <span className="jarvis-dot" />
            {label}
          </div>
        )}
      </div>
    );
  },
);

export default JarvisHUD;

// ─── SVG arc helper (degrees, 0° = +x axis) ──────────────────────────────────
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// ─── Styles (scoped via data attribute on the root) ──────────────────────────
// Inlined so the component is drop-in and doesn't depend on any global CSS.
const jarvisCss = `
[data-jarvis-state] {
  --jarvis-amp: 0;
  color: #bfe4ff;
}
.jarvis-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(58,168,255,0.18) 0%, rgba(6,16,28,0) 60%),
    linear-gradient(180deg, #08131f 0%, #06101c 100%);
  pointer-events: none;
}
.jarvis-svg {
  position: relative;
  width: min(88%, 320px);
  aspect-ratio: 1 / 1;
  display: block;
  filter: drop-shadow(0 0 calc(6px + var(--jarvis-amp) * 18px) rgba(58,168,255,0.35));
}
/* NOTE: CSS transform overrides any SVG transform= attribute on the same
   element, so these keyframes MUST bake in translate(100px, 100px) to keep
   the group centered on (100,100) within the 200x200 viewBox. Omitting it
   caused the rings to orbit off-center. */
.jarvis-ring-outer {
  animation: jarvis-spin-outer 42s linear infinite;
}
.jarvis-ring-mid {
  animation: jarvis-spin-mid 22s linear infinite;
}
.jarvis-ring-react {
  transform-origin: 100px 100px;
  transform: translate(100px, 100px) scale(calc(1 + var(--jarvis-amp) * 0.30));
  transition: transform 60ms linear;
  opacity: calc(0.4 + var(--jarvis-amp) * 0.6);
}
.jarvis-core {
  transform-origin: 100px 100px;
  transform: translate(100px, 100px) scale(calc(1 + var(--jarvis-amp) * 0.20));
  transition: transform 80ms linear;
  animation: jarvis-core-idle 3.2s ease-in-out infinite;
}
.jarvis-scan {
  transform-origin: 100px 100px;
  opacity: 0;
  transform: translate(100px, 100px) rotate(0deg);
}
[data-jarvis-state="thinking"] .jarvis-scan {
  opacity: 1;
  animation: jarvis-scan-spin 1.5s linear infinite;
}
[data-jarvis-state="thinking"] .jarvis-ring-mid {
  animation: jarvis-spin-mid 5s linear infinite;
}
[data-jarvis-state="speaking"] .jarvis-core {
  animation: none;
}

.jarvis-label {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #bfe4ff;
  background: rgba(6, 16, 28, 0.55);
  border: 1px solid rgba(127,208,255,0.22);
  border-radius: 999px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  white-space: nowrap;
  max-width: calc(100% - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
}
.jarvis-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #7fd0ff;
  box-shadow: 0 0 6px #7fd0ff;
  animation: jarvis-dot-pulse 1.8s ease-in-out infinite;
}
[data-jarvis-state="speaking"] .jarvis-dot { background: #a8f0c0; box-shadow: 0 0 8px #a8f0c0; }
[data-jarvis-state="thinking"] .jarvis-dot { background: #ffd36b; box-shadow: 0 0 8px #ffd36b; }
[data-jarvis-state="idle"] .jarvis-dot { background: #7fd0ff; }

@keyframes jarvis-spin-outer {
  from { transform: translate(100px, 100px) rotate(0deg); }
  to   { transform: translate(100px, 100px) rotate(360deg); }
}
@keyframes jarvis-spin-mid {
  from { transform: translate(100px, 100px) rotate(0deg); }
  to   { transform: translate(100px, 100px) rotate(-360deg); }
}
@keyframes jarvis-core-idle {
  0%, 100% { transform: translate(100px, 100px) scale(1); opacity: 0.92; }
  50%      { transform: translate(100px, 100px) scale(1.04); opacity: 1; }
}
@keyframes jarvis-scan-spin {
  from { transform: translate(100px, 100px) rotate(0deg); }
  to   { transform: translate(100px, 100px) rotate(360deg); }
}
@keyframes jarvis-dot-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .jarvis-ring-outer, .jarvis-ring-mid, .jarvis-core, .jarvis-scan, .jarvis-dot {
    animation: none !important;
  }
}
`;
