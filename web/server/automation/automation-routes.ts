// ─── Automation REST Routes ─────────────────────────────────────────────────
// Settings-endpoints for the Meta App secrets + CRUD for Auto-DM rules.
// All endpoints sit behind the normal auth middleware (auth header / cookie).
// The webhook receivers (/webhooks/meta) are intentionally exempt — see
// routes.ts for that bypass.

import type { Hono } from "hono";
import { getMetaSecrets, saveMetaSecrets, metaIsConfigured } from "./meta-secrets.js";

const GRAPH_FB_BASE = "https://graph.facebook.com/v21.0";
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  type AutoDmPlatform,
} from "./auto-dm-rules.js";
import { buildFunnel, listLinks } from "./conversion-tracker.js";

const SECRET_FIELDS = [
  // Instagram side
  "appId",
  "appSecret",
  "igBusinessId",
  // Facebook side
  "fbAppId",
  "fbAppSecret",
  "pageId",
  "pageAccessToken",
  // Shared
  "webhookVerify",
] as const;

export function registerAutomationRoutes(api: Hono): void {
  // ─── Meta Secrets ──────────────────────────────────────────────────────
  /** GET: returns masked secrets + a `configured` flag (true when all 6 fields present). */
  api.get("/automation/meta-secrets", (c) => {
    const s = getMetaSecrets();
    return c.json({
      configured: metaIsConfigured(),
      appId: s.appId,
      pageId: s.pageId,
      igBusinessId: s.igBusinessId,
      fbAppId: s.fbAppId,
      // Sensitive fields: return only a short prefix + length so the UI can
      // show "•••••••• (configured)" without ever leaking the value.
      appSecretConfigured: !!s.appSecret.trim(),
      fbAppSecretConfigured: !!s.fbAppSecret.trim(),
      pageAccessTokenConfigured: !!s.pageAccessToken.trim(),
      webhookVerifyConfigured: !!s.webhookVerify.trim(),
    });
  });

  /** PUT: partial update of the secrets. Only fields present in the body are written. */
  api.put("/automation/meta-secrets", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const patch: Record<string, string> = {};
      for (const f of SECRET_FIELDS) {
        if (typeof body[f] === "string") patch[f] = (body[f] as string).trim();
      }
      const saved = saveMetaSecrets(patch);
      return c.json({
        ok: true,
        configured: metaIsConfigured(),
        appId: saved.appId,
        pageId: saved.pageId,
        igBusinessId: saved.igBusinessId,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid body" }, 400);
    }
  });

  // ─── Connected Pages (demos pages_show_list + business_management) ─────
  /**
   * Returns the list of Facebook Pages the authenticated user can manage.
   * Calls Graph API /me/accounts using the long-lived fbUserAccessToken
   * (preferred — set via OAuth callback). If only a System-User Page Token
   * is configured we fall back to GET /{pageId} which returns single-page
   * info — sufficient for the UI to display the active page even before
   * the user re-authenticates with the FB OAuth flow.
   *
   * Each entry: { id, name, picture, isActive }. `isActive` flags the page
   * currently selected for Auto-DM rules (pageId in meta-secrets).
   */
  api.get("/automation/connected-pages", async (c) => {
    const s = getMetaSecrets();
    if (!s.fbUserAccessToken && !s.pageAccessToken) {
      return c.json({ pages: [], needsReconnect: true, reason: "no FB access token configured" });
    }

    try {
      let pages: Array<{ id: string; name: string; picture: string | null }> = [];

      if (s.fbUserAccessToken) {
        // Preferred: /me/accounts — demonstrates pages_show_list +
        // business_management. Returns ALL pages the user manages.
        const url = `${GRAPH_FB_BASE}/me/accounts?fields=id,name,picture{url}&access_token=${encodeURIComponent(s.fbUserAccessToken)}`;
        const res = await fetch(url);
        const data = await res.json() as {
          data?: Array<{ id: string; name: string; picture?: { data?: { url?: string } } }>;
          error?: { message?: string };
        };
        if (!res.ok || data.error) {
          return c.json({
            pages: [],
            needsReconnect: true,
            reason: data.error?.message ?? `HTTP ${res.status}`,
          });
        }
        pages = (data.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          picture: p.picture?.data?.url ?? null,
        }));
      } else if (s.pageAccessToken && s.pageId) {
        // Fallback: single-page info via Page Token. Lets the UI show the
        // currently-configured page even when the user hasn't completed the
        // FB OAuth flow yet (so they know reconnect is needed for the full
        // pages_show_list demo).
        const url = `${GRAPH_FB_BASE}/${encodeURIComponent(s.pageId)}?fields=id,name,picture{url}&access_token=${encodeURIComponent(s.pageAccessToken)}`;
        const res = await fetch(url);
        const data = await res.json() as {
          id?: string; name?: string; picture?: { data?: { url?: string } };
          error?: { message?: string };
        };
        if (!res.ok || data.error) {
          return c.json({
            pages: [],
            needsReconnect: true,
            reason: data.error?.message ?? `HTTP ${res.status}`,
          });
        }
        if (data.id && data.name) {
          pages = [{ id: data.id, name: data.name, picture: data.picture?.data?.url ?? null }];
        }
      }

      return c.json({
        pages: pages.map((p) => ({ ...p, isActive: p.id === s.pageId })),
        activePageId: s.pageId,
        source: s.fbUserAccessToken ? "user-token" : "page-token-fallback",
        needsReconnect: !s.fbUserAccessToken,
      });
    } catch (e) {
      return c.json({
        pages: [],
        needsReconnect: true,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * Returns the Facebook OAuth dialog URL the user should open to grant the
   * App access to their pages. Keeps the URL construction server-side so we
   * can use the configured fbAppId + publicUrl without leaking either to
   * the frontend bundle.
   */
  api.get("/automation/fb-oauth-url", (c) => {
    const s = getMetaSecrets();
    const fbAppId = s.fbAppId || s.appId;
    if (!fbAppId) return c.json({ error: "fbAppId not configured" }, 400);
    // Determine the public URL from the request host since we don't import
    // the app-settings module here. Trust the configured Host header — this
    // endpoint sits behind the auth middleware so external manipulation is
    // not possible.
    const proto = c.req.header("x-forwarded-proto") ?? "https";
    const host = c.req.header("host") ?? "agent.markusstoeger.com";
    const redirectUri = `${proto}://${host}/api/auth/meta/callback`;
    const scope = [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_messaging",
      "pages_messaging",
      "business_management",
    ].join(",");
    const url =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(fbAppId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&state=fb` +
      `&scope=${encodeURIComponent(scope)}`;
    return c.json({ url, redirectUri });
  });

  // ─── Auto-DM Rules ─────────────────────────────────────────────────────

  /** List rules (optional platform / postId filter). */
  api.get("/automation/rules", (c) => {
    const platform = c.req.query("platform");
    const postId = c.req.query("postId");
    const opts: { platform?: AutoDmPlatform; postId?: string } = {};
    if (platform === "instagram" || platform === "facebook") opts.platform = platform;
    if (postId) opts.postId = postId;
    return c.json({ rules: listRules(opts) });
  });

  /** Get one rule by ID. */
  api.get("/automation/rules/:id", (c) => {
    const rule = getRule(c.req.param("id"));
    if (!rule) return c.json({ error: "not found" }, 404);
    return c.json(rule);
  });

  /** Create a new rule. */
  api.post("/automation/rules", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      if (body.platform !== "instagram" && body.platform !== "facebook") {
        return c.json({ error: "platform must be 'instagram' or 'facebook'" }, 400);
      }
      if (typeof body.keyword !== "string" || !body.keyword.trim()) {
        return c.json({ error: "keyword is required" }, 400);
      }
      if (typeof body.dmTemplate !== "string" || !body.dmTemplate.trim()) {
        return c.json({ error: "dmTemplate is required" }, 400);
      }
      const rule = createRule({
        platform: body.platform,
        keyword: body.keyword,
        dmTemplate: body.dmTemplate,
        postId: typeof body.postId === "string" ? body.postId : null,
        targetUrl: typeof body.targetUrl === "string" ? body.targetUrl.trim() : null,
        publicReply: typeof body.publicReply === "string" ? body.publicReply : null,
        enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return c.json({ ok: true, rule }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid body" }, 400);
    }
  });

  /** Partial update. */
  api.patch("/automation/rules/:id", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof body.keyword === "string") patch.keyword = body.keyword.trim();
      if (typeof body.dmTemplate === "string") patch.dmTemplate = body.dmTemplate;
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (typeof body.notes === "string") patch.notes = body.notes;
      if (typeof body.postId === "string" || body.postId === null) patch.postId = body.postId;
      if (typeof body.targetUrl === "string" || body.targetUrl === null) {
        patch.targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : null;
      }
      if (typeof body.publicReply === "string" || body.publicReply === null) {
        patch.publicReply = typeof body.publicReply === "string" ? body.publicReply : null;
      }
      const rule = updateRule(c.req.param("id"), patch as Parameters<typeof updateRule>[1]);
      if (!rule) return c.json({ error: "not found" }, 404);
      return c.json(rule);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid body" }, 400);
    }
  });

  /** Delete. */
  api.delete("/automation/rules/:id", (c) => {
    const ok = deleteRule(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  // ─── Conversion Funnel ─────────────────────────────────────────────────

  /**
   * Click funnel grouped by rule: comment→DM→click. Reflects only DMs that
   * carried a {{link}} tracking link. Pair `funnel.rules[].linksSent` with the
   * rule's own `sentCount` to see how many sends were click-measurable.
   */
  api.get("/automation/funnel", (c) => {
    return c.json(buildFunnel());
  });

  /** Raw tracked links (newest first), optional ?ruleId filter. For drill-down. */
  api.get("/automation/links", (c) => {
    const ruleId = c.req.query("ruleId");
    return c.json({ links: listLinks(ruleId ? { ruleId } : undefined) });
  });
}
