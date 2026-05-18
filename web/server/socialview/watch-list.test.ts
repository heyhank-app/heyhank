// Tests for the watch-list storage layer. Each test gets a fresh temp file
// via _resetForTest so they're fully isolated and don't touch the user's real
// ~/.heyhank/socialview/watch-list.json.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  list,
  get,
  create,
  update,
  remove,
  _resetForTest,
  _storagePath,
} from "./watch-list.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "watch-list-test-"));
  _resetForTest(join(tempDir, "watch-list.json"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("create", () => {
  // Happy path: a fresh entry gets an id, sane defaults, and lands on disk.
  it("adds a new entry with defaults and persists it", () => {
    const result = create({ platform: "instagram", handle: "rileybrown.ai" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.id).toBeTruthy();
    expect(result.entry.platform).toBe("instagram");
    expect(result.entry.handle).toBe("rileybrown.ai");
    expect(result.entry.enabled).toBe(true);
    expect(result.entry.lastCrawlStatus).toBe("never");
    expect(result.entry.lastCrawledAt).toBeNull();
    expect(existsSync(_storagePath())).toBe(true);
  });

  // Users often paste handles with a leading "@" — we strip it so the storage
  // form is canonical (matches what buildProfileUrl expects).
  it("strips a leading @ from the handle", () => {
    const result = create({ platform: "twitter", handle: "@elonmusk" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.handle).toBe("elonmusk");
  });

  // Conflict detection prevents the auto-crawler from doing redundant work
  // and keeps the UI list clean.
  it("rejects duplicate (platform, handle) — case-insensitive", () => {
    create({ platform: "instagram", handle: "rileybrown.ai" });
    const dup = create({ platform: "instagram", handle: "RileyBrown.ai" });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe(409);
  });

  // Same handle on a different platform is fine — it's a different account.
  it("allows the same handle on different platforms", () => {
    const a = create({ platform: "instagram", handle: "rileybrown.ai" });
    const b = create({ platform: "tiktok", handle: "rileybrown.ai" });
    expect(a.ok && b.ok).toBe(true);
  });

  // Invalid handles (spaces, slashes, URLs) would break profile URL building.
  it("rejects a handle with invalid characters", () => {
    const result = create({ platform: "instagram", handle: "https://instagram.com/foo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
  });

  it("rejects an empty handle", () => {
    const result = create({ platform: "instagram", handle: "  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
  });
});

describe("list", () => {
  // List sorts newest-first so the UI shows recent additions on top.
  // We can't rely on createdAt resolution between two synchronous create()
  // calls (same ms), so we rewrite createdAt via update() to make the order
  // deterministic for this assertion.
  it("returns entries newest-first", () => {
    const a = create({ platform: "instagram", handle: "user_a" });
    const b = create({ platform: "instagram", handle: "user_b" });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    // Force ordering by mutating createdAt directly through the JSON file.
    const path = _storagePath();
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    raw[0].createdAt = "2026-01-01T00:00:00.000Z";
    raw[1].createdAt = "2026-06-01T00:00:00.000Z";
    require("node:fs").writeFileSync(path, JSON.stringify(raw));

    const entries = list();
    expect(entries[0].createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(entries[1].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  // Platform filter is what the auto-crawler uses to pick up only the
  // relevant subset when iterating per-browser.
  it("filters by platform", () => {
    create({ platform: "instagram", handle: "ig_user" });
    create({ platform: "tiktok", handle: "tt_user" });
    const ig = list({ platform: "instagram" });
    expect(ig).toHaveLength(1);
    expect(ig[0].platform).toBe("instagram");
  });

  // enabledOnly is the second filter the crawler uses — paused entries
  // (enabled=false) must be skipped.
  it("filters by enabledOnly", () => {
    const r = create({ platform: "instagram", handle: "active_user" });
    create({ platform: "instagram", handle: "paused_user" });
    if (r.ok) update(r.entry.id, { enabled: false });
    const enabled = list({ enabledOnly: true });
    expect(enabled.every((e) => e.enabled)).toBe(true);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].handle).toBe("paused_user");
  });

  // Empty file (or missing file) must return an empty array — not crash.
  // This is important on first-ever startup when nothing has been added yet.
  it("returns empty array when storage is missing", () => {
    expect(list()).toEqual([]);
  });
});

describe("get / update / remove", () => {
  it("get returns null for unknown id", () => {
    expect(get("does-not-exist")).toBeNull();
  });

  // update is how the crawler stamps lastCrawledAt / status / message.
  it("update merges patch and persists", () => {
    const r = create({ platform: "instagram", handle: "user_a" });
    if (!r.ok) throw new Error("setup failed");
    const updated = update(r.entry.id, {
      lastCrawledAt: "2026-05-17T10:00:00.000Z",
      lastCrawlStatus: "ok",
      lastCrawlPostsExtracted: 5,
    });
    expect(updated?.lastCrawlStatus).toBe("ok");
    expect(updated?.lastCrawlPostsExtracted).toBe(5);
    // Round-trip through disk to confirm persistence.
    expect(get(r.entry.id)?.lastCrawlStatus).toBe("ok");
  });

  it("update returns null for unknown id", () => {
    expect(update("missing", { enabled: false })).toBeNull();
  });

  it("remove deletes the entry and returns true", () => {
    const r = create({ platform: "instagram", handle: "user_a" });
    if (!r.ok) throw new Error("setup failed");
    expect(remove(r.entry.id)).toBe(true);
    expect(get(r.entry.id)).toBeNull();
  });

  it("remove returns false for unknown id", () => {
    expect(remove("missing")).toBe(false);
  });
});

describe("storage resilience", () => {
  // If the JSON file is malformed (truncated write, manual edit), list/create
  // must not throw — readAll falls back to []. Crucial because users sometimes
  // poke at the file directly.
  it("treats a corrupt watch-list.json as empty", () => {
    require("node:fs").mkdirSync(join(tempDir, "."), { recursive: true });
    require("node:fs").writeFileSync(_storagePath(), "{not json");
    expect(list()).toEqual([]);
    // And we can still write a fresh entry on top.
    const r = create({ platform: "instagram", handle: "recovery" });
    expect(r.ok).toBe(true);
  });
});
