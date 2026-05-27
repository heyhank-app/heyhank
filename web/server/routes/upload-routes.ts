// ─── Session Upload Routes ────────────────────────────────────────────────────
// Lets the browser stage arbitrary files (videos, audio, PDFs, archives, …)
// into a session's working area so agents can read them by absolute path.

import type { Hono } from "hono";
import {
  saveUploadedFile,
  MAX_UPLOAD_BYTES,
  type UploadedFileInfo,
} from "../session-uploads.js";

export function registerUploadRoutes(api: Hono): void {
  /**
   * Multipart upload: one or more files keyed as `file` (repeatable).
   * Returns absolute on-disk paths the agent can read directly.
   */
  api.post("/sessions/:id/upload", async (c) => {
    const sessionId = c.req.param("id");
    const contentType = c.req.header("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json({ error: "multipart/form-data is required" }, 400);
    }
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Failed to parse multipart body" }, 400);
    }
    const entries = formData.getAll("file");
    const files = entries.filter((e): e is File => e instanceof File);
    if (files.length === 0) {
      return c.json({ error: "No 'file' field(s) found" }, 400);
    }
    const results: UploadedFileInfo[] = [];
    const errors: Array<{ name: string; error: string }> = [];
    for (const file of files) {
      try {
        results.push(await saveUploadedFile(sessionId, file));
      } catch (err: unknown) {
        errors.push({
          name: file.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // All-or-nothing-ish: if every file failed, surface as 400 so the UI
    // can show a meaningful error instead of pretending success.
    if (results.length === 0) {
      return c.json({ error: "All uploads failed", errors, maxBytes: MAX_UPLOAD_BYTES }, 400);
    }
    return c.json({ ok: true, files: results, errors, maxBytes: MAX_UPLOAD_BYTES });
  });
}
