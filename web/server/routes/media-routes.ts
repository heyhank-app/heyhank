// ─── Media Routes ─────────────────────────────────────────────────────────────
// Image generation (Imagen) and Video generation (Veo) via Google AI APIs

import type { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import { generateImage, generateVideo, pollVideoOperation, listMedia } from "../google-media.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function registerMediaRoutes(api: Hono): void {
  /** Generate an image using Imagen/Gemini */
  api.post("/media/generate-image", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    try {
      const results = await generateImage(body.prompt, {
        model: body.model,
        aspectRatio: body.aspectRatio,
        numberOfImages: body.numberOfImages,
      });
      return c.json({ ok: true, images: results });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Start video generation using Veo */
  api.post("/media/generate-video", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    try {
      const result = await generateVideo(body.prompt, {
        model: body.model,
        durationSeconds: body.durationSeconds,
        aspectRatio: body.aspectRatio,
        imageUri: body.imageUri,
      });
      return c.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Poll a video generation operation */
  api.get("/media/video-status/:operationName{.+}", async (c) => {
    const operationName = c.req.param("operationName");
    try {
      const result = await pollVideoOperation(operationName);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** List all generated media files */
  api.get("/media", (c) => {
    return c.json({ files: listMedia() });
  });

  /** Serve a media file by filename */
  api.get("/media/file/:filename", (c) => {
    const filename = basename(c.req.param("filename"));
    const filepath = join(MEDIA_DIR, filename);
    if (!existsSync(filepath)) {
      return c.json({ error: "Not found" }, 404);
    }
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const data = readFileSync(filepath);
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
