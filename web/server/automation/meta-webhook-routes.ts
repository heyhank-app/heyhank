// ─── Meta Webhook Routes ────────────────────────────────────────────────────
// Two endpoints, both exempt from the normal auth middleware:
//
//   GET  /api/webhooks/meta  — Meta verification challenge during webhook
//                              setup. Echoes back the `hub.challenge` query
//                              param iff `hub.verify_token` matches our
//                              configured webhookVerify.
//
//   POST /api/webhooks/meta  — Receives comment events. Verifies the
//                              `X-Hub-Signature-256` HMAC, parses the payload,
//                              dispatches each comment to the rules engine,
//                              and triggers Auto-DM sends.
//
// The auth-middleware in routes.ts must allow `/webhooks/meta` through
// (handled by a startsWith check, see routes.ts).

import type { Hono } from "hono";
import { getMetaSecrets, exchangeOAuthCode, exchangeFbOAuthCode } from "./meta-secrets.js";
import { getSettings as getAppSettings } from "../settings-manager.js";
import { verifyMetaSignature, extractCommentEvents, type CommentEvent } from "./meta-webhook.js";
import { findMatchingRule, recordSend, recordReply } from "./auto-dm-rules.js";
import { reserveCode, commitLink, trackingLinkBase, LINK_PLACEHOLDER } from "./conversion-tracker.js";

/**
 * Handle a single normalized comment event: find a matching rule, fire the
 * Send API if one exists, record the send. Errors are caught + logged so a
 * single bad event doesn't crash the rest of the batch.
 *
 * Send-API integration is wired via the optional `sendFn` so this function
 * is unit-testable without hitting Meta. Production wires the real Send API
 * via `setMetaSender()` below.
 */
export type MetaSenderFn = (
  args: { event: CommentEvent; dmTemplate: string },
) => Promise<{ ok: boolean; messageId?: string; error?: string }>;

export type MetaReplySenderFn = (
  args: { event: CommentEvent; replyText: string },
) => Promise<{ ok: boolean; replyId?: string; error?: string }>;

let _sender: MetaSenderFn | null = null;
let _replySender: MetaReplySenderFn | null = null;

/** Wire the real Send API for production. Tests call this with a mock. */
export function setMetaSender(fn: MetaSenderFn | null): void {
  _sender = fn;
}

/** Wire the real comment-reply API for production. Tests call this with a mock. */
export function setMetaReplySender(fn: MetaReplySenderFn | null): void {
  _replySender = fn;
}

