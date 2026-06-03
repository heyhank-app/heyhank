// Tests for the auto-crawler orchestration. We mock browser-manager,
// extractors, and library so the test stays fast and deterministic — the
// orchestration logic (skip-when-no-profile, per-entry stamping, summary
// shape, in-flight guard) is what we want to lock in.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

// Mock fns are typed broadly so individual tests can override return values
// without TypeScript inferring narrow types like `never[]` from the initial
// implementation.
interface MockStatus {
  platform: string;
  running: boolean;
  loggedIn: boolean | null;
  currentUrl: string | null;
  startedAt: number | null;
}
const mockHasProfile = vi.hoisted(() => vi.fn<(platform: string) => boolean>(() => true));
const mockGetStatus = vi.hoisted(() => vi.fn<(platform: string) => MockStatus>(() => ({
  platform: "instagram",
  running: true,
  loggedIn: true,
  currentUrl: "https://www.instagram.com/",
  startedAt: Date.now(),
})));
const mockStartPlatform = vi.hoisted(() => vi.fn<(platform: string) => Promise<void>>(async () => undefined));
const mockGotoUrl = vi.hoisted(() => vi.fn<(platform: string, url: string) => Promise<void>>(async () => undefined));
const mockGetPage = vi.hoisted(() => vi.fn<(platform: string) => { url: () => string } | null>(() => ({
  url: () => "https://www.instagram.com/handle/",
})));

vi.mock("./browser-manager.js", () => ({
  hasProfile: mockHasProfile,
  getStatus: mockGetStatus,
  startPlatform: mockStartPlatform,
  gotoUrl: mockGotoUrl,
  getPage: mockGetPage,
}));

interface ExtractResult { posts: Array<{ id: string; platform: string }>; errors: string[] }
const mockExtract = vi.hoisted(() => vi.fn<() => Promise<ExtractResult>>(async () => ({ posts: [], errors: [] })));
vi.mock("./extractors.js", () => ({
  extractCurrentPage: mockExtract,
}));

const mockSavePost = vi.hoisted(() => vi.fn());
vi.mock("./library.js", () => ({
  savePost: mockSavePost,
  // Other exports the auto-crawler doesn't touch — stub so the import works.
  listPosts: vi.fn(() => []),
  selectForFewShot: vi.fn(() => []),
  ensureDirs: vi.fn(),
  getPost: vi.fn(() => null),
  deletePost: vi.fn(() => false),
  updatePost: vi.fn(() => null),
  MEDIA_ROOT: "/tmp",
}));

// Real watch-list storage so we exercise update() round-trips, just pointed
// at a temp file.
import {
  list as watchListList,
  create as watchListCreate,
  get as watchListGet,
  _resetForTest as watchListResetForTest,
} from "./watch-list.js";
import {
  crawlOnce,
  crawlEntry,
  classifyCrawlError,
  _resetForTest as crawlerResetForTest,
} from "./auto-crawler.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "auto-crawler-test-"));
  watchListResetForTest(join(tempDir, "watch-list.json"));
  crawlerResetForTest();
  // Restore default mock behavior — individual tests may override.
  mockHasProfile.mockReset().mockReturnValue(true);
  mockGetStatus.mockReset().mockReturnValue({
    platform: "instagram", running: true, loggedIn: true,
    currentUrl: "https://www.instagram.com/", startedAt: Date.now(),
  });
  mockStartPlatform.mockReset().mockResolvedValue(undefined);
  mockGotoUrl.mockReset().mockResolvedValue(undefined);
  mockGetPage.mockReset().mockReturnValue({ url: () => "https://www.instagram.com/handle/" });
  mockExtract.mockReset().mockResolvedValue({ posts: [], errors: [] });
  mockSavePost.mockReset();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("crawlOnce — happy path", () => {
  // Two enabled IG entries → both navigated + extracted, posts saved,
  // watch-list updated with lastCrawledAt/Status.
  it("visits each enabled entry and stamps the result", async () => {
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    const b = watchListCreate({ platform: "instagram", handle: "user_b" });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    mockExtract.mockResolvedValue({
      posts: [{ id: "post-1", platform: "instagram" } as any, { id: "post-2", platform: "instagram" } as any],
      errors: [],
    });

    const summary = await crawlOnce();

    expect(summary.totalEntries).toBe(2);
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.postsExtracted).toBe(4); // 2 entries × 2 posts each
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);

    // Each entry got a lastCrawledAt stamp + ok status.
    const after = watchListList();
    expect(after.every((e) => e.lastCrawlStatus === "ok")).toBe(true);
    expect(after.every((e) => e.lastCrawlPostsExtracted === 2)).toBe(true);
    expect(after.every((e) => e.lastCrawledAt !== null)).toBe(true);

    // Posts saved to library twice per entry.
    expect(mockSavePost).toHaveBeenCalledTimes(4);
  });

  // Disabled entries are silently skipped — they don't appear in totals.
  it("ignores disabled (paused) entries", async () => {
    watchListCreate({ platform: "instagram", handle: "active" });
    const paused = watchListCreate({ platform: "instagram", handle: "paused" });
    if (paused.ok) {
      // Manually pause via the storage layer
      const { update } = await import("./watch-list.js");
      update(paused.entry.id, { enabled: false });
    }
    const summary = await crawlOnce();
    expect(summary.totalEntries).toBe(1);
    expect(summary.attempted).toBe(1);
  });
});

