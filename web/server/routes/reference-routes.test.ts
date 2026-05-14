import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

let tempHome: string;
let app: Hono;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-ref-routes-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  const { registerReferenceRoutes } = await import("./reference-routes.js");
  app = new Hono();
  const api = new Hono();
  registerReferenceRoutes(api);
  app.route("/api", api);
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

/** Build a multipart form-data body for upload tests. */
function buildUploadForm(category: string, filename: string, data: number[]): FormData {
  const fd = new FormData();
  fd.append("category", category);
  const blob = new Blob([Buffer.from(data)], { type: "image/png" });
  fd.append("file", new File([blob], filename, { type: "image/png" }));
  return fd;
}

describe("GET /api/references", () => {
  it("returns default categories with zero files on a fresh install", async () => {
    const res = await app.request("/api/references");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: Array<{ name: string; count: number }> };
    const names = body.categories.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["person", "logos", "products", "style"]));
    expect(body.categories.every((c) => c.count === 0)).toBe(true);
  });
});

describe("POST /api/references/categories", () => {
  it("creates a new category and returns 201", async () => {
    const res = await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "brand" }),
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(tempHome, "reference-images", "brand"))).toBe(true);
  });

  it("returns 200 (not 201) when category already exists", async () => {
    // First call creates, second should be a no-op
    await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "brand" }),
    });
    const res = await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "brand" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for missing name", async () => {
    const res = await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid category names (path traversal)", async () => {
    const res = await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "../etc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/references/upload", () => {
  it("saves an uploaded file under the given category", async () => {
    const form = buildUploadForm("logos", "logo.png", [1, 2, 3]);
    const res = await app.request("/api/references/upload", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; category: string; file: { filename: string } };
    expect(body.ok).toBe(true);
    expect(body.category).toBe("logos");
    expect(body.file.filename).toMatch(/^ref_/);
    expect(existsSync(join(tempHome, "reference-images", "logos", body.file.filename))).toBe(true);
  });

  it("returns 400 when file field is missing", async () => {
    const fd = new FormData();
    fd.append("category", "logos");
    const res = await app.request("/api/references/upload", { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  it("returns 400 when category field is missing", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Blob([Buffer.from([1])])], "a.png", { type: "image/png" }));
    const res = await app.request("/api/references/upload", { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/references/:category/:filename", () => {
  it("deletes an uploaded reference image", async () => {
    const form = buildUploadForm("logos", "logo.png", [1, 2, 3]);
    const upRes = await app.request("/api/references/upload", { method: "POST", body: form });
    const { file } = (await upRes.json()) as { file: { filename: string } };

    const delRes = await app.request(`/api/references/logos/${file.filename}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    expect(existsSync(join(tempHome, "reference-images", "logos", file.filename))).toBe(false);
  });

  it("returns 404 for unknown file", async () => {
    const res = await app.request("/api/references/logos/missing.png", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/references/categories/:name", () => {
  it("returns 409 when category still has files", async () => {
    const form = buildUploadForm("logos", "logo.png", [1]);
    await app.request("/api/references/upload", { method: "POST", body: form });

    const res = await app.request("/api/references/categories/logos", { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("deletes empty user-created category", async () => {
    await app.request("/api/references/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tempcat" }),
    });
    const res = await app.request("/api/references/categories/tempcat", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(existsSync(join(tempHome, "reference-images", "tempcat"))).toBe(false);
  });

  it("returns 404 when category does not exist", async () => {
    const res = await app.request("/api/references/categories/never-existed", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/references/file/:category/:filename", () => {
  it("serves a saved reference image with the right MIME type", async () => {
    const form = buildUploadForm("logos", "logo.png", [0x89, 0x50, 0x4e, 0x47]);
    const upRes = await app.request("/api/references/upload", { method: "POST", body: form });
    const { file } = (await upRes.json()) as { file: { filename: string } };

    const res = await app.request(`/api/references/file/logos/${file.filename}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(4);
  });

  it("returns 400 for invalid category name (path traversal attempt)", async () => {
    const res = await app.request("/api/references/file/..%2Fetc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing file", async () => {
    const res = await app.request("/api/references/file/logos/does-not-exist.png");
    expect(res.status).toBe(404);
  });
});
