// Tests for the public /go/:code redirect route. Builds a bare Hono app,
// registers the route, and drives it with app.request(). The conversion
// tracker uses a temp HEYHANK_HOME so the real link store is untouched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

let tempHome: string;
type GoModule = typeof import("./go-routes.js");
type TrackerModule = typeof import("./conversion-tracker.js");
let go: GoModule;
let tracker: TrackerModule;
let app: Hono;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "go-routes-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  tracker = await import("./conversion-tracker.js");
  go = await import("./go-routes.js");
  app = new Hono();
  go.registerGoRoutes(app);
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /go/:code", () => {
  it("302-redirects a valid code to the UTM-tagged target and logs a click", async () => {
    const link = tracker.createLink({
      ruleId: "rule-1",
      keyword: "GUIDE",
      platform: "instagram",
      commenterId: "user-1",
      postId: "post-1",
      targetUrl: "https://markusstoeger.substack.com/p/guide",
    });

    const res = await app.request(`/go/${link.code}`, {
      headers: { "user-agent": "TestAgent/1.0" },
    });

    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    const url = new URL(loc);
    expect(url.origin + url.pathname).toBe("https://markusstoeger.substack.com/p/guide");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_content")).toBe(link.code);

    // The click was recorded with the UA.
    const clicks = tracker.resolveLink(link.code)?.clicks ?? [];
    expect(clicks).toHaveLength(1);
    expect(clicks[0].ua).toBe("TestAgent/1.0");
  });

  it("prefers the forwarded UA header set by the Next.js proxy", async () => {
    const link = tracker.createLink({
      ruleId: "rule-1",
      keyword: "GUIDE",
      platform: "instagram",
      commenterId: "user-1",
      postId: "post-1",
      targetUrl: "https://example.com/p",
    });

    await app.request(`/go/${link.code}`, {
      headers: {
        "user-agent": "Next.js proxy fetch",
        "x-forwarded-user-agent": "RealVisitor iPhone",
        "x-forwarded-for": "9.9.9.9, 10.0.0.1",
      },
    });

    const click = tracker.resolveLink(link.code)?.clicks[0];
    expect(click?.ua).toBe("RealVisitor iPhone");
    expect(click?.ip).toBe("9.9.9.9"); // first hop only
  });

  it("redirects unknown codes to the brand home without logging", async () => {
    const res = await app.request("/go/does-not-exist");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://markusstoeger.substack.com/");
  });
});
