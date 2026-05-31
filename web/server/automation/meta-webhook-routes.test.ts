// Tests for processCommentEvent — focused on the conversion tracking-link
// personalization wired into the Auto-DM dispatch. Verifies that:
//   - a {{link}} placeholder + a rule.targetUrl produces a personalised
//     tracking link in the DM text passed to the sender
//   - the TrackedLink is committed only on send SUCCESS (no orphans on failure)
//   - plain DMs (no placeholder / no targetUrl) are sent verbatim, no link minted
//
// HEYHANK_HOME is redirected to a temp dir per-test; the rules + tracker
// modules capture it at import time, so we resetModules + re-import after
// pointing it at a fresh dir (same pattern as auto-dm-rules.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommentEvent } from "./meta-webhook.js";

let tempHome: string;
type RoutesModule = typeof import("./meta-webhook-routes.js");
type RulesModule = typeof import("./auto-dm-rules.js");
type TrackerModule = typeof import("./conversion-tracker.js");
let routes: RoutesModule;
let rules: RulesModule;
let tracker: TrackerModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "webhook-routes-test-"));
  process.env.HEYHANK_HOME = tempHome;
  process.env.HEYHANK_TRACKING_LINK_BASE = "https://markusstoeger.com/go";
  vi.resetModules();
  // Import all three after the reset so they share one fresh module registry
  // pointed at the temp HEYHANK_HOME.
  rules = await import("./auto-dm-rules.js");
  tracker = await import("./conversion-tracker.js");
  routes = await import("./meta-webhook-routes.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  routes.setMetaSender(null);
});

function makeEvent(overrides: Partial<CommentEvent> = {}): CommentEvent {
  return {
    platform: "instagram",
    postId: "post-1",
    commentId: "comment-1",
    commenterId: "user-1",
    commenterName: "Jane",
    text: "Comment GUIDE please",
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe("processCommentEvent — tracking-link personalization", () => {
  it("injects a tracking link when the template has {{link}} + a targetUrl", async () => {
    rules.createRule({
      platform: "instagram",
      keyword: "GUIDE",
      dmTemplate: "Here you go: {{link}}",
      targetUrl: "https://markusstoeger.substack.com/p/guide",
    });

    let sentText = "";
    routes.setMetaSender(async ({ dmTemplate }) => {
      sentText = dmTemplate;
      return { ok: true, messageId: "mid-1" };
    });

    const result = await routes.processCommentEvent(makeEvent());
    expect(result.sent).toBe(true);

    // The placeholder was replaced with a real link.
    expect(sentText).toMatch(/^Here you go: https:\/\/markusstoeger\.com\/go\/.+$/);
    expect(sentText).not.toContain("{{link}}");

    // A TrackedLink was committed with the messageId + the commenter.
    const links = tracker.listLinks();
    expect(links).toHaveLength(1);
    expect(links[0].messageId).toBe("mid-1");
    expect(links[0].commenterId).toBe("user-1");
    expect(links[0].targetUrl).toBe("https://markusstoeger.substack.com/p/guide");

    // The code in the DM text matches the persisted link.
    const code = sentText.split("/go/")[1];
    expect(tracker.resolveLink(code)?.code).toBe(code);
  });

  it("does NOT commit a link when the send fails (no orphans)", async () => {
    rules.createRule({
      platform: "instagram",
      keyword: "GUIDE",
      dmTemplate: "Here: {{link}}",
      targetUrl: "https://markusstoeger.substack.com/p/guide",
    });

    routes.setMetaSender(async () => ({ ok: false, error: "7-day window expired" }));

    const result = await routes.processCommentEvent(makeEvent());
    expect(result.sent).toBe(false);
    expect(tracker.listLinks()).toHaveLength(0);
  });

  it("sends the template verbatim when there is no {{link}} placeholder", async () => {
    rules.createRule({
      platform: "instagram",
      keyword: "GUIDE",
      dmTemplate: "No link here, just text.",
      targetUrl: "https://markusstoeger.substack.com/p/guide",
    });

    let sentText = "";
    routes.setMetaSender(async ({ dmTemplate }) => {
      sentText = dmTemplate;
      return { ok: true, messageId: "mid-2" };
    });

    await routes.processCommentEvent(makeEvent());
    expect(sentText).toBe("No link here, just text.");
    expect(tracker.listLinks()).toHaveLength(0); // no link minted
  });

  it("does not mint a link when {{link}} is present but targetUrl is missing", async () => {
    rules.createRule({
      platform: "instagram",
      keyword: "GUIDE",
      dmTemplate: "Broken: {{link}}",
      // no targetUrl
    });

    let sentText = "";
    routes.setMetaSender(async ({ dmTemplate }) => {
      sentText = dmTemplate;
      return { ok: true };
    });

    await routes.processCommentEvent(makeEvent());
    // Placeholder stays literal (nothing to point it at) and no link row is made.
    expect(sentText).toBe("Broken: {{link}}");
    expect(tracker.listLinks()).toHaveLength(0);
  });

  it("reports matched:false when no rule matches", async () => {
    routes.setMetaSender(async () => ({ ok: true }));
    const result = await routes.processCommentEvent(makeEvent({ text: "unrelated" }));
    expect(result.matched).toBe(false);
    expect(result.sent).toBe(false);
  });
});