export async function processCommentEvent(event: CommentEvent): Promise<{
  matched: boolean;
  ruleId?: string;
  sent: boolean;
  /** Whether a public comment-reply was posted (combo engagement boost). */
  replied?: boolean;
  error?: string;
}> {
  const rule = findMatchingRule(event);
  if (!rule) return { matched: false, sent: false };
  if (!_sender) return { matched: true, ruleId: rule.id, sent: false, error: "no sender configured" };

  // Personalise the DM with a tracking link iff the template opts in via the
  // {{link}} placeholder AND the rule has a targetUrl. We reserve the short
  // code BEFORE sending (the code must be inside the DM text), then commit the
  // TrackedLink only on send success so failed sends leave no orphan links.
  const wantsLink = Boolean(rule.targetUrl) && rule.dmTemplate.includes(LINK_PLACEHOLDER);
  const code = wantsLink ? reserveCode() : null;
  const dmText = code
    ? rule.dmTemplate.split(LINK_PLACEHOLDER).join(`${trackingLinkBase()}/${code}`)
    : rule.dmTemplate;

  try {
    const result = await _sender({ event, dmTemplate: dmText });
    if (!result.ok) return { matched: true, ruleId: rule.id, sent: false, error: result.error ?? "send failed" };
    recordSend(rule.id, event);
    if (code) {
      commitLink(code, {
        ruleId: rule.id,
        keyword: rule.keyword,
        platform: rule.platform,
        commenterId: event.commenterId,
        commenterName: event.commenterName,
        postId: event.postId,
        targetUrl: rule.targetUrl as string,
        messageId: result.messageId,
      });
    }

    // Combo engagement boost: post a public reply in the comment thread AFTER
    // a successful DM. Gated on DM success (above) + best-effort — a reply
    // failure (e.g. the instagram_manage_comments scope isn't approved yet)
    // never undoes the DM; we just log it and report replied:false.
    let replied = false;
    if (rule.publicReply && rule.publicReply.trim() && _replySender) {
      try {
        const reply = await _replySender({ event, replyText: rule.publicReply });
        if (reply.ok) {
          recordReply(rule.id);
          replied = true;
        } else {
          console.log(`[meta-webhook] public reply failed rule=${rule.id} error=${reply.error}`);
        }
      } catch (e) {
        console.log(`[meta-webhook] public reply threw rule=${rule.id} error=${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { matched: true, ruleId: rule.id, sent: true, replied };
  } catch (e) {
    return { matched: true, ruleId: rule.id, sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stub OAuth callback. Meta requires a `redirect_uri` to be configured in the
 * Instagram Business Login setup even when the actual auth flow is handled
 * via System User Tokens (our case). This endpoint is registered to satisfy
 * the Meta requirement; if Meta ever does redirect a real user here we
 * acknowledge the code+state so the flow doesn't 404, but we don't currently
 * exchange it for a token (System User token covers our use case).
 */
function registerMetaAuthCallback(api: Hono): void {
  /**
   * Deauthorize callback — Meta calls this when a user removes our app from
   * their Instagram/Facebook account ("Apps and Websites > Remove"). The
   * request is a signed JWT in `signed_request` body field. We don't have
   * stored per-user data to delete (single-tenant), so we ACK with 200 and
   * a placeholder confirmation URL. App Review requires this endpoint.
   */
  api.post("/auth/meta/deauthorize", (c) => {
    return c.json({ url: "https://agent.markusstoeger.com/api/auth/meta/deauthorize", confirmation_code: "deauth-acked" });
  });
  api.get("/auth/meta/deauthorize", (c) => {
    return c.html(
      `<html><body style="font-family: system-ui; padding: 2rem"><h1>HeyHank — Meta Deauthorize</h1><p>This endpoint receives Meta's app-removal notifications. No per-user data is stored.</p></body></html>`,
      200,
    );
  });

  /**
   * Data deletion request callback — Meta calls this when a user requests
   * data deletion via Meta's "Off-Facebook Activity" tool or similar. Same
   * shape as deauthorize: signed_request body, respond with `url` +
   * `confirmation_code` so Meta can show the user where their deletion
   * request is being tracked.
   */
  api.post("/auth/meta/data-deletion", (c) => {
    return c.json({ url: "https://agent.markusstoeger.com/api/auth/meta/data-deletion", confirmation_code: "no-data-stored" });
  });
  api.get("/auth/meta/data-deletion", (c) => {
    return c.html(
      `<html><body style="font-family: system-ui; padding: 2rem"><h1>HeyHank — Data Deletion</h1><p>HeyHank does not store personal data from Instagram/Facebook users beyond what's needed for the active Auto-DM session. No deletion action required.</p></body></html>`,
      200,
    );
  });

  api.get("/auth/meta/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    if (error) {
      return c.html(
        `<html><body style="font-family: system-ui; padding: 2rem"><h1>Meta OAuth: ${error}</h1><p>${c.req.query("error_description") ?? ""}</p></body></html>`,
        400,
      );
    }
    if (!code) {
      return c.html(
        `<html><body style="font-family: system-ui; padding: 2rem"><h1>HeyHank — Meta OAuth callback</h1><p>This endpoint is the registered redirect_uri for our Meta App's Instagram Business Login flow. It is only ever called by Meta during OAuth.</p></body></html>`,
        200,
      );
    }

    // Code-exchange: short-lived → long-lived user access token. Persisted in
    // meta-secrets and used by subsequent /me/subscribed_apps + /me/messages
    // calls. Without this exchange the System-User-token path silently fails
    // on the new graph.instagram.com endpoints.
    //
    // CRITICAL: Meta validates that redirect_uri matches EXACTLY what was used
    // in the original OAuth dialog. Behind nginx, `c.req.url` reflects the
    // internal http://127.0.0.1:3100 origin, which would never match Meta's
    // registered https://agent.markusstoeger.com value. Always use the
    // publicUrl from app settings.
    const publicUrl = getAppSettings().publicUrl?.replace(/\/+$/, "") ?? "";
    if (!publicUrl) {
      return c.html(
        `<html><body style="font-family: system-ui; padding: 2rem"><h1>OAuth Exchange Setup Error</h1><p>publicUrl is not configured in HeyHank settings. Set it in /api/settings before the OAuth flow can complete.</p></body></html>`,
        500,
      );
    }
    const redirectUri = `${publicUrl}/api/auth/meta/callback`;

    // Route to the right exchanger based on the `state` parameter the OAuth
    // URL was opened with. `state=fb` → Facebook flow (Page Token), anything
    // else (default + state=ig) → Instagram flow (Instagram User Token).
    // Falling back to IG is the historical default — old OAuth URLs without
    // state still work.
    const isFb = state === "fb";
    const result = isFb
      ? await exchangeFbOAuthCode(code, redirectUri)
      : await exchangeOAuthCode(code, redirectUri);

    if (!result.ok) {
      return c.html(
        `<html><body style="font-family: system-ui; padding: 2rem"><h1>HeyHank — ${isFb ? "Facebook" : "Instagram"} OAuth Exchange failed</h1><p style="color:#c00">${result.error}</p><p>Code length was ${code.length}. You can try the OAuth URL again.</p></body></html>`,
        500,
      );
    }
    const expiry = result.expiresAt ? new Date(result.expiresAt).toISOString() : "n/a";
    const detailLine = isFb
      ? `Facebook Page-Access flow complete. Valid until <code>${expiry}</code>.`
      : `Long-lived Instagram user access token saved. Valid until <code>${expiry}</code>. IG User ID: <code>${("igUserId" in result ? result.igUserId : null) ?? "n/a"}</code>.`;
    return c.html(
      `<html><body style="font-family: system-ui; padding: 2rem"><h1>HeyHank — ${isFb ? "Facebook" : "Meta"} OAuth ✓</h1><p>${detailLine}</p><p>State: ${state ?? "n/a"}.</p><p>You can close this tab — webhooks should now fire for real comments.</p></body></html>`,
      200,
    );
  });
}