describe("crawlOnce — skip conditions", () => {
  // When the user has never logged in for a platform, every entry on that
  // platform gets marked with a helpful "needs login" error message.
  it("skips platforms with no login profile", async () => {
    mockHasProfile.mockReturnValue(false);
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    if (!a.ok) throw new Error("setup failed");

    const summary = await crawlOnce();
    expect(summary.skipped).toBe(1);
    expect(summary.platforms.instagram.skipped).toBe(true);
    expect(summary.platforms.instagram.reason).toMatch(/no login profile/i);

    const entry = watchListGet(a.entry.id);
    expect(entry?.lastCrawlStatus).toBe("error");
    expect(entry?.lastCrawlMessage).toMatch(/login profile/);
  });

  // TikTok is bulk-blocked by anti-bot (verified 2026-05-23) — the auto-
  // crawler must NOT visit TikTok profile pages because the extraction yields
  // nothing useful and clutters the watch-list with false-"ok" entries. The
  // skip stamps lastCrawlStatus="skipped" so the UI can show a clear hint
  // pointing the user toward the single-URL Extract flow in the View tab.
  it("skips all TikTok entries with reason tiktok-bulk-blocked", async () => {
    const a = watchListCreate({ platform: "tiktok", handle: "creator_a" });
    const b = watchListCreate({ platform: "tiktok", handle: "creator_b" });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const summary = await crawlOnce();

    expect(summary.skipped).toBe(2);
    expect(summary.platforms.tiktok.skipped).toBe(true);
    expect(summary.platforms.tiktok.reason).toMatch(/tiktok-bulk-blocked/);
    // Browser must NOT be touched for TikTok — we never even check for a
    // login profile because the failure mode is anti-bot, not auth.
    expect(mockHasProfile).not.toHaveBeenCalledWith("tiktok");
    expect(mockStartPlatform).not.toHaveBeenCalledWith("tiktok");

    const entryA = watchListGet(a.entry.id);
    expect(entryA?.lastCrawlStatus).toBe("skipped");
    expect(entryA?.lastCrawlMessage).toMatch(/extract individual URLs via View tab/);
  });

  // If the browser fails to start (e.g. Playwright crash), all entries on
  // that platform are skipped with a clear error message.
  it("skips platform when browser startup fails", async () => {
    mockGetStatus.mockReturnValue({
      platform: "instagram", running: false, loggedIn: null,
      currentUrl: null, startedAt: null,
    });
    mockStartPlatform.mockRejectedValue(new Error("playwright launch failed"));
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    if (!a.ok) throw new Error("setup failed");

    const summary = await crawlOnce();
    expect(summary.skipped).toBe(1);
    expect(summary.platforms.instagram.reason).toMatch(/failed to start browser/);
  });
});

