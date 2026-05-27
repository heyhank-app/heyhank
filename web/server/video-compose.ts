// Slideshow compositor — concatenates image + video segments into a single
// vertical reel (720x1280) with optional per-segment text overlays and audio.
//
// Built on ffmpeg: each segment is normalised to a uniform mp4 (matching
// codec, resolution, fps, audio), then concatenated via the concat demuxer
// with `-c copy` so the final stitch is fast and lossless.
//
// Used by POST /api/video/compose. Sister-modules:
// - brand-themes.ts: colour palette per topic (Claude, OpenAI, …, neutral)
// - fal-video.ts: extractVideoFrame() reuses the same ffmpeg invocation style

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HEYHANK_HOME } from "./paths.js";
import { getTheme, type BrandTheme } from "./brand-themes.js";
import { resolveLogo, type LogoResolution } from "./logo-resolver.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");
const REEL_WIDTH = 720;
const REEL_HEIGHT = 1280;
const FPS = 30;

const FONT_BOLD = "/usr/share/fonts/truetype/lato/Lato-Bold.ttf";
const FONT_REGULAR = "/usr/share/fonts/truetype/lato/Lato-Regular.ttf";

/**
 * Position for a text overlay.
 *
 * - "top"/"center"/"bottom": horizontally centered with default y offset.
 * - `{ y: number }`: horizontally centered at this exact y.
 * - `{ x: number; y: number }`: explicit top-left of the text box (no centering).
 */
export type OverlayPosition =
  | "top"
  | "center"
  | "bottom"
  | { y: number }
  | { x: number; y: number };

/** Single text overlay applied during a segment. */
export interface TextOverlay {
  /** Literal string. Multi-line supported via `\n`. */
  text: string;
  /** Vertical position or explicit y in px. Default "center". */
  position?: OverlayPosition;
  /** Font size in px. Default 56. */
  fontSize?: number;
  /** Font colour. Default theme.headline. */
  color?: string;
  /** Background box colour. If set, drawtext adds a padded box. */
  bgColor?: string;
  /** Box padding in px around the text. Default 16. */
  bgPadding?: number;
  /** Use the bold font (Lato-Bold). Default true. */
  bold?: boolean;
  /** Start time in segment-local seconds (default 0 — visible from start). */
  startSeconds?: number;
  /** End time in segment-local seconds (default segment duration). */
  endSeconds?: number;
  /**
   * Auto-wrap long text to fit within this width in px. If unset, text renders
   * on a single line and may overflow the canvas. Wrapping is char-count based
   * (approximate avg-char-width = fontSize * 0.55), so monospace + extreme
   * glyphs may still over/underflow by a few px.
   */
  maxWidth?: number;
  /** Line height multiplier for wrapped text. Default 1.15. */
  lineHeight?: number;
}

/**
 * One brand logo to overlay on a segment. The compositor resolves the slug
 * to `~/.heyhank/reference-images/logos/<slug>.png` and falls back to a
 * generated placeholder if the file is missing (see logo-resolver.ts).
 */
export interface LogoOverlay {
  /** Brand slug (e.g. "claude", "openai"). */
  brand: string;
  /** Override logo width in px (height auto). Default 80. */
  width?: number;
  /** Hide the auto-generated brand-name text label next to the logo. Default false. */
  hideLabel?: boolean;
}

export type ComposeSegment =
  | {
      type: "image";
      /** Absolute path to a PNG/JPG file. */
      path: string;
      /** Display duration in seconds. */
      durationSeconds: number;
      /** Optional overlay stack. Drawn in array order (last = on top). */
      textOverlays?: TextOverlay[];
      /** Optional brand logos. Adam-Hafner-style vertical stack in top-left. */
      logos?: LogoOverlay[];
      /** Optional audio (mp3/wav) played during this segment. */
      audioPath?: string;
    }
  | {
      type: "video";
      /** Absolute path to an mp4. */
      path: string;
      /** Duration to trim to. If omitted, full clip length is used. */
      durationSeconds?: number;
      textOverlays?: TextOverlay[];
      logos?: LogoOverlay[];
      /** When true, mutes original audio and uses audioPath if set. */
      replaceAudio?: boolean;
      audioPath?: string;
    };

export interface ComposeRequest {
  segments: ComposeSegment[];
  /** Brand slug (claude, openai, …). Determines theme colours. Default "neutral". */
  brand?: string;
  /** Output basename (no extension). Default `reel_<ts>_<rnd>`. */
  outputName?: string;
}

export interface ComposeResult {
  /** Absolute path to the final mp4 inside `~/.heyhank/media/`. */
  videoPath: string;
  /** Brand theme that was actually applied. */
  themeSlug: string;
  /** Total duration in seconds (sum of segment durations). */
  durationSeconds: number;
  /** Brand slugs for which a placeholder logo was used (missing real file). */
  placeholderLogos: string[];
}

