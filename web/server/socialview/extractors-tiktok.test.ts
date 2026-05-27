// Tests for the TikTok branch of extractCurrentPage().
//
// We don't drive a real Playwright browser here — too slow + non-deterministic
// for unit tests. Instead we stub the parts of `Page` the TikTok extractor
// actually uses (`url`, `evaluate`, `waitForSelector`, `waitForTimeout`) and
// inject the hydration JSON via the `evaluate` mock. This isolates the parsing
// logic in extractCurrentPage / extractTikTokProfile / extractTikTokSinglePost.

import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright";
import { extractCurrentPage } from "./extractors.js";

// ─── Page stubs ──────────────────────────────────────────────────────────────

interface StubScript {
  textContent: string | null;
}

interface PageStubOptions {
  url: string;
  hydration?: unknown;
  bodyInnerText?: string;
  /** When true, simulate a totally empty page (no hydration script). */
  noHydrationScript?: boolean;
}

function makePageStub(opts: PageStubOptions): Page {
  const scriptEl: StubScript | null = opts.noHydrationScript
    ? null
    : { textContent: opts.hydration === undefined ? null : JSON.stringify(opts.hydration) };

  // `page.evaluate(fn)` runs `fn` in the BROWSER context with no access to the
  // DOM in Node. We approximate that by re-implementing the DOM look-ups we
  // know the TikTok extractor performs (read `__UNIVERSAL_DATA_FOR_REHYDRATION__`
  // textContent + read body innerText for logged-out detection).
  const evaluate = vi.fn(async (fn: unknown): Promise<unknown> => {
    const src = String(fn);
    if (src.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
      return scriptEl?.textContent ?? null;
    }
    if (src.includes("document.body")) {
      return opts.bodyInnerText ?? "";
    }
    // window.scrollBy / window.scrollTo are no-ops in the stub.
    if (src.includes("scrollBy") || src.includes("scrollTo")) return undefined;
    // DOM video-grid scrape — return an empty list by default; tests that
    // exercise the fallback path can override this via the `domVideoHrefs`
    // option (not currently surfaced — tests just see the empty case).
    if (src.includes("/@") && src.includes("video|photo")) return [];
    return undefined;
  });

  return {
    url: () => opts.url,
    evaluate,
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Page;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function tiktokVideoItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "7300000000000000001",
    desc: "POV: you stopped paying for AI courses 🎓",
    createTime: 1779000000,
    author: { uniqueId: "aitrendz", nickname: "AI Trendz", verified: true },
    stats: { diggCount: 12345, commentCount: 678, shareCount: 90, playCount: 234567 },
    textExtra: [
      { hashtagName: "ai" },
      { hashtagName: "ClaudeAI" },
      { userUniqueId: "anthropic" },
    ],
    video: {
      cover: "https://p16-sign.tiktokcdn.com/obj/abc123",
      dynamicCover: "https://p16-sign.tiktokcdn.com/obj/dyn123",
      playAddr: "https://v16-webapp.tiktok.com/abc.mp4",
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractCurrentPage / TikTok", () => {
  it("extracts a single video from /@handle/video/id via hydration JSON", async () => {
    const item = tiktokVideoItem();
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz/video/7300000000000000001",
      hydration: {
        __DEFAULT_SCOPE__: {
          "webapp.video-detail": { itemInfo: { itemStruct: item } },
        },
      },
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(errors).toEqual([]);
    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.platform).toBe("tiktok");
    expect(p.author.handle).toBe("aitrendz");
    expect(p.author.verified).toBe(true);
    expect(p.text).toContain("stopped paying for AI courses");
    expect(p.engagement.likes).toBe(12345);
    expect(p.engagement.views).toBe(234567);
    expect(p.hashtags).toEqual(["#ai", "#ClaudeAI"]);
    expect(p.mentions).toEqual(["@anthropic"]);
    expect(p.url).toBe("https://www.tiktok.com/@aitrendz/video/7300000000000000001");
    expect(p.postType).toBe("reel");
    // createTime 1779000000 == 2026-05-13T11:00:00.000Z
    expect(p.postedAt).toMatch(/^2026-05-/);
    // First media is the cover image (resilient even when video URL needs auth).
    expect(p.media[0]?.remoteUrl).toContain("tiktokcdn");
  });

  it("extracts multiple videos from a profile page via webapp.video-list.itemList", async () => {
    const items = [tiktokVideoItem({ id: "1" }), tiktokVideoItem({ id: "2" }), tiktokVideoItem({ id: "3" })];
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz",
      hydration: {
        __DEFAULT_SCOPE__: {
          "webapp.video-list": { itemList: items },
        },
      },
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(errors).toEqual([]);
    expect(posts).toHaveLength(3);
    expect(posts.map((p) => p.url)).toEqual([
      "https://www.tiktok.com/@aitrendz/video/1",
      "https://www.tiktok.com/@aitrendz/video/2",
      "https://www.tiktok.com/@aitrendz/video/3",
    ]);
  });

  it("returns LOGGED_OUT error when TikTok serves a login wall", async () => {
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz",
      bodyInnerText: "Log in to TikTok to continue watching",
      hydration: {},
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(posts).toEqual([]);
    expect(errors[0]).toMatch(/LOGGED_OUT/);
  });

  it("falls back to DOM grid scrape when hydration has no webapp.video-list slot", async () => {
    // 2026-05: TikTok dropped video-list from profile-page SSR — only ships
    // user-detail. The extractor should not error out; it should switch to
    // DOM-anchor scraping. When the DOM also yields no permalinks (e.g. empty
    // profile or aggressive anti-bot rendering), it should return cleanly
    // with no posts and no exception.
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz",
      hydration: {
        __DEFAULT_SCOPE__: {
          "webapp.user-detail": { userInfo: { user: { uniqueId: "aitrendz" } } },
        },
      },
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(posts).toEqual([]);
    // No exception thrown — fallback path completed cleanly.
    expect(errors.every((e) => !e.includes("scan failed"))).toBe(true);
  });

  it("returns an empty result when hydration JSON is missing entirely (no SSR script)", async () => {
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz",
      noHydrationScript: true,
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(posts).toEqual([]);
    // Missing hydration is no longer a hard error — extractor falls back to
    // DOM-scrape, which yields zero permalinks in this stub. The crawl
    // completes without crashing.
    expect(errors.every((e) => !e.includes("scan failed"))).toBe(true);
  });

  it("rejects unrecognized TikTok URLs (e.g. /tag/something)", async () => {
    const page = makePageStub({
      url: "https://www.tiktok.com/tag/ai",
    });

    const { posts, errors } = await extractCurrentPage({
      platform: "tiktok",
      page,
      source: "role-model",
    });

    expect(posts).toEqual([]);
    expect(errors[0]).toMatch(/not recognized for extraction/);
  });

  it("uses statsV2 when present (TikTok migrates stats schema)", async () => {
    const item = tiktokVideoItem({
      stats: { diggCount: 100 },
      // statsV2 should take precedence — it's the newer field.
      statsV2: { diggCount: 999, commentCount: 42 },
    });
    const page = makePageStub({
      url: "https://www.tiktok.com/@aitrendz/video/1",
      hydration: {
        __DEFAULT_SCOPE__: {
          "webapp.video-detail": { itemInfo: { itemStruct: item } },
        },
      },
    });

    const { posts } = await extractCurrentPage({ platform: "tiktok", page, source: "role-model" });
    expect(posts[0].engagement.likes).toBe(999);
    expect(posts[0].engagement.comments).toBe(42);
  });

  it("treats /@handle/photo/id as a single-image post (postType=image)", async () => {
    const photoItem = {
      id: "1",
      desc: "carousel of 3 prompts",
      createTime: 1779000000,
      author: { uniqueId: "promptpack" },
      stats: { diggCount: 50 },
      imagePost: {
        images: [
          { imageURL: { urlList: ["https://p16-sign.tiktokcdn.com/img1.jpg"] } },
          { imageURL: { urlList: ["https://p16-sign.tiktokcdn.com/img2.jpg"] } },
          { imageURL: { urlList: ["https://p16-sign.tiktokcdn.com/img3.jpg"] } },
        ],
      },
    };
    const page = makePageStub({
      url: "https://www.tiktok.com/@promptpack/photo/1",
      hydration: {
        __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: photoItem } } },
      },
    });

    const { posts } = await extractCurrentPage({ platform: "tiktok", page, source: "role-model" });
    expect(posts).toHaveLength(1);
    expect(posts[0].postType).toBe("image");
    expect(posts[0].media).toHaveLength(3);
    expect(posts[0].media.every((m) => m.type === "image")).toBe(true);
  });
});
