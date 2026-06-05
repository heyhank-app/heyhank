// ─── Veo 3.1 (Google Gemini API) + Video Frame Extraction ─────────────────────
//
// Originally this module wrapped fal.ai's Seedance 2.0 talking-head model
// and Veo 3.1 via fal's queue. Those paths were removed 2026-05-22 after a
// failed productive run — Reels now go through Veo direct (Google Gemini
// API: `generativelanguage.googleapis.com/v1beta/models/veo-3.1-…`). The
// file name is kept for now to minimise blast radius across imports; the
// content is purely Google-Veo + helpers.
//
// Public API:
// - generateVeoGoogle / pollVeoGoogle: submit + poll Veo predict-long-running
// - buildVeoRequestBody / detectVeoMode: pure-fn helpers (unit-testable)
// - readImageAsBase64: image-input resolver for Veo's image-conditioning
// - extractVideoFrame: pull a JPEG frame from any mp4 (used by self-review)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HEYHANK_HOME } from "./paths.js";
import { getSettings } from "./settings-manager.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");

/** Resolve a `~`-prefixed path against the user's home directory. */
function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

// ─── Veo 3.1 via Google Gemini API ────────────────────────────────────────────

const GOOGLE_VEO_BASE = "https://generativelanguage.googleapis.com/v1beta";

function GEMINI_KEY(): string {
  return getSettings().geminiApiKey || process.env.GEMINI_API_KEY || "";
}

export type GoogleVeoModel =
  | "veo-3.1-generate-preview"
  | "veo-3.1-fast-generate-preview"
  | "veo-3.1-lite-generate-preview"
  | "veo-3.0-generate-001"
  | "veo-3.0-fast-generate-001";

/**
 * Default Veo model for reels. "lite" is the cheapest 3.1 tier and has its OWN
 * daily quota (separate from "fast"), so it's the safest default for cost +
 * rate-limit headroom. Override per call via params.model.
 */
export const DEFAULT_VEO_MODEL: GoogleVeoModel = "veo-3.1-lite-generate-preview";

/** Veo image-conditioning modes. Auto-detected from inputs if omitted. */
export type VeoMode = "text" | "firstFrame" | "firstLastFrame" | "reference";

export interface GoogleVeoParams {
  prompt: string;
  aspectRatio?: "9:16" | "16:9";
  durationSeconds?: 4 | 6 | 8;
  model?: GoogleVeoModel;
  /** Explicit mode override; otherwise inferred from which image fields are set. */
  mode?: VeoMode;
  /** First-frame conditioning image (firstFrame / firstLastFrame mode). */
  firstFrameImagePath?: string;
  /** Last-frame conditioning image (firstLastFrame mode). */
  lastFrameImagePath?: string;
  /** Subject-reference images (reference mode, 1–3 images). */
  referenceImagePaths?: string[];
  /** Legacy alias treated as referenceImagePaths if nothing else is set. */
  imageUrls?: string[];
}

export interface GoogleVeoOperation {
  operationName: string;
  done: boolean;
  videoPath?: string;
  error?: string;
}

/** MIME type lookup from a filename's extension (defaults to image/jpeg). */
function mimeFromExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "jpg":
    case "jpeg": return "image/jpeg";
    default: return "image/jpeg";
  }
}

/**
 * Resolve an image-ref reference to base64-encoded bytes + MIME.
 *
 * Accepted inputs:
 * - Absolute path: `/root/.heyhank/reference-images/person/x.jpeg`
 * - Home-relative: `~/.heyhank/reference-images/person/x.jpeg`
 * - HeyHank reference URL: `/api/references/file/<category>/<filename>`
 * - Remote URL: `https://...` (fetched + base64-encoded)
 */