/**
 * Escape a string for ffmpeg drawtext's `text=` parameter.
 *
 * drawtext treats these characters specially: `:` (filter separator),
 * `\` (escape), `'` (string boundary), `%` (variable expansion), `,`
 * (filter list separator). Inside the quoted `text='...'` form, a literal
 * single quote becomes `'\''` (close, escaped quote, reopen).
 *
 * Newlines need explicit escaping: drawtext renders `\n` as a line break
 * only when `text` contains the literal two chars backslash-n.
 */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’") // smart quote — avoids the close-escape-reopen dance
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

function resolveYExpr(position: OverlayPosition | undefined, fontSize: number): string {
  if (!position || position === "center") {
    return `(h-text_h)/2`;
  }
  if (position === "top") {
    return `${Math.max(40, fontSize)}`;
  }
  if (position === "bottom") {
    return `h-text_h-${Math.max(40, fontSize)}`;
  }
  if (typeof position === "object" && "y" in position) {
    return String(position.y);
  }
  return `(h-text_h)/2`;
}

/**
 * X position expression for drawtext.
 *
 * - For "top"/"center"/"bottom" or `{ y }` only: horizontally centered.
 * - For `{ x, y }`: explicit literal x.
 */
function resolveXExpr(position: OverlayPosition | undefined): string {
  if (typeof position === "object" && "x" in position) {
    return String(position.x);
  }
  return `(w-text_w)/2`;
}

/**
 * Greedy word-wrap that fits the given char-budget per line. Words longer
 * than the budget are kept on their own line rather than being split — better
 * a wide outlier than a mid-word break that confuses readers.
 *
 * Returns an array of lines.
 */
