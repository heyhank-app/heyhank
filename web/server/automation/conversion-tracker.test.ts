// Tests for the conversion tracker — link minting, click recording, UTM
// building, and funnel aggregation. Storage path is redirected to a temp dir
// per-test (the module captures HEYHANK_HOME at import time via paths.ts), so
// the real ~/.heyhank/automation/tracked-links.json is never touched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;
type TrackerModule = typeof import("./conversion-tracker.js");
let tracker: TrackerModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "conversion-tracker-test-"));
  process.env.HEYHANK_HOME = tempHome;
  delete process.env.HEYHANK_TRACKING_LINK_BASE;
  vi.resetModules();
  tracker = await import("./conversion-tracker.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

const baseInput = {
  ruleId: "rule-1",
  keyword: "AUTOMATE",
  platform: "instagram" as const,
  commenterId: "user-1",
  commenterName: "Jane",
  postId: "post-1",
  targetUrl: "https://markusstoeger.substack.com/p/my-guide",
};

// ─── Link minting ─────────────────────────────────────────────────────────────

describe("conversion-tracker — link minting", () => {
  it("creates + resolves a link with a unique code", () => {
    const link = tracker.createLink(baseInput);
    expect(link.code).toBeTruthy();
    expect(link.clicks).toEqual([]);
    const resolved = tracker.resolveLink(link.code);
    expect(resolved?.ruleId).toBe("rule-1");
    expect(resolved?.commenterId).toBe("user-1");
  });

  it("mints distinct codes across many sends", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(tracker.createLink(baseInput).code);
    expect(codes.size).toBe(50);
  });

  it("resolveLink returns null for an unknown code", () => {
    expect(tracker.resolveLink("nope")).toBeNull();
  });
});

// ─── reserve + commit (the send-then-persist flow) ─────────────────────────────

describe("conversion-tracker — reserve/commit", () => {
  it("reserveCode returns a code that is NOT yet persisted", () => {
    const code = tracker.reserveCode();
    expect(code).toBeTruthy();
    // Not persisted until commit, so it can't be resolved yet.
    expect(tracker.resolveLink(code)).toBeNull();
  });

  it("commitLink persists a reserved code with the messageId", () => {
    const code = tracker.reserveCode();
    tracker.commitLink(code, { ...baseInput, messageId: "mid-99" });
    const resolved = tracker.resolveLink(code);
    expect(resolved?.code).toBe(code);
    expect(resolved?.messageId).toBe("mid-99");
  });

  it("commitLink is idempotent on the same code (no duplicate rows)", () => {
    const code = tracker.reserveCode();
    tracker.commitLink(code, baseInput);
    tracker.commitLink(code, { ...baseInput, messageId: "mid-2" });
    expect(tracker.listLinks().filter((l) => l.code === code)).toHaveLength(1);
    expect(tracker.resolveLink(code)?.messageId).toBe("mid-2");
  });

  it("commitLink preserves existing clicks when re-committing", () => {
    const code = tracker.reserveCode();
    tracker.commitLink(code, baseInput);
    tracker.recordClick(code, { ua: "Mozilla/5.0" });
    tracker.commitLink(code, { ...baseInput, messageId: "mid-late" });
    expect(tracker.resolveLink(code)?.clicks).toHaveLength(1);
  });
});

// ─── Click recording + UTM building ────────────────────────────────────────────

