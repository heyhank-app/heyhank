// ─── Media Routes ─────────────────────────────────────────────────────────────
// Image generation (Imagen) and Video generation (Veo) via Google AI APIs

import type { Hono } from "hono";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HEYHANK_HOME } from "../paths.js";
import { getToken } from "../auth-manager.js";
import { generateImage, generateVideo, pollVideoOperation, listMedia } from "../google-media.js";

/**
 * HMAC-sign a media file URL so external services (e.g. Buffer, Postiz CDN) can
 * fetch it without going through the normal auth header/cookie flow. The
 * server's auth token is used as the HMAC secret — re-generating the auth
 * token invalidates all outstanding signed URLs. Signature format:
 *   HMAC-SHA256(filename + ":" + expiresAt, authToken) → hex
 */
export function signMediaUrl(filename: string, ttlSeconds: number): { signature: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const secret = getToken();
  const sig = createHmac("sha256", secret).update(`${filename}:${expiresAt}`).digest("hex");
  return { signature: sig, expiresAt };
}

function verifyMediaSignature(filename: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const secret = getToken();
  const expected = createHmac("sha256", secret).update(`${filename}:${expiresAt}`).digest("hex");
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

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

  /** Upload a media file (image/video) */
  api.post("/media/upload", async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";
      let filename: string;
      let data: Buffer;

      if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.formData();
        const file = formData.get("file");
        if (!file || !(file instanceof File)) {
          return c.json({ error: "Missing 'file' field" }, 400);
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        filename = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        data = Buffer.from(await file.arrayBuffer());
      } else {
        // Base64 JSON body: { base64, mimeType, filename? }
        const body = await c.req.json().catch(() => ({}));
        if (!body.base64) {
          return c.json({ error: "base64 data is required" }, 400);
        }
        const mime = body.mimeType || "image/png";
        const ext = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("mp4") ? "mp4" : "bin";
        filename = basename(body.filename || `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
        data = Buffer.from(body.base64, "base64");
      }

      mkdirSync(MEDIA_DIR, { recursive: true });
      const filepath = join(MEDIA_DIR, filename);
      writeFileSync(filepath, data);

      return c.json({ ok: true, filename, url: `/api/media/file/${filename}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** List all generated media files */
  api.get("/media", (c) => {
    return c.json({ files: listMedia() });
  });

  /** Delete a single generated media file */
  api.delete("/media/file/:filename", (c) => {
    const filename = basename(c.req.param("filename"));
    const filepath = join(MEDIA_DIR, filename);
    if (!existsSync(filepath)) {
      return c.json({ error: "Not found" }, 404);
    }
    try {
      rmSync(filepath, { force: true });
      return c.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Delete multiple generated media files by filename */
  api.post("/media/bulk-delete", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { filenames?: unknown };
    if (!Array.isArray(body.filenames)) {
      return c.json({ error: "filenames array is required" }, 400);
    }
    const filenames = (body.filenames as unknown[]).filter(
      (n): n is string => typeof n === "string" && n.length > 0,
    );
    let deleted = 0;
    const errors: Array<{ filename: string; error: string }> = [];
    for (const name of filenames) {
      const safe = basename(name);
      const filepath = join(MEDIA_DIR, safe);
      if (!existsSync(filepath)) continue;
      try {
        rmSync(filepath, { force: true });
        deleted += 1;
      } catch (err: unknown) {
        errors.push({ filename: safe, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return c.json({ ok: true, deleted, errors });
  });

  /** Serve a media file by filename (auth-protected by middleware) */
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

  /**
   * Serve a media file via HMAC-signed URL, bypassing the auth middleware.
   * Used by external services (Buffer, Postiz CDN) that need to fetch HeyHank
   * media but cannot send the auth header. Marked public via the
   * `/media/signed/*` allow-list in the auth middleware.
   */
  api.get("/media/signed/:expires/:signature/:filename", (c) => {
    const filename = basename(c.req.param("filename"));
    const expiresAt = Number(c.req.param("expires"));
    const signature = c.req.param("signature");

    if (!verifyMediaSignature(filename, expiresAt, signature)) {
      return c.json({ error: "invalid or expired signature" }, 403);
    }

    const filepath = join(MEDIA_DIR, filename);
    if (!existsSync(filepath)) return c.json({ error: "Not found" }, 404);

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