export function wrapTextToWidth(text: string, maxCharsPerLine: number): string[] {
  if (maxCharsPerLine <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      out.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Render a single overlay as one drawtext filter clause. */
export function buildDrawtextFilter(overlay: TextOverlay, theme: BrandTheme): string {
  const fontSize = overlay.fontSize ?? 56;
  const color = overlay.color ?? theme.headline;
  const fontfile = (overlay.bold ?? true) ? FONT_BOLD : FONT_REGULAR;
  const text = escapeDrawtext(overlay.text);
  const x = `(w-text_w)/2`;
  const y = resolveYExpr(overlay.position, fontSize);
  const enable = enableExpr(overlay.startSeconds, overlay.endSeconds);

  const xExpr = resolveXExpr(overlay.position) === `(w-text_w)/2` ? x : resolveXExpr(overlay.position);
  const parts = [
    `drawtext=fontfile=${fontfile}`,
    `text='${text}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `x=${xExpr}`,
    `y=${y}`,
  ];
  if (overlay.bgColor) {
    const pad = overlay.bgPadding ?? 16;
    parts.push(`box=1`, `boxcolor=${overlay.bgColor}@0.92`, `boxborderw=${pad}`);
  }
  if (enable) parts.push(`enable='${enable}'`);
  return parts.join(":");
}

/**
 * Expand an overlay with maxWidth or embedded `\n` into multiple drawtext
 * filter clauses — one per wrapped line. Returns the joined filter chain.
 *
 * Behaviour:
 * - maxWidth → wrap by approximate-char-count (fontSize * 0.55 per char).
 * - `\n` in input → forced line break.
 * - No maxWidth + no `\n` → single line, falls through to buildDrawtextFilter.
 *
 * Line spacing uses lineHeight × fontSize. The supplied y position applies
 * to the FIRST line; subsequent lines are offset downward.
 */
export function expandOverlayToLines(overlay: TextOverlay, theme: BrandTheme): string {
  const needsWrap = overlay.maxWidth != null || overlay.text.includes("\n");
  if (!needsWrap) {
    return buildDrawtextFilter(overlay, theme);
  }
  const fontSize = overlay.fontSize ?? 56;
  const lineHeight = overlay.lineHeight ?? 1.15;
  // Average char width for sans-serif at fontSize ~ 0.55 × fontSize.
  const charsPerLine = overlay.maxWidth
    ? Math.max(1, Math.floor(overlay.maxWidth / (fontSize * 0.55)))
    : Number.POSITIVE_INFINITY;
  const lines = wrapTextToWidth(overlay.text, charsPerLine);
  const lineSpacing = Math.round(fontSize * lineHeight);

  // resolveYExpr returns an expression for the FIRST line. Subsequent lines
  // get the same expression with a numeric offset added.
  const firstYExpr = resolveYExpr(overlay.position, fontSize);
  const clauses: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const yExpr = i === 0 ? firstYExpr : `${firstYExpr}+${i * lineSpacing}`;
    clauses.push(
      buildDrawtextFilter(
        {
          ...overlay,
          text: lines[i],
          position: { y: 0 }, // placeholder — we override the y in the clause below
        },
        theme,
      ).replace(/y=[^:]+/, `y=${yExpr}`),
    );
  }
  return clauses.join(",");
}

function enableExpr(start?: number, end?: number): string | null {
  if (start == null && end == null) return null;
  const s = start ?? 0;
  if (end == null) return `gte(t,${s})`;
  return `between(t,${s},${end})`;
}

/**
 * Build the full -vf chain for a segment: scale/pad to 9:16 canvas, then
 * apply each overlay in order.
 *
 * `bgColor` defines the padded canvas colour when the input doesn't fill
 * the 720x1280 frame (e.g. a portrait-cropped 9:16 video that is the right
 * aspect already passes through padding unchanged).
 */
function buildVfChain(
  overlays: TextOverlay[],
  theme: BrandTheme,
  bgColor: string,
): string {
  const canvas = `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`;
  if (overlays.length === 0) return canvas;
  const drawClauses = overlays.map((o) => expandOverlayToLines(o, theme)).join(",");
  return `${canvas},${drawClauses}`;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: string[] = [];
    p.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Trailing tail of stderr is where ffmpeg puts the actual error.
        const tail = stderr.join("").split("\n").slice(-20).join("\n");
        reject(new Error(`ffmpeg exited with code ${code}\n${tail}`));
      }
    });
  });
}

/**
 * Adam-Hafner-style vertical stack in top-left for brand logos.
 * Each logo is preceded by its position record (x, y, width) and accompanied
 * by an auto-generated brand-name text label to the right of it.
 */
interface LogoPlacement {
  resolution: LogoResolution;
  logoX: number;
  logoY: number;
  logoWidth: number;
  /** Auto-generated brand-name overlay. null when hideLabel: true. */
  label: TextOverlay | null;
}

async function planLogoOverlays(
  logos: LogoOverlay[] | undefined,
  theme: BrandTheme,
): Promise<{ placements: LogoPlacement[]; placeholderSlugs: string[] }> {
  if (!logos || logos.length === 0) return { placements: [], placeholderSlugs: [] };

  const PAD_LEFT = 40;
  const PAD_TOP = 80;
  const ROW_SPACING = 16;
  const DEFAULT_LOGO_WIDTH = 80;
  const TEXT_GAP = 14;
  const TEXT_FONT_SIZE = 28;

  const placements: LogoPlacement[] = [];
  const placeholderSlugs: string[] = [];
  let y = PAD_TOP;
  for (const logo of logos) {
    const resolution = await resolveLogo(logo.brand);
    if (resolution.isPlaceholder) placeholderSlugs.push(logo.brand);
    const logoWidth = logo.width ?? DEFAULT_LOGO_WIDTH;
    const label: TextOverlay | null = logo.hideLabel
      ? null
      : {
          // Brand-name label sits to the right of the logo, vertically centred.
          text: logo.brand.toUpperCase(),
          position: { x: PAD_LEFT + logoWidth + TEXT_GAP, y: Math.round(y + (logoWidth - TEXT_FONT_SIZE) / 2) },
          fontSize: TEXT_FONT_SIZE,
          color: theme.headline,
          bold: true,
        };
    placements.push({ resolution, logoX: PAD_LEFT, logoY: y, logoWidth, label });
    y += logoWidth + ROW_SPACING;
  }
  return { placements, placeholderSlugs };
}

/**
 * Normalise one segment to a uniform 720x1280 mp4.
 *
 * Always uses `-filter_complex` (even without logos) so the same code path
 * handles both cases. Returns the slugs whose logos were rendered as
 * placeholders — callers (composeReel) aggregate these into the result.
 */
async function renderSegment(
  segment: ComposeSegment,
  theme: BrandTheme,
  outputPath: string,
): Promise<string[]> {
  const bgColor = theme.bg;
  const { placements, placeholderSlugs } = await planLogoOverlays(segment.logos, theme);

  // User text overlays come first; auto-generated brand labels go on top.
  const allOverlays: TextOverlay[] = [
    ...(segment.textOverlays ?? []),
    ...placements.filter((p) => p.label).map((p) => p.label!),
  ];

  // Build the input block. Order matters: ffmpeg reads inputs left-to-right
  // and the filter_complex below references them by their input index.
  const inputs: string[] = [];
  let videoIdx: number;
  let audioIdx: number;
  let logoInputStart: number;

  if (segment.type === "image") {
    inputs.push("-loop", "1", "-t", String(segment.durationSeconds), "-i", segment.path);
    videoIdx = 0;
    if (segment.audioPath) {
      inputs.push("-i", segment.audioPath);
    } else {
      inputs.push("-f", "lavfi", "-t", String(segment.durationSeconds), "-i", "anullsrc=r=48000:cl=stereo");
    }
    audioIdx = 1;
    logoInputStart = 2;
  } else {
    inputs.push("-i", segment.path);
    videoIdx = 0;
    if (segment.replaceAudio && segment.audioPath) {
      inputs.push("-i", segment.audioPath);
      audioIdx = 1;
      logoInputStart = 2;
    } else if (segment.replaceAudio) {
      inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      audioIdx = 1;
      logoInputStart = 2;
    } else {
      // Original audio from input 0.
      audioIdx = 0;
      logoInputStart = 1;
    }
  }

  // Append logo inputs.
  for (const p of placements) {
    inputs.push("-i", p.resolution.path);
  }

  // Build filter_complex chain.
  const canvas = `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`;
  const drawClauses = allOverlays.map((o) => expandOverlayToLines(o, theme));
  const drawChain = drawClauses.length > 0 ? `,${drawClauses.join(",")}` : "";

  const filters: string[] = [];
  // First filter produces the background+overlays. Named [bg] if logos will
  // chain on top, otherwise terminal [vout] directly.
  const baseLabel = placements.length > 0 ? "bg" : "vout";
  filters.push(`[${videoIdx}:v]${canvas}${drawChain}[${baseLabel}]`);

  let prev = baseLabel;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const logoIdx = logoInputStart + i;
    filters.push(`[${logoIdx}:v]scale=${p.logoWidth}:-1[l${i}]`);
    const nextLabel = i === placements.length - 1 ? "vout" : `v${i}`;
    filters.push(`[${prev}][l${i}]overlay=${p.logoX}:${p.logoY}[${nextLabel}]`);
    prev = nextLabel;
  }
  const filterComplex = filters.join(";");

  const output: string[] = [
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `${audioIdx}:a:0`,
    "-r", String(FPS),
  ];
  if (segment.type === "video" && segment.durationSeconds != null) {
    output.push("-t", String(segment.durationSeconds));
  }
  // `-shortest` matters for images (silent-audio length-match) and for
  // videos where we replaced audio with a possibly-shorter clip.
  if (segment.type === "image" || segment.replaceAudio) {
    output.push("-shortest");
  }
  output.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-pix_fmt", "yuv420p",
    // Audio MUST be uniform across all segments — concat demuxer with `-c copy`
    // requires identical codec/profile/sample-rate/channels, otherwise the
    // joined timeline has overlapping/jumpy PTS at boundaries (visible to the
    // viewer as a freeze right where the next segment starts). 48 kHz stereo
    // matches Veo's native rate and re-encodes TTS (24 kHz mono) cleanly up.
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-ac", "2",
    outputPath,
  );

  await runFfmpeg(["-y", ...inputs, ...output]);
  return placeholderSlugs;
}

/**
 * Compose a reel from segments.
 *
 * Pipeline:
 * 1. Render each segment to a uniform-format mp4 in a temp dir.
 * 2. Write a concat-demuxer list and stitch with `-c copy` (fast).
 * 3. Move the final mp4 into ~/.heyhank/media/ and return its path.
 *
 * Throws if no segments are provided, if ffmpeg fails on any segment, or
 * if the input paths point to missing files (ffmpeg surfaces those errors).
 */
export async function composeReel(request: ComposeRequest): Promise<ComposeResult> {
  if (!Array.isArray(request.segments) || request.segments.length === 0) {
    throw new Error("composeReel: at least one segment is required");
  }
  const theme = getTheme(request.brand ?? "neutral");
  mkdirSync(MEDIA_DIR, { recursive: true });

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const baseName = request.outputName?.replace(/\.[^.]+$/, "") ?? `reel_${ts}_${rand}`;
  const outputPath = join(MEDIA_DIR, `${baseName}.mp4`);

  const workDir = mkdtempSync(join(tmpdir(), "heyhank-compose-"));
  try {
    const segmentPaths: string[] = [];
    const placeholderLogoSet = new Set<string>();
    for (let i = 0; i < request.segments.length; i++) {
      const segPath = join(workDir, `seg_${String(i).padStart(3, "0")}.mp4`);
      const phs = await renderSegment(request.segments[i], theme, segPath);
      for (const slug of phs) placeholderLogoSet.add(slug);
      segmentPaths.push(segPath);
    }

    // Write concat list. ffmpeg concat demuxer requires the `file` directive
    // with shell-escaped paths.
    const listPath = join(workDir, "concat.txt");
    const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(listPath, listBody);

    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outputPath,
    ]);

    const totalDuration = request.segments.reduce((sum, s) => {
      if (s.type === "image") return sum + s.durationSeconds;
      return sum + (s.durationSeconds ?? 0);
    }, 0);

    return {
      videoPath: outputPath,
      themeSlug: theme.slug,
      durationSeconds: totalDuration,
      placeholderLogos: [...placeholderLogoSet],
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
