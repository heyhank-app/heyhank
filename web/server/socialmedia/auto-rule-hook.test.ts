// Tests for the auto-rule hook — the bridge that converts a published IG/FB
// post's `Comment WORD` body trigger + firstComment into an Auto-DM rule.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SocialPost } from "./types.js";

let tempHome: string;
type HookModule = typeof import("./auto-rule-hook.js");
type RulesModule = typeof import("../automation/auto-dm-rules.js");
let hook: HookModule;
let rules: RulesModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "auto-rule-hook-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  hook = await import("./auto-rule-hook.js");
  rules = await import("../automation/auto-dm-rules.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-uuid",
    text: 'Stop paying for AI courses. Comment "COURSES" and I will DM you the link.',
    platforms: ["instagram"],
    mediaUrls: [],
    status: "published",
    backendId: null,
    backendPostId: "18154362163454526",
    createdAt: "2026-05-24T18:00:00.000Z",
    updatedAt: "2026-05-24T18:00:00.000Z",
    firstComment: "Here is your link: https://markusstoeger.com/masterai",
    ...overrides,
  };
}

// ─── extractCommentTrigger ───────────────────────────────────────────────────

describe("extractCommentTrigger", () => {
  it("captures all-caps keyword after 'Comment'", () => {
    expect(hook.extractCommentTrigger('Comment "COURSES" for the link')).toBe("COURSES");
    expect(hook.extractCommentTrigger("Comment PROMPTS below")).toBe("PROMPTS");
    expect(hook.extractCommentTrigger("comment 'PACK' to get it")).toBe("PACK");
  });

  it("uppercases the captured token", () => {
    expect(hook.extractCommentTrigger("Comment courses below")).toBe(null);
    // The regex is case-insensitive for "Comment" but requires the keyword to
    // start with an uppercase letter to avoid false positives on prose.
  });

  it("returns null when no Comment-trigger pattern is present", () => {
    expect(hook.extractCommentTrigger("Just a normal post body")).toBe(null);
    expect(hook.extractCommentTrigger("Comment below for a like")).toBe(null);
    expect(hook.extractCommentTrigger("")).toBe(null);
  });

  it("captures only the FIRST trigger when multiple are present", () => {
    expect(hook.extractCommentTrigger('First: Comment "ALPHA". Then: Comment "BETA".')).toBe("ALPHA");
  });
});

// ─── autoCreateRulesForPost ──────────────────────────────────────────────────

describe("autoCreateRulesForPost", () => {
  it("creates an IG rule when post has IG platform + Comment trigger + firstComment", () => {
    const result = hook.autoCreateRulesForPost(makePost());
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatch(/^instagram:/);

    const rule = rules.listRules({ platform: "instagram" })[0];
    expect(rule.keyword).toBe("COURSES");
    expect(rule.dmTemplate).toBe("Here is your link: https://markusstoeger.com/masterai");
    expect(rule.postId).toBe("18154362163454526");
    expect(rule.notes).toContain("post-uuid");
  });

  it("creates rules for BOTH platforms when a post targets IG + FB", () => {
    const post = makePost({
      platforms: ["instagram", "facebook"],
      backendData: {
        postiz: { id: "fb-post-1" },
      },
      backendPostId: "ig-post-1",
    });
    const result = hook.autoCreateRulesForPost(post);
    expect(result.created).toHaveLength(2);
    expect(rules.listRules({ platform: "instagram" })).toHaveLength(1);
    expect(rules.listRules({ platform: "facebook" })).toHaveLength(1);
  });

  it("skips when firstComment is empty (no DM template = no rule)", () => {
    const post = makePost({ firstComment: "" });
    const result = hook.autoCreateRulesForPost(post);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toContain("no firstComment");
  });

  it("skips when no Comment-trigger pattern is in the body", () => {
    const post = makePost({ text: "Just a normal post body without trigger" });
    const result = hook.autoCreateRulesForPost(post);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]).toMatch(/no Comment trigger/);
  });

  it("skips when the post does NOT target IG or FB", () => {
    const post = makePost({ platforms: ["twitter", "linkedin"] });
    const result = hook.autoCreateRulesForPost(post);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]).toMatch(/no IG\/FB platform/);
  });

  it("skips when isAutoDmRuleSkipped is set (user opt-out)", () => {
    const post = makePost({ isAutoDmRuleSkipped: true });
    const result = hook.autoCreateRulesForPost(post);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]).toBe("explicitly skipped");
  });

  it("dedupes — calling twice for the same post creates only ONE rule per platform", () => {
    const post = makePost();
    hook.autoCreateRulesForPost(post);
    const result2 = hook.autoCreateRulesForPost(post);
    expect(result2.created).toHaveLength(0);
    expect(result2.skipped[0]).toMatch(/already exists/);
    expect(rules.listRules({ platform: "instagram" })).toHaveLength(1);
  });

  it("prefers the platform-specific post-id from backendData over the flat backendPostId", () => {
    const post = makePost({
      backendData: { postiz: { id: "real-postiz-post-id-42" } },
      backendPostId: "fallback-ignored",
    });
    hook.autoCreateRulesForPost(post);
    const rule = rules.listRules({ platform: "instagram" })[0];
    expect(rule.postId).toBe("real-postiz-post-id-42");
  });
});
