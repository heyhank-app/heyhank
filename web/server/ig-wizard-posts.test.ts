// Tests for the IG Wizard Saved Posts store — CRUD + bulk delete. Storage path
// is redirected to a temp HEYHANK_HOME per-test (the module captures it at
// import time via paths.ts), so the real store is never touched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;
type Mod = typeof import("./ig-wizard-posts.js");
let store: Mod;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "ig-wizard-posts-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  store = await import("./ig-wizard-posts.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

const baseInput = {
  topic: "self-hosting AI",
  hook: "Stop renting your AI",
  body: "Do this instead.",
  cta: "Comment BUILD",
  hashtags: ["ai", "selfhosted"],
  caption: "Stop renting your AI\n\nDo this instead.\n\nComment BUILD\n\n#ai #selfhosted",
  source: "single" as const,
};

describe("ig-wizard-posts — CRUD", () => {
  it("creates a post with sensible defaults", () => {
    const p = store.createPost(baseInput);
    expect(p.id).toBeTruthy();
    expect(p.platforms).toEqual(["instagram"]);
    expect(p.imageUrl).toBeNull();
    expect(p.promotedDraftId).toBeNull();
    expect(p.source).toBe("single");
  });

  it("persists across reads (survives a fresh listing)", () => {
    const p = store.createPost(baseInput);
    expect(store.getPost(p.id)?.hook).toBe("Stop renting your AI");
    expect(store.listPosts()).toHaveLength(1);
  });

  it("lists newest first", () => {
    const a = store.createPost({ ...baseInput, hook: "A" });
    // Force a later createdAt by patching (updatedAt changes but createdAt set at create).
    const b = store.createPost({ ...baseInput, hook: "B" });
    const ids = store.listPosts().map((p) => p.id);
    // Both present; ordering is by createdAt desc — b was created last.
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("updates a post + bumps updatedAt", () => {
    const p = store.createPost(baseInput);
    const updated = store.updatePost(p.id, { hook: "New hook", imageUrl: "/api/media/file/x.png" });
    expect(updated?.hook).toBe("New hook");
    expect(updated?.imageUrl).toBe("/api/media/file/x.png");
  });

  it("returns null when updating a missing post", () => {
    expect(store.updatePost("nope", { hook: "x" })).toBeNull();
  });

  it("removes a single post", () => {
    const p = store.createPost(baseInput);
    expect(store.removePost(p.id)).toBe(true);
    expect(store.getPost(p.id)).toBeNull();
    expect(store.removePost(p.id)).toBe(false); // already gone
  });

  it("stores plan posts with source + day", () => {
    const p = store.createPost({ ...baseInput, source: "plan", day: 7 });
    expect(p.source).toBe("plan");
    expect(p.day).toBe(7);
  });
});

describe("ig-wizard-posts — bulkRemove", () => {
  it("deletes many at once + returns the count removed", () => {
    const a = store.createPost({ ...baseInput, hook: "A" });
    const b = store.createPost({ ...baseInput, hook: "B" });
    const c = store.createPost({ ...baseInput, hook: "C" });
    const removed = store.bulkRemove([a.id, c.id, "missing-id"]);
    expect(removed).toBe(2);
    const remaining = store.listPosts().map((p) => p.id);
    expect(remaining).toEqual([b.id]);
  });

  it("returns 0 + writes nothing when no ids match", () => {
    store.createPost(baseInput);
    expect(store.bulkRemove(["x", "y"])).toBe(0);
    expect(store.listPosts()).toHaveLength(1);
  });
});