export function registerMetaWebhookRoutes(api: Hono): void {
  registerMetaAuthCallback(api);
  /**
   * Webhook verification. Meta calls this once when you configure or refresh
   * the webhook URL in the app dashboard. We must echo `hub.challenge`
   * verbatim iff the verify-token matches the one stored in our secrets.
   */
  api.get("/webhooks/meta", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    const secrets = getMetaSecrets();
    if (mode === "subscribe" && token && secrets.webhookVerify && token === secrets.webhookVerify && challenge) {
      // Meta expects the raw challenge string in the response body.
      return c.text(challenge, 200);
    }
    return c.text("verification failed", 403);
  });

  /**
   * Event delivery. Meta POSTs JSON for every subscribed change. We verify
   * the HMAC signature using the raw body (NOT a re-serialized JSON, which
   * would re-order keys and break the hash), then dispatch each comment.
   */
  api.post("/webhooks/meta", async (c) => {
    const secrets = getMetaSecrets();
    const rawBody = await c.req.text();
    const sigHeader = c.req.header("x-hub-signature-256");

    // The webhook serves BOTH Instagram and Facebook subscriptions, each
    // signed with its own App Secret (IG-child-app vs FB-parent-app). We
    // peek at `object` in the JSON to pick the right secret — but fall
    // back to trying BOTH secrets if either is configured, so we never
    // 403 a legitimately-signed payload just because we guessed wrong.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.text("invalid json", 400);
    }

    const objectType = (payload as { object?: string } | null)?.object;
    const primarySecret = objectType === "page" ? secrets.fbAppSecret : secrets.appSecret;
    const fallbackSecret = objectType === "page" ? secrets.appSecret : secrets.fbAppSecret;

    if (!primarySecret && !fallbackSecret) {
      // No secrets configured — accept-and-drop so Meta doesn't disable.
      return c.text("ok", 200);
    }

    const verified =
      (primarySecret && verifyMetaSignature(rawBody, sigHeader, primarySecret)) ||
      (fallbackSecret && verifyMetaSignature(rawBody, sigHeader, fallbackSecret));
    if (!verified) {
      return c.text("signature mismatch", 403);
    }

    const events = extractCommentEvents(payload);

    // Diagnostic log: emit one line per inbound payload so the operator can
    // verify in pm2 logs that comments are arriving + which platform + how
    // many events parsed out + whether any matched a rule. Truncated raw
    // payload included so unrecognised event shapes are debuggable.
    const objSummary = (payload as { object?: string } | null)?.object ?? "unknown";
    console.log(`[meta-webhook] object=${objSummary} events=${events.length} raw=${rawBody.slice(0, 500)}`);

    // Process events in parallel — they're independent. Errors are captured
    // by processCommentEvent itself; the response is always 200 so Meta
    // doesn't retry the whole batch on a single failure.
    const results = await Promise.all(events.map((ev) => processCommentEvent(ev)));
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const r = results[i];
      console.log(`[meta-webhook] event ${i + 1}/${events.length}: platform=${ev.platform} commentId=${ev.commentId} text="${ev.text.slice(0, 60)}" matched=${r.matched} sent=${r.sent}${r.error ? ` error=${r.error}` : ""}`);
    }
    return c.text("ok", 200);
  });
}