describe("crawlEntry — failure isolation", () => {
  // A navigation throw on one entry must surface as a per-entry error
  // without propagating up to the caller.
  it("stamps error status when gotoUrl throws", async () => {
    mockGotoUrl.mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT"));
    const a = watchListCreate({ platform: "instagram", handle: "broken" });
    if (!a.ok) throw new Error("setup failed");
    const result = await crawlEntry(a.entry);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ERR_TIMED_OUT/);
    expect(watchListGet(a.entry.id)?.lastCrawlStatus).toBe("error");
  });

  // Extractor returned errors AND zero posts → stamped as error.
  // Extractor returned errors but also some posts → stamped as ok
  // (partial success is success).
  it("treats partial extractor errors with some posts as ok", async () => {
    mockExtract.mockResolvedValueOnce({
      posts: [{ id: "p1", platform: "instagram" } as any],
      errors: ["failed to parse one post"],
    });
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    if (!a.ok) throw new Error("setup failed");
    const result = await crawlEntry(a.entry);
    expect(result.ok).toBe(true);
    expect(watchListGet(a.entry.id)?.lastCrawlStatus).toBe("ok");
  });

  it("treats extractor errors with zero posts as error", async () => {
    mockExtract.mockResolvedValueOnce({
      posts: [],
      errors: ["complete failure"],
    });
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    if (!a.ok) throw new Error("setup failed");
    const result = await crawlEntry(a.entry);
    expect(result.ok).toBe(false);
    expect(watchListGet(a.entry.id)?.lastCrawlStatus).toBe("error");
  });

  // No browser page (closed/crashed) means we can't crawl — surface as error.
  it("stamps error when browser page is unavailable", async () => {
    mockGetPage.mockReturnValueOnce(null);
    const a = watchListCreate({ platform: "instagram", handle: "user_a" });
    if (!a.ok) throw new Error("setup failed");
    const result = await crawlEntry(a.entry);
    expect(result.ok).toBe(false);
    expect(watchListGet(a.entry.id)?.lastCrawlStatus).toBe("error");
    expect(watchListGet(a.entry.id)?.lastCrawlMessage).toMatch(/browser page/);
  });
});

describe("crawlOnce — concurrency guard", () => {
  // A second invocation while the first is in flight returns immediately
  // with empty totals — prevents the cron from trampling a manual trigger.
  it("returns empty summary when another crawl is already running", async () => {
    // Force the first crawl to hang on extract so we can fire the second.
    let resolveExtract: (v: { posts: any[]; errors: string[] }) => void = () => {};
    mockExtract.mockImplementationOnce(() => new Promise((r) => {
      resolveExtract = r;
    }));
    watchListCreate({ platform: "instagram", handle: "user_a" });

    const firstPromise = crawlOnce();
    // Yield so the first run gets past `running = true`.
    await new Promise((r) => setTimeout(r, 5));

    const second = await crawlOnce();
    expect(second.totalEntries).toBe(0);
    expect(second.attempted).toBe(0);

    // Release the first crawl so we don't leak the promise.
    resolveExtract({ posts: [], errors: [] });
    await firstPromise;
  });
});

// classifyCrawlError turns raw Playwright/navigation errors into actionable
// messages so the watch-list UI tells the user *why* a crawl failed (expired
// session vs IP block) instead of surfacing a cryptic Chromium error.
describe("classifyCrawlError", () => {
  it("flags HTTP 403/429 hard blocks as BLOCKED (IP rate-limit / bot-detect)", () => {
    const msg = classifyCrawlError(
      "goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://www.instagram.com/vaibhavsisinty/",
    );
    expect(msg).toMatch(/^BLOCKED:/);
    expect(msg).toMatch(/re-import fresh cookies/i);
  });

  it("flags a 429 status string as BLOCKED", () => {
    expect(classifyCrawlError("Request failed with 429 Too Many Requests")).toMatch(/^BLOCKED:/);
  });

  it("flags a login-redirect navigation error as LOGIN_REQUIRED", () => {
    const msg = classifyCrawlError("net::ERR_ABORTED at https://www.instagram.com/accounts/login/?next=/x/");
    expect(msg).toMatch(/^LOGIN_REQUIRED:/);
    expect(msg).toMatch(/session expired/i);
  });

  it("passes unrelated errors through unchanged", () => {
    expect(classifyCrawlError("browser page not available")).toBe("browser page not available");
  });
});
