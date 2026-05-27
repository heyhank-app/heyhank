// ─── Video Routes ─────────────────────────────────────────────────────────────
//
// Endpoints for the Reel pipeline:
// - POST /video/veo-google — submit a Veo 3.1 generation (Google direct API)
// - GET  /video/veo-google/status — poll an in-flight Veo operation
// - POST /video/frame — extract a JPEG frame from any mp4
// - POST /video/tts — Gemini TTS → mp3
// - POST /video/compose — stitch image + video segments into a final reel
//
// The fal.ai Seedance + fal-Veo wrappers + clone references were removed
// 2026-05-22 — the Reel pipeline now uses Veo direct (Google Gemini API)
// for video generation, gpt-image-2 for stills, and ffmpeg/Gemini TTS for
// composition + voice. File name kept (`fal-video-routes.ts`) to minimise
// blast radius; it has been a misnomer since the switch.

import type { Hono } from "hono";
import {
  generateVeoGoogle,
  pollVeoGoogle,
  extractVideoFrame,
  type VeoMode,
} from "../fal-video.js";

const VALID_VEO_MODES: ReadonlySet<VeoMode> = new Set([
  "text",
  "firstFrame",
  "firstLastFrame",
  "reference",
]);

/** Returns value as string[] if every element is a non-empty string, else undefined. */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || !v.trim()) return undefined;
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

export function registerFalVideoRoutes(api: Hono): void {
  /**
   * Submit a Veo 3.1 generation via Google Gemini API.
   *
   * Body fields:
   * - prompt            (string, required)
   * - aspectRatio       ("9:16" | "16:9", default "9:16")
   * - durationSeconds   (4 | 6 | 8, default 8 — invalid values rounded up)
   * - model             (GoogleVeoModel, default "veo-3.1-fast-generate-preview")
   * - mode              ("text"|"firstFrame"|"firstLastFrame"|"reference",
   *                       default auto-detected from image fields)
   * - firstFrameImagePath   (string)  — local path / ~ / /api/references/file/...
   * - lastFrameImagePath    (string)
   * - referenceImagePaths   (string[]) — up to 3 for subject-consistency
   * - imageUrls             (string[]) — legacy alias for referenceImagePaths
   */
  api.post("/video/veo-google", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return c.json({ error: "prompt is required" }, 400);
    }
    const dur = typeof body.durationSeconds === "number" ? body.durationSeconds : 8;
    const validDurs = [4, 6, 8] as const;
    const durationSeconds = (validDurs.find((d) => d >= dur) ?? 8) as 4 | 6 | 8;
    const mode = typeof body.mode === "string" && VALID_VEO_MODES.has(body.mode as VeoMode)
      ? (body.mode as VeoMode)
      : undefined;
    try {
      const op = await generateVeoGoogle({
        prompt: body.prompt.trim(),
        aspectRatio: body.aspectRatio === "16:9" ? "16:9" : "9:16",
        durationSeconds,
        model: body.model,
        mode,
        firstFrameImagePath:
          typeof body.firstFrameImagePath === "string" && body.firstFrameImagePath.trim()
            ? body.firstFrameImagePath
            : undefined,
        lastFrameImagePath:
          typeof body.lastFrameImagePath === "string" && body.lastFrameImagePath.trim()
            ? body.lastFrameImagePath
            : undefined,
        referenceImagePaths: stringArray(body.referenceImagePaths),
        imageUrls: stringArray(body.imageUrls),
      });
      return c.json({ ok: true, operationName: op.operationName });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * Extract a single frame from a generated video so the agent can verify
   * its own output via the Read tool (Claude reads images natively).
   *
   * Body: { videoPath: string, timestampSeconds?: number } (default 1s)
   * Returns: { ok: true, framePath: string }
   */
  api.post("/video/frame", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.videoPath !== "string" || !body.videoPath.trim()) {
      return c.json({ error: "videoPath is required" }, 400);
    }
    const ts = typeof body.timestampSeconds === "number" && body.timestampSeconds >= 0
      ? body.timestampSeconds
      : 1;
    try {
      const { framePath } = await extractVideoFrame(body.videoPath, ts);
      return c.json({ ok: true, framePath });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Poll a Google Veo operation by its operation name. */
  api.get("/video/veo-google/status", async (c) => {
    const operationName = c.req.query("operationName");
    if (!operationName) {
      return c.json({ error: "operationName query parameter is required" }, 400);
    }
    try {
      const result = await pollVeoGoogle(operationName);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * Generate speech audio from text via Gemini TTS.
   *
   * Body: { text: string, voice?: GeminiVoice, model?: GeminiTtsModel,
   *          style?: string, noCache?: boolean }
   * Returns: { ok: true, audioPath, cached, size }
   *
   * Identical (text + voice + model + style) requests reuse the cached mp3,
   * so the agent can iterate cheaply during reel-script tuning.
   */
  api.post("/video/tts", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.text !== "string" || !body.text.trim()) {
      return c.json({ error: "text is required" }, 400);
    }
    try {
      const { generateTts } = await import("../gemini-tts.js");
      const result = await generateTts({
        text: body.text,
        voice: typeof body.voice === "string" ? body.voice : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        style: typeof body.style === "string" ? body.style : undefined,
        noCache: body.noCache === true,
      });
      return c.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * Compose a Reel by stitching ordered image + video segments together with
   * optional per-segment text overlays. Returns the final mp4 path inside
   * ~/.heyhank/media/.
   *
   * Body: { segments: ComposeSegment[], brand?: string, outputName?: string }
   * See video-compose.ts for the segment shape.
   */
  api.post("/video/compose", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.segments) || body.segments.length === 0) {
      return c.json({ error: "segments array is required" }, 400);
    }
    try {
      const { composeReel } = await import("../video-compose.js");
      const result = await composeReel({
        segments: body.segments,
        brand: typeof body.brand === "string" ? body.brand : undefined,
        outputName: typeof body.outputName === "string" ? body.outputName : undefined,
      });
      return c.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });
}
