import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

// google-media uses geminiApiKey; we only test routes that don't hit the API.
vi.mock("../google-media.js", () => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
  pollVideoOperation: vi.fn(),
  listMedia: vi.fn(() => []),
}));

let tempHome: string;
let app: Hono;
let mediaDir: string;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-media-routes-"));
  process.env.HEYHANK_HOME = tempHome;
  mediaDir = join(tempHome, "media");
  mkdirSync(mediaDir, { recursive: true });

  vi.resetModules();
  const { registerMediaRoutes } = await import("./media-routes.js");
  app = new Hono();
  const api = new Hono();
  registerMediaRoutes(api);
  app.route("/api", api);
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("DELETE /api/media/file/:filename", () => {
  it("deletes an existing media file", async () => {
    const file = join(mediaDir, "img_test.png");
    writeFileSync(file, Buffer.from([1, 2, 3]));

    const res = await app.request("/api/media/file/img_test.png", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(existsSync(file)).toBe(false);
  });

  it("returns 404 for a missing file", async () => {
    const res = await app.request("/api/media/file/never-existed.png", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("strips path traversal via basename", async () => {
    // Attempting to delete ../etc/passwd should resolve to media/passwd which doesn't exist
    const res = await app.request("/api/media/file/..%2F..%2Fetc%2Fpasswd", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/media/bulk-delete", () => {
  it("deletes multiple files and reports the count", async () => {
    writeFileSync(join(mediaDir, "a.png"), Buffer.from([1]));
    writeFileSync(join(mediaDir, "b.png"), Buffer.from([2]));
    writeFileSync(join(mediaDir, "c.png"), Buffer.from([3]));

    const res = await app.request("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filenames: ["a.png", "b.png"] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number; errors: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(2);
    expect(body.errors).toEqual([]);
    expect(existsSync(join(mediaDir, "a.png"))).toBe(false);
    expect(existsSync(join(mediaDir, "b.png"))).toBe(false);
    expect(existsSync(join(mediaDir, "c.png"))).toBe(true);
  });

  it("silently skips missing files (count = 0)", async () => {
    const res = await app.request("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filenames: ["nope1.png", "nope2.png"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(0);
  });

  it("returns 400 when filenames is not an array", async () => {
    const res = await app.request("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filenames: "all" }),
    });
    expect(res.status).toBe(400);
  });

  it("ignores non-string entries in filenames", async () => {
    writeFileSync(join(mediaDir, "real.png"), Buffer.from([1]));

    const res = await app.request("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filenames: ["real.png", 123, null, ""] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);
    expect(existsSync(join(mediaDir, "real.png"))).toBe(false);
  });
});