describe("conversion-tracker — clicks + UTM", () => {
  it("records a click and returns a UTM-tagged redirect URL", () => {
    const link = tracker.createLink(baseInput);
    const res = tracker.recordClick(link.code, { ua: "iPhone", ip: "1.2.3.4" });
    expect(res).not.toBeNull();
    const url = new URL(res!.targetUrl);
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_medium")).toBe("auto_dm");
    expect(url.searchParams.get("utm_campaign")).toBe("automate"); // lowercased
    expect(url.searchParams.get("utm_content")).toBe(link.code);
    // The click is persisted.
    expect(tracker.resolveLink(link.code)?.clicks).toHaveLength(1);
  });

  it("recordClick on an unknown code returns null", () => {
    expect(tracker.recordClick("missing")).toBeNull();
  });

  it("preserves pre-existing query params on the target URL", () => {
    const link = tracker.createLink({
      ...baseInput,
      targetUrl: "https://example.com/p/x?ref=ig&existing=1",
    });
    const res = tracker.recordClick(link.code);
    const url = new URL(res!.targetUrl);
    expect(url.searchParams.get("ref")).toBe("ig");
    expect(url.searchParams.get("existing")).toBe("1");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
  });

  it("buildRedirectUrl returns the raw target if it is malformed", () => {
    const link = tracker.createLink({ ...baseInput, targetUrl: "not a url" });
    // recordClick still works; the redirect just can't be UTM-decorated.
    const res = tracker.recordClick(link.code);
    expect(res!.targetUrl).toBe("not a url");
  });

  it("truncates very long user-agent strings", () => {
    const link = tracker.createLink(baseInput);
    tracker.recordClick(link.code, { ua: "x".repeat(1000) });
    const ua = tracker.resolveLink(link.code)?.clicks[0].ua ?? "";
    expect(ua.length).toBeLessThanOrEqual(300);
  });
});

// ─── Funnel aggregation ─────────────────────────────────────────────────────────

describe("conversion-tracker — funnel", () => {
  it("aggregates sent + clicked + rate per rule", () => {
    // rule-1: 3 sends, 2 of them clicked (one clicked twice)
    const a = tracker.createLink({ ...baseInput, commenterId: "u1" });
    const b = tracker.createLink({ ...baseInput, commenterId: "u2" });
    tracker.createLink({ ...baseInput, commenterId: "u3" }); // never clicked
    tracker.recordClick(a.code);
    tracker.recordClick(b.code);
    tracker.recordClick(b.code); // second click on same link

    const funnel = tracker.buildFunnel();
    const rule1 = funnel.rules.find((r) => r.ruleId === "rule-1")!;
    expect(rule1.linksSent).toBe(3);
    expect(rule1.linksClicked).toBe(2);
    expect(rule1.totalClicks).toBe(3);
    expect(rule1.clickRate).toBeCloseTo(2 / 3, 5);
    expect(rule1.lastClickAt).toBeTruthy();
  });

  it("rolls up totals across multiple rules", () => {
    const a = tracker.createLink({ ...baseInput, ruleId: "rule-1" });
    tracker.createLink({ ...baseInput, ruleId: "rule-2", keyword: "BUILD" });
    tracker.recordClick(a.code);

    const funnel = tracker.buildFunnel();
    expect(funnel.totals.linksSent).toBe(2);
    expect(funnel.totals.linksClicked).toBe(1);
    expect(funnel.totals.clickRate).toBeCloseTo(0.5, 5);
    expect(funnel.rules).toHaveLength(2);
  });

  it("returns an empty funnel when no links exist", () => {
    const funnel = tracker.buildFunnel();
    expect(funnel.rules).toEqual([]);
    expect(funnel.totals.linksSent).toBe(0);
    expect(funnel.totals.clickRate).toBeNull();
  });
});

// ─── listLinks ─────────────────────────────────────────────────────────────────

describe("conversion-tracker — listLinks", () => {
  it("filters by ruleId", () => {
    tracker.createLink({ ...baseInput, ruleId: "rule-1" });
    tracker.createLink({ ...baseInput, ruleId: "rule-2" });
    expect(tracker.listLinks({ ruleId: "rule-2" })).toHaveLength(1);
    expect(tracker.listLinks()).toHaveLength(2);
  });
});

// ─── trackingLinkBase ────────────────────────────────────────────────────────────

describe("conversion-tracker — trackingLinkBase", () => {
  it("defaults to markusstoeger.com/go", () => {
    expect(tracker.trackingLinkBase()).toBe("https://markusstoeger.com/go");
  });

  it("honours the env override and strips a trailing slash", async () => {
    process.env.HEYHANK_TRACKING_LINK_BASE = "https://example.com/r/";
    // No resetModules needed — the function reads the env at call-time.
    expect(tracker.trackingLinkBase()).toBe("https://example.com/r");
  });
});