export async function readImageAsBase64(
  pathOrUrl: string,
): Promise<{ data: string; mimeType: string }> {
  // Remote URL — fetch + base64.
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`Failed to fetch image ${pathOrUrl}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type")?.split(";")[0]?.trim();
    const mimeType = ct?.startsWith("image/") ? ct : mimeFromExt(pathOrUrl);
    return { data: buf.toString("base64"), mimeType };
  }

  // HeyHank reference URL — resolve to local file under reference-images/.
  const refMatch = pathOrUrl.match(/^\/api\/references\/file\/([^/]+)\/([^/]+)$/);
  let localPath: string;
  if (refMatch) {
    const category = decodeURIComponent(refMatch[1] ?? "");
    const filename = decodeURIComponent(refMatch[2] ?? "");
    localPath = join(HEYHANK_HOME, "reference-images", category, filename);
  } else {
    localPath = expandHome(pathOrUrl);
  }
  if (!existsSync(localPath)) {
    throw new Error(`Image not found: ${localPath}`);
  }
  const data = readFileSync(localPath).toString("base64");
  return { data, mimeType: mimeFromExt(localPath) };
}

/** Auto-detect Veo mode from which image-related params are populated. */
export function detectVeoMode(
  params: Pick<
    GoogleVeoParams,
    "mode" | "firstFrameImagePath" | "lastFrameImagePath" | "referenceImagePaths" | "imageUrls"
  >,
): VeoMode {
  if (params.mode) return params.mode;
  if (params.referenceImagePaths && params.referenceImagePaths.length > 0) return "reference";
  if (params.firstFrameImagePath && params.lastFrameImagePath) return "firstLastFrame";
  if (params.firstFrameImagePath) return "firstFrame";
  if (params.imageUrls && params.imageUrls.length > 0) return "reference";
  return "text";
}

/**
 * Build the Veo Predict-API request body for a given param set. Exposed
 * separately so the mode/image plumbing can be unit-tested without making
 * a real network call to Google.
 */
export async function buildVeoRequestBody(
  params: GoogleVeoParams,
): Promise<{ instances: Array<Record<string, unknown>>; parameters: Record<string, unknown> }> {
  const mode = detectVeoMode(params);
  const instance: Record<string, unknown> = { prompt: params.prompt };

  const encode = async (p: string) => {
    const { data, mimeType } = await readImageAsBase64(p);
    return { bytesBase64Encoded: data, mimeType };
  };

  if (mode === "firstFrame" && params.firstFrameImagePath) {
    instance["image"] = await encode(params.firstFrameImagePath);
  } else if (mode === "firstLastFrame" && params.firstFrameImagePath && params.lastFrameImagePath) {
    instance["image"] = await encode(params.firstFrameImagePath);
    instance["lastFrame"] = await encode(params.lastFrameImagePath);
  } else if (mode === "reference") {
    const sources = params.referenceImagePaths?.length
      ? params.referenceImagePaths
      : params.imageUrls ?? [];
    // Google Veo accepts at most 3 subject-reference images.
    const refs = await Promise.all(sources.slice(0, 3).map(encode));
    if (refs.length > 0) {
      instance["referenceImages"] = refs.map((image) => ({ image }));
    }
  }

  return {
    instances: [instance],
    parameters: {
      aspectRatio: params.aspectRatio ?? "9:16",
      durationSeconds: params.durationSeconds ?? 8,
      sampleCount: 1,
    },
  };
}

export async function generateVeoGoogle(
  params: GoogleVeoParams,
): Promise<{ operationName: string }> {
  const apiKey = GEMINI_KEY();
  if (!apiKey) throw new Error("geminiApiKey not configured in HeyHank settings");

  const model = params.model ?? DEFAULT_VEO_MODEL;
  const url = `${GOOGLE_VEO_BASE}/models/${model}:predictLongRunning?key=${apiKey}`;
  const body = await buildVeoRequestBody(params);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    // 429 = the Gemini/Veo plan's video quota is used up. Surface a clear,
    // actionable message instead of a raw API blob (Veo's free tier only allows
    // a handful of videos/day).
    if (res.status === 429) {
      throw new Error(
        "Google Veo quota exceeded — you've hit today's video limit on this Gemini plan. " +
          "Wait for the quota to reset or raise the limit in Google AI Studio billing, then try the reel again.",
      );
    }
    throw new Error(`Google Veo submit failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new Error("Google Veo response missing operation name");
  return { operationName: data.name };
}

export async function pollVeoGoogle(operationName: string): Promise<GoogleVeoOperation> {
  const apiKey = GEMINI_KEY();
  if (!apiKey) throw new Error("geminiApiKey not configured in HeyHank settings");

  const url = `${GOOGLE_VEO_BASE}/${operationName}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Veo poll failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    done?: boolean;
    error?: { message?: string };
    response?: {
      videos?: Array<{ bytesBase64Encoded?: string }>;
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string } }>;
      };
    };
  };

  if (data.error) {
    return { operationName, done: true, error: data.error.message ?? "unknown error" };
  }
  if (!data.done) {
    return { operationName, done: false };
  }

  const b64 = data.response?.videos?.[0]?.bytesBase64Encoded;
  const uri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!b64 && !uri) {
    return { operationName, done: true, error: "No video bytes or URI in response" };
  }

  mkdirSync(MEDIA_DIR, { recursive: true });
  const filename = `vid_veo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
  const filepath = join(MEDIA_DIR, filename);

  if (b64) {
    writeFileSync(filepath, Buffer.from(b64, "base64"));
  } else if (uri) {
    const downloadUrl = uri.includes("?") ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`;
    const vidRes = await fetch(downloadUrl);
    if (!vidRes.ok) {
      const text = await vidRes.text();
      return {
        operationName,
        done: true,
        error: `Veo URI download failed ${vidRes.status}: ${text.slice(0, 200)}`,
      };
    }
    writeFileSync(filepath, Buffer.from(await vidRes.arrayBuffer()));
  }

  return { operationName, done: true, videoPath: filepath };
}

// ─── Frame extraction (for self-verification by agents) ──────────────────────

/**
 * Extract a single frame from a generated video at a given timestamp.
 * Used by the Video Director agent to verify its own output before reporting
 * back to the user — Claude can read the resulting JPEG natively via Read.
 */
export async function extractVideoFrame(
  videoPath: string,
  timestampSeconds: number = 1,
): Promise<{ framePath: string }> {
  const expanded = expandHome(videoPath);
  if (!existsSync(expanded)) {
    throw new Error(`Video not found: ${expanded}`);
  }
  mkdirSync(MEDIA_DIR, { recursive: true });
  const framePath = join(
    MEDIA_DIR,
    `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
  );

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-ss",
      String(Math.max(0, timestampSeconds)),
      "-i",
      expanded,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg frame extract failed (code ${code}): ${errText.slice(-400)}`);
  }
  if (!existsSync(framePath)) {
    throw new Error(`ffmpeg produced no frame at ${framePath}`);
  }
  return { framePath };
}
