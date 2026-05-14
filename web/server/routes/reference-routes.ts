// ─── Reference Image Routes ────────────────────────────────────────────────
// REST endpoints for managing categorized reference images that agents can
// feed into image-editing pipelines (e.g. gpt-image-2 --edit).

import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import {
  listReferences,
  createCategory,
  deleteCategory,
  saveReference,
  deleteReference,
  getReferencePath,
  validateCategoryName,
} from "../reference-store.js";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function registerReferenceRoutes(api: Hono): void {
  /** List all categories with their files. */
  api.get("/references", (c) => {
    try {
      return c.json({ categories: listReferences() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Create a new category. */
  api.post("/references/categories", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    try {
      const created = createCategory(body.name.trim());
      return c.json({ ok: true, created, name: body.name.trim() }, created ? 201 : 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** Delete an empty category. */
  api.delete("/references/categories/:name", (c) => {
    const name = c.req.param("name");
    try {
      const deleted = deleteCategory(name);
      if (!deleted) return c.json({ error: "Category not found" }, 404);
      return c.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.toLowerCase().includes("not empty") ? 409 : 400;
      return c.json({ error: message }, status);
    }
  });

  /** Upload a reference image (multipart: file, category). */
  api.post("/references/upload", async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return c.json({ error: "multipart/form-data required" }, 400);
      }
      const formData = await c.req.formData();
      const file = formData.get("file");
      const category = formData.get("category");
      if (!file || !(file instanceof File)) {
        return c.json({ error: "Missing 'file' field" }, 400);
      }
      if (typeof category !== "string" || !category.trim()) {
        return c.json({ error: "Missing 'category' field" }, 400);
      }
      const data = Buffer.from(await file.arrayBuffer());
      const saved = saveReference(category.trim(), file.name || "upload.png", data);
      return c.json({ ok: true, category: category.trim(), file: saved }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** Delete a single reference file. */
  api.delete("/references/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    try {
      const deleted = deleteReference(category, filename);
      if (!deleted) return c.json({ error: "File not found" }, 404);
      return c.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** Serve a reference file. */
  api.get("/references/file/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    try {
      validateCategoryName(category);
    } catch {
      return c.json({ error: "Invalid category" }, 400);
    }
    const path = getReferencePath(category, filename);
    if (!path) return c.json({ error: "Not found" }, 404);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const data = readFileSync(path);
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
