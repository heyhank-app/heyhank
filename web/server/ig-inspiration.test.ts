// Tests for the IG Wizard Inspiration store — the manual swipe file of posts
// from creators Markus admires. Storage path is redirected to a temp
// HEYHANK_HOME per-test (the module captures it at import time via paths.ts),
// so the real store is never touched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;
type Mod = typeof import("./ig-inspiration.js");
let store: Mod;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "ig-inspiration-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  store = await import("./ig-inspiration.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("ig-inspiration — normalize helpers", () => {
  it("strips a leading @ and whitespace from a handle", () => {
    expect(store.normalizeHandle("  @vaibhavsisinty ")).toBe("vaibhavsisinty");
    expect(store.normalizeHandle("plainhandle")).toBe("plainhandle");
    expect(store.normalizeHandle(123)).toBe("");
  });

  it("defaults an unknown format to post, keeps valid ones", () => {
    expect(store.normalizeInspirationFormat("reel")).toBe("reel");
    expect(store.normalizeInspirationFormat("story")).toBe("story");
    expect(store.normalizeInspirationFormat("nonsense")).toBe("post");
    expect(store.normalizeInspirationFormat(undefined)).toBe("post");
  });
});

describe("ig-inspiration — CRUD", () => {
  const base = {
    handle: "@creator",
    format: "reel",
    caption: "Stop paying for AI APIs.",
    topic: "self-hosting",
    mediaUrls: ["/api/media/file/a.mp4", "https://x.com/b.jpg"],
    notes: "great hook",
  };

  it("creates an item, normalizing handle + format + media", () => {
    const item = store.createItem(base);
    expect(item.id).toBeTruthy();
    expect(item.handle).toBe("creator"); // @ stripped
    expect(item.format).toBe("reel");
    expect(item.mediaUrls).toEqual(["/api/media/file/a.mp4", "https://x.com/b.jpg"]);
    expect(item.topic).toBe("self-hosting");
    expect(item.createdAt).toBeTruthy();
  });

  it("drops blank/non-string media URLs", () => {
    const item = store.createItem({ ...base, mediaUrls: ["ok", "", 5, "  ", "ok2"] as unknown[] });
    expect(item.mediaUrls).toEqual(["ok", "ok2"]);
  });

  it("coerces an unknown format to post", () => {
    const item = store.createItem({ ...base, format: "bogus" });
    expect(item.format).toBe("post");
  });

  it("lists newest first", async () => {
    store.createItem({ ...base, caption: "first" });
    // Ensure a distinct createdAt ordering.
    await new Promise((r) => setTimeout(r, 5));
    store.createItem({ ...base, caption: "second" });
    const list = store.listItems();
    expect(list).toHaveLength(2);
    expect(list[0].caption).toBe("second");
  });

  it("gets, updates and removes an item", () => {
    const item = store.createItem(base);
    expect(store.getItem(item.id)?.caption).toBe("Stop paying for AI APIs.");

    const updated = store.updateItem(item.id, { notes: "updated note" });
    expect(updated?.notes).toBe("updated note");

    expect(store.removeItem(item.id)).toBe(true);
    expect(store.getItem(item.id)).toBeNull();
    expect(store.removeItem(item.id)).toBe(false); // already gone
  });
});
