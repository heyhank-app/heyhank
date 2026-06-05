// Tests for the Apify Instagram scraper client. The Apify HTTP call + the media
// download are stubbed (injected fetch) so no real Apify run happens and no
// network is touched. HEYHANK_HOME is redirected to a temp dir so the media
// download writes there; the token comes from the APIFY_TOKEN env fallback
// (settings file is absent in the temp home).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;
type Mod = typeof import("./apify-instagram.js");
let mod: Mod;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "apify-test-"));
  process.env.HEYHANK_HOME = tempHome;
  process.env.APIFY_TOKEN = "test-token";
  vi.resetModules();
  mod = await import("./apify-instagram.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  delete process.env.APIFY_TOKEN;
});

describe("mapApifyType + normalizeApifyItem", () => {
  it("maps Apify post types to our formats", () => {
    expect(mod.mapApifyType("Video")).toBe("reel");
    expect(mod.mapApifyType("Sidecar")).toBe("carousel");
    expect(mod.mapApifyType("Image")).toBe("post");
    expect(mod.mapApifyType("???")).toBe("post");
  });

  it("normalizes a post item + drops error/caption-less items", () => {
    const ok = mod.normalizeApifyItem(
      { type: "Video", caption: " hi ", url: "u", displayUrl: "d.jpg", videoUrl: "v.mp4", ownerUsername: "c", likesCount: 9, commentsCount: 2, timestamp: "t" },
      "fallback",
    );
    expect(ok).toMatchObject({ caption: "hi", format: "reel", url: "u", imageUrl: "d.jpg", videoUrl: "v.mp4", ownerUsername: "c", likes: 9, comments: 2 });
    // Error item from Apify (e.g. private/not-found) → dropped.
    expect(mod.normalizeApifyItem({ error: "Page not found" }, "f")).toBeNull();
    // No caption → nothing to learn from → dropped.
    expect(mod.normalizeApifyItem({ type: "Image", caption: "" }, "f")).toBeNull();
    // falls back to the requested handle when ownerUsername missing.
    expect(mod.normalizeApifyItem({ type: "Image", caption: "x" }, "fallback")?.ownerUsername).toBe("fallback");
  });
});

describe("scrapeInstagramPosts", () => {
  it("posts to the run-sync actor endpoint with the right input + normalizes results", async () => {
    let capturedUrl = "";
    let capturedBody: { directUrls?: string[]; resultsLimit?: number; resultsType?: string } = {};
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify([
          { type: "Video", caption: "Reel cap", url: "https://ig/p/1", displayUrl: "https://cdn/1.jpg", videoUrl: "https://cdn/1.mp4", ownerUsername: "creator", likesCount: 100, commentsCount: 5 },
          { type: "Sidecar", caption: "Carousel cap", url: "https://ig/p/2", displayUrl: "https://cdn/2.jpg", ownerUsername: "creator", likesCount: 50 },
          { error: "Restricted" },
          { type: "Image", caption: "" },
        ]),
        { status: 200 },
      );
    });

    const posts = await mod.scrapeInstagramPosts({ handle: "@creator", limit: 12 }, { fetch: fakeFetch as never });

    expect(capturedUrl).toContain("apify~instagram-scraper/run-sync-get-dataset-items");
    expect(capturedUrl).toContain("token=test-token");
    expect(capturedBody.directUrls).toEqual(["https://www.instagram.com/creator/"]);
    expect(capturedBody.resultsLimit).toBe(12);
    expect(capturedBody.resultsType).toBe("posts");
    // Two valid posts (error + caption-less dropped).
    expect(posts).toHaveLength(2);
    expect(posts[0].format).toBe("reel");
    expect(posts[1].format).toBe("carousel");
  });

  it("clamps the limit to 1..50", async () => {
    let body: { resultsLimit?: number } = {};
    const fakeFetch = vi.fn(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(init!.body as string);
      return new Response("[]", { status: 200 });
    });
    await mod.scrapeInstagramPosts({ handle: "c", limit: 999 }, { fetch: fakeFetch as never });
    expect(body.resultsLimit).toBe(50);
  });

  it("throws a clean error on API failure", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "monthly usage exceeded" } }), { status: 402 }),
    );
    await expect(
      mod.scrapeInstagramPosts({ handle: "c" }, { fetch: fakeFetch as never }),
    ).rejects.toThrow(/monthly usage exceeded/);
  });

  it("throws when no Apify token is configured", async () => {
    delete process.env.APIFY_TOKEN;
    vi.resetModules();
    const fresh = await import("./apify-instagram.js");
    expect(fresh.hasApifyToken()).toBe(false);
    await expect(
      fresh.scrapeInstagramPosts({ handle: "c" }, { fetch: vi.fn() as never }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe("downloadToMedia", () => {
  it("saves a remote image to a local /api/media url", async () => {
    const fakeFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const url = await mod.downloadToMedia("https://cdn/x.jpg", { fetch: fakeFetch as never, now: () => 123, rand: () => "abc" });
    expect(url).toBe("/api/media/file/insp_123_abc.jpg");
    expect(existsSync(join(tempHome, "media", "insp_123_abc.jpg"))).toBe(true);
  });

  it("uses .mp4 extension for video URLs", async () => {
    const fakeFetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const url = await mod.downloadToMedia("https://cdn/clip.mp4", { fetch: fakeFetch as never, now: () => 1, rand: () => "z" });
    expect(url).toBe("/api/media/file/insp_1_z.mp4");
  });

  it("returns null when the download fails (never throws)", async () => {
    const fakeFetch = vi.fn(async () => new Response("", { status: 404 }));
    expect(await mod.downloadToMedia("https://cdn/x.jpg", { fetch: fakeFetch as never })).toBeNull();
  });
});
