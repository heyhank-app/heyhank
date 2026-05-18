// Tests for the library's filtering + sorting expansions used by the
// "Latest Hits" view. We don't re-test the storage round-trip (covered
// implicitly elsewhere); this file focuses on the new query semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LibraryPost } from "./types.js";

let tempHome: string;
// Library captures HEYHANK_HOME at import time via paths.ts, so each test
// has to reset modules + re-import after pointing the env var at a fresh
// temp dir. Otherwise the second test inherits the first test's library files.
type ListPostsFn = (typeof import("./library.js"))["listPosts"];
let listPosts: ListPostsFn;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "library-filter-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  ({ listPosts } = await import("./library.js"));
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

function makePost(overrides: Partial<LibraryPost> & { id: string }): LibraryPost {
  return {
    id: overrides.id,
    platform: overrides.platform ?? "instagram",
    source: overrides.source ?? "role-model",
    url: overrides.url ?? `https://example/${overrides.id}`,
    author: overrides.author ?? { handle: "test" },
    text: overrides.text ?? "",
    hook: overrides.hook ?? "",
    cta: overrides.cta ?? null,
    hashtags: overrides.hashtags ?? [],
    mentions: overrides.mentions ?? [],
    media: overrides.media ?? [],
    engagement: overrides.engagement ?? { likes: null, comments: null, shares: null, views: null, saves: null },
    engagementRate: overrides.engagementRate ?? null,
    postType: overrides.postType ?? "image",
    postedAt: overrides.postedAt ?? null,
    tags: overrides.tags ?? [],
    isGold: overrides.isGold ?? false,
    extractedAt: overrides.extractedAt ?? new Date().toISOString(),
    notes: overrides.notes ?? "",
  };
}

/**
 * Write a post directly to the library file layout — bypasses savePost()
 * so the per-test setup is independent of the API surface we're testing.
 */
function writePost(post: LibraryPost): void {
  const dir = join(tempHome, "socialview", "library", post.platform);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${post.id}.json`), JSON.stringify(post));
}

describe("listPosts sortBy", () => {
  // posted-sort surfaces freshly published content first, the way users
  // want to see "Latest Hits" — extractedAt is irrelevant here because
  // we may extract a 1-year-old post yesterday.
  it("sortBy=posted orders by postedAt desc, undated posts last", async () => {
    writePost(makePost({ id: "old",   postedAt: "2026-04-01T00:00:00Z" }));
    writePost(makePost({ id: "fresh", postedAt: "2026-05-17T00:00:00Z" }));
    writePost(makePost({ id: "undated", postedAt: null }));
    const result = listPosts({ sortBy: "posted" });
    expect(result.map((p) => p.id)).toEqual(["fresh", "old", "undated"]);
  });

  // engagement-sort pushes the highest-like-count posts up so we can
  // skim "what's currently winning" without scrolling.
  it("sortBy=engagement orders by likes desc, nulls last", async () => {
    writePost(makePost({ id: "small",  engagement: { likes: 10, comments: 0, shares: 0, views: 0, saves: 0 } }));
    writePost(makePost({ id: "big",    engagement: { likes: 9999, comments: 0, shares: 0, views: 0, saves: 0 } }));
    writePost(makePost({ id: "nolikes", engagement: { likes: null, comments: 0, shares: 0, views: 0, saves: 0 } }));
    const result = listPosts({ sortBy: "engagement" });
    expect(result.map((p) => p.id)).toEqual(["big", "small", "nolikes"]);
  });

  // Default sortBy=extracted preserves the legacy behaviour — important
  // because callers without an explicit sortBy still expect that order.
  it("default sort orders by extractedAt desc (legacy behaviour)", async () => {
    writePost(makePost({ id: "early",  extractedAt: "2026-05-01T00:00:00Z" }));
    writePost(makePost({ id: "late",   extractedAt: "2026-05-17T00:00:00Z" }));
    const result = listPosts();
    expect(result.map((p) => p.id)).toEqual(["late", "early"]);
  });
});

describe("listPosts postedWithinDays filter", () => {
  // The "last 7 days" toggle is the most-used filter for "what's hot right
  // now" — must drop posts older than the window AND posts without postedAt.
  it("keeps posts inside the window and drops older / undated ones", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    writePost(makePost({ id: "yesterday", postedAt: new Date(now - 1 * day).toISOString() }));
    writePost(makePost({ id: "lastmonth", postedAt: new Date(now - 31 * day).toISOString() }));
    writePost(makePost({ id: "undated",   postedAt: null }));
    const result = listPosts({ postedWithinDays: 7 });
    expect(result.map((p) => p.id)).toEqual(["yesterday"]);
  });

  // Tiny edge case: zero is treated as "no filter" (defensive — avoids
  // the user accidentally hiding everything via UI default).
  it("postedWithinDays=0 is a no-op (returns everything)", async () => {
    const now = Date.now();
    writePost(makePost({ id: "any", postedAt: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString() }));
    expect(listPosts({ postedWithinDays: 0 })).toHaveLength(1);
  });
});

describe("listPosts minLikes filter", () => {
  // Engagement-rate threshold has been there forever, but it needs a follower
  // count to be meaningful and we don't always have one. minLikes is the
  // simple raw-number gate that just works for every platform.
  it("drops posts below the minLikes threshold", async () => {
    writePost(makePost({ id: "tiny", engagement: { likes: 5, comments: 0, shares: 0, views: 0, saves: 0 } }));
    writePost(makePost({ id: "ok",   engagement: { likes: 500, comments: 0, shares: 0, views: 0, saves: 0 } }));
    writePost(makePost({ id: "huge", engagement: { likes: 50000, comments: 0, shares: 0, views: 0, saves: 0 } }));
    const result = listPosts({ minLikes: 100 });
    expect(result.map((p) => p.id).sort()).toEqual(["huge", "ok"]);
  });

  // Missing likes count should not pass a >0 threshold (defensive).
  it("treats null likes as 0 for the threshold check", async () => {
    writePost(makePost({ id: "null", engagement: { likes: null, comments: 0, shares: 0, views: 0, saves: 0 } }));
    expect(listPosts({ minLikes: 1 })).toHaveLength(0);
  });
});
