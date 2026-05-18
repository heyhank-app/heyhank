// HTTP-surface tests for the watch-list routes registered by
// registerSocialViewRoutes. We exercise GET/POST/PATCH/DELETE against a
// fresh in-memory Hono app per test, with HEYHANK_HOME pointing at a temp
// dir so nothing leaks into the real config.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

// browser-manager + vnc-manager pull in playwright at import time; mocking
// keeps the test fast and prevents the playwright runtime from interfering
// with vitest. Only the watch-list endpoints we test here are exercised.
vi.mock("./browser-manager.js", () => ({
  getPage: vi.fn(() => null),
  getAllStatus: vi.fn(() => ({})),
  startBrowser: vi.fn(),
  stopBrowser: vi.fn(),
  navigateTo: vi.fn(),
  getStatus: vi.fn(() => ({ platform: "instagram", running: false, loggedIn: null, currentUrl: null, startedAt: null })),
}));
vi.mock("./vnc-manager.js", () => ({
  getVncStatus: vi.fn(async () => ({ running: false })),
}));

let tempHome: string;
let app: Hono;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-watchlist-routes-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  const { registerSocialViewRoutes } = await import("./routes.js");
  app = new Hono();
  const api = new Hono();
  registerSocialViewRoutes(api);
  app.route("/api", api);
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /api/socialview/watch-list", () => {
  it("returns an empty list on a fresh install", async () => {
    const res = await app.request("/api/socialview/watch-list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("filters by platform query param", async () => {
    await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "user_a" }),
    });
    await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "tiktok", handle: "user_b" }),
    });
    const res = await app.request("/api/socialview/watch-list?platform=instagram");
    const body = (await res.json()) as { entries: Array<{ platform: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].platform).toBe("instagram");
  });

  it("rejects an invalid platform query value with 400", async () => {
    const res = await app.request("/api/socialview/watch-list?platform=bogus");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/socialview/watch-list", () => {
  it("creates an entry and returns 201", async () => {
    const res = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "rileybrown.ai", notes: "AI builder" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; entry: { id: string; handle: string; notes: string } };
    expect(body.ok).toBe(true);
    expect(body.entry.handle).toBe("rileybrown.ai");
    expect(body.entry.notes).toBe("AI builder");
  });

  it("rejects an invalid platform with 400", async () => {
    const res = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "myspace", handle: "tom" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing handle with 400", async () => {
    const res = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram" }),
    });
    expect(res.status).toBe(400);
  });

  // Duplicate detection is handled in the storage layer — this test asserts
  // the route surfaces it as 409 instead of swallowing it as 500.
  it("returns 409 on duplicate (platform, handle)", async () => {
    await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "user_a" }),
    });
    const res = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "user_a" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/socialview/watch-list/:id", () => {
  it("updates enabled and notes; ignores client-supplied crawl-status fields", async () => {
    const createRes = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "user_a" }),
    });
    const { entry } = (await createRes.json()) as { entry: { id: string } };

    const res = await app.request(`/api/socialview/watch-list/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        notes: "paused for now",
        // These must be silently dropped — fabricating them would let the
        // client lie about when their crawl last ran.
        lastCrawledAt: "1999-01-01T00:00:00.000Z",
        lastCrawlStatus: "ok",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entry: { enabled: boolean; notes: string; lastCrawledAt: string | null; lastCrawlStatus: string } };
    expect(body.entry.enabled).toBe(false);
    expect(body.entry.notes).toBe("paused for now");
    expect(body.entry.lastCrawledAt).toBeNull();
    expect(body.entry.lastCrawlStatus).toBe("never");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/api/socialview/watch-list/does-not-exist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/socialview/watch-list/:id", () => {
  it("removes the entry", async () => {
    const createRes = await app.request("/api/socialview/watch-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "instagram", handle: "user_a" }),
    });
    const { entry } = (await createRes.json()) as { entry: { id: string } };

    const delRes = await app.request(`/api/socialview/watch-list/${entry.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const listRes = await app.request("/api/socialview/watch-list");
    const body = (await listRes.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/api/socialview/watch-list/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
