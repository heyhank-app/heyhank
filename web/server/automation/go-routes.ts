// ─── Tracking-Link Redirect ─────────────────────────────────────────────────
// Public endpoint (no auth — Instagram/Facebook users have no HeyHank token).
//
//   GET /api/go/:code
//     1. Resolve the short code → TrackedLink
//     2. Record a click (UA + best-effort IP)
//     3. 302-redirect to the targetUrl with UTM params appended
//
// The clean public link in DMs is markusstoeger.com/go/<code>; a thin Next.js
// proxy on that domain forwards to this backend endpoint (see
// markusstoeger.com app/go/[code]/route.ts). Hitting this endpoint directly
// (agent.markusstoeger.com/api/go/<code>) also works as a fallback.
//
// Auth-bypass for /go + /api/go is wired in routes.ts alongside the webhook
// bypass.

import type { Hono } from "hono";
import { recordClick } from "./conversion-tracker.js";

export function registerGoRoutes(api: Hono): void {
  api.get("/go/:code", (c) => {
    const code = c.req.param("code");
    // Forwarded by the Next.js proxy (real visitor UA/IP), else the direct
    // request's own headers.
    const ua = c.req.header("x-forwarded-user-agent") || c.req.header("user-agent") || undefined;
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      undefined;

    const result = recordClick(code, { ua, ip });
    if (!result) {
      // Unknown code — don't leak that it's invalid, just send to the brand home.
      return c.redirect("https://markusstoeger.substack.com/", 302);
    }
    return c.redirect(result.targetUrl, 302);
  });
}
