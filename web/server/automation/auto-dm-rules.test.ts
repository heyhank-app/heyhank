// Tests for the Auto-DM rules engine — CRUD + matching + dedupe.
// Storage path is set per-test to a temp dir so tests don't pollute the real
// rules file (kept under ~/.heyhank/automation/auto-dm-rules.json in prod).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommentEvent } from "./meta-webhook.js";

let tempHome: string;
// auto-dm-rules captures HEYHANK_HOME at import time via paths.ts, so we
// reset modules + re-import after pointing HEYHANK_HOME at a fresh temp dir.
type RulesModule = typeof import("./auto-dm-rules.js");
let rules: RulesModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "auto-dm-rules-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  rules = await import("./auto-dm-rules.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<CommentEvent> = {}): CommentEvent {
  return {
    platform: "instagram",
    postId: "post-1",
    commentId: "comment-1",
    commenterId: "user-1",
    text: "Comment COURSES please",
    receivedAt: Date.now(),
    ...overrides,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe("Auto-DM rules — CRUD", () => {
  it("creates a rule with sensible defaults", () => {
    const r = rules.createRule({
      platform: "instagram",
      keyword: "courses",
      dmTemplate: "Here's your link: https://example.com",
    });
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.enabled).toBe(true);
    expect(r.sentCount).toBe(0);
    expect(r.sentTo).toEqual([]);
    expect(r.postId).toBeNull();
    expect(r.keyword).toBe("courses");
  });

  it("lists, gets, updates, and deletes rules", () => {
    const a = rules.createRule({ platform: "instagram", keyword: "a", dmTemplate: "ta" });
    const b = rules.createRule({ platform: "facebook", keyword: "b", dmTemplate: "tb" });
    expect(rules.listRules()).toHaveLength(2);
    expect(rules.listRules({ platform: "facebook" })).toHaveLength(1);
    expect(rules.getRule(a.id)?.keyword).toBe("a");
    const updated = rules.updateRule(a.id, { keyword: "AAA" });
    expect(updated?.keyword).toBe("AAA");
    expect(rules.deleteRule(b.id)).toBe(true);
    expect(rules.listRules()).toHaveLength(1);
  });
});

// ─── Matching ────────────────────────────────────────────────────────────────

describe("Auto-DM rules — match engine", () => {
  it("matches a comment whose text contains the keyword case-insensitively", () => {
    rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    const match = rules.findMatchingRule(makeEvent({ text: "Comment COURSES please" }));
    expect(match?.keyword).toBe("courses");
  });

  it("does not match across platforms (an IG rule ignores FB comments)", () => {
    rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    expect(rules.findMatchingRule(makeEvent({ platform: "facebook", text: "COURSES" }))).toBeNull();
  });

  it("respects per-post scope: rule.postId restricts to that one post", () => {
    rules.createRule({ platform: "instagram", postId: "post-X", keyword: "courses", dmTemplate: "tpl" });
    expect(rules.findMatchingRule(makeEvent({ postId: "post-X", text: "COURSES" }))).not.toBeNull();
    expect(rules.findMatchingRule(makeEvent({ postId: "post-Y", text: "COURSES" }))).toBeNull();
  });

  it("evergreen rules (no postId) match comments on ANY post on that platform", () => {
    rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    expect(rules.findMatchingRule(makeEvent({ postId: "post-A", text: "COURSES" }))).not.toBeNull();
    expect(rules.findMatchingRule(makeEvent({ postId: "post-B", text: "COURSES" }))).not.toBeNull();
  });

  it("ignores disabled rules", () => {
    const r = rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    rules.updateRule(r.id, { enabled: false });
    expect(rules.findMatchingRule(makeEvent({ text: "COURSES" }))).toBeNull();
  });

  it("does not match when keyword is empty (avoids matching every comment)", () => {
    rules.createRule({ platform: "instagram", keyword: "", dmTemplate: "tpl" });
    expect(rules.findMatchingRule(makeEvent({ text: "anything" }))).toBeNull();
  });
});

// ─── Dedupe ──────────────────────────────────────────────────────────────────

describe("Auto-DM rules — dedupe", () => {
  it("does not re-match a commenter who was already DM'd for the same post", () => {
    const r = rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    const ev = makeEvent({ commenterId: "user-1", postId: "post-1", text: "COURSES" });
    expect(rules.findMatchingRule(ev)).not.toBeNull();
    rules.recordSend(r.id, ev);
    // Same user comments again on the same post — should NOT trigger another DM.
    expect(rules.findMatchingRule(ev)).toBeNull();
  });

  it("DOES match the same commenter on a DIFFERENT post (separate funnel)", () => {
    const r = rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    const ev1 = makeEvent({ commenterId: "user-1", postId: "post-1", text: "COURSES" });
    rules.recordSend(r.id, ev1);
    const ev2 = makeEvent({ commenterId: "user-1", postId: "post-2", text: "COURSES" });
    expect(rules.findMatchingRule(ev2)).not.toBeNull();
  });

  it("recordSend increments sentCount and appends to sentTo", () => {
    const r = rules.createRule({ platform: "instagram", keyword: "courses", dmTemplate: "tpl" });
    rules.recordSend(r.id, makeEvent({ commenterId: "u1" }));
    rules.recordSend(r.id, makeEvent({ commenterId: "u2", postId: "post-2" }));
    const after = rules.getRule(r.id)!;
    expect(after.sentCount).toBe(2);
    expect(after.sentTo).toHaveLength(2);
  });
});
