// ─── Linear Agent Interaction SDK Routes ─────────────────────────────────────
// Webhook endpoint for AgentSessionEvent + OAuth callback for app installation.
// The webhook route and OAuth callback are registered BEFORE auth middleware —
// Linear handles its own signature verification via HMAC-SHA256 and the OAuth
// callback is a redirect from Linear's authorization flow (no auth token in URL).

import type { Hono } from "hono";
import type { LinearAgentBridge } from "../linear-agent-bridge.js";
import * as linearAgent from "../linear-agent.js";
import type { AgentSessionEventPayload } from "../linear-agent.js";
import * as agentStore from "../agent-store.js";
import { getSettings, updateSettings } from "../settings-manager.js";

/**
 * Register the Linear Agent SDK pre-auth routes (before auth middleware).
 * Includes the webhook (HMAC-SHA256 verified) and the OAuth callback
 * (redirect from Linear — user has no auth token in the URL).
 */
export function registerLinearAgentWebhookRoute(
  api: Hono,
  bridge: LinearAgentBridge,
): void {
  // Webhook endpoint — verified via HMAC-SHA256 signature (per-agent lookup)
  api.post("/linear/agent-webhook", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("linear-signature") ?? c.req.header("x-linear-signature");

    // Parse payload first to extract oauthClientId for agent lookup
    let payload: AgentSessionEventPayload;
    try {
      payload = JSON.parse(rawBody) as AgentSessionEventPayload;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    // Only handle AgentSessionEvent
    if (payload.type !== "AgentSessionEvent") {
      return c.json({ ok: true, ignored: true });
    }

    // Look up the agent by oauthClientId to get the correct webhook secret
    const agent = agentStore.listAgents().find(
      (a) => a.enabled && a.triggers?.linear?.enabled
        && a.triggers.linear.oauthClientId === payload.oauthClientId,
    );

    if (!agent) {
      console.error(`[linear-agent-routes] No agent found for oauthClientId: ${payload.oauthClientId}`);
      return c.json({ error: "No agent configured for this OAuth client" }, 404);
    }

    // Verify webhook signature with this agent's webhook secret
    const webhookSecret = agent.triggers?.linear?.webhookSecret || "";
    if (!linearAgent.verifyWebhookSignature(webhookSecret, rawBody, signature ?? null)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Dispatch asynchronously — must return 200 within 5s
    bridge.handleEvent(payload).catch((err) => {
      console.error("[linear-agent-routes] Error handling event:", err);
    });

    return c.json({ ok: true });
  });

  // OAuth callback — redirect from Linear after authorization.
  // Pre-auth because the browser lands here from Linear with no Companion auth token.
  // Protected by the OAuth `state` nonce (CSRF prevention).
  api.get("/linear/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.redirect(`/#/settings/linear?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return c.redirect("/#/settings/linear?oauth_error=no_code");
    }

    // Validate the state nonce to prevent CSRF
    const stateResult = linearAgent.validateOAuthState(state);
    if (!stateResult.valid) {
      return c.redirect("/#/settings/linear?oauth_error=invalid_state");
    }

    // Determine redirect target — validate returnTo is a safe relative hash-router path
    // to prevent open redirects (state passes through the browser and could be tampered with)
    const rawReturnTo = stateResult.returnTo;
    const redirectBase = (rawReturnTo && /^\/?#\//.test(rawReturnTo)) ? rawReturnTo : "/#/settings/linear";

    // Build redirect URI (must match what was sent in the authorize request)
    const settings = getSettings();
    const baseUrl = settings.publicUrl || `http://localhost:${process.env.PORT || 3456}`;
    const redirectUri = `${baseUrl}/api/linear/oauth/callback`;

    // Use staged credentials from global settings for the token exchange
    const tokens = await linearAgent.exchangeCodeForTokens(
      { clientId: settings.linearOAuthClientId, clientSecret: settings.linearOAuthClientSecret },
      code,
      redirectUri,
    );
    if (!tokens) {
      return c.redirect(`${redirectBase}?oauth_error=token_exchange_failed`);
    }

    // Persist tokens to global staging (will be moved to agent on creation)
    updateSettings({
      linearOAuthAccessToken: tokens.accessToken,
      linearOAuthRefreshToken: tokens.refreshToken,
    });

    console.log("[linear-agent-routes] OAuth tokens obtained successfully");
    return c.redirect(`${redirectBase}?oauth_success=true`);
  });
}

/**
 * Register protected Linear Agent SDK routes (after auth middleware).
 * Status + authorize URL + disconnect endpoints.
 */
export function registerLinearAgentProtectedRoutes(api: Hono): void {
  // Get OAuth authorize URL for installing the app
  api.get("/linear/oauth/authorize-url", (c) => {
    const settings = getSettings();
    const baseUrl = settings.publicUrl || `http://localhost:${process.env.PORT || 3456}`;
    const redirectUri = `${baseUrl}/api/linear/oauth/callback`;
    const returnTo = c.req.query("returnTo");
    // Validate returnTo is a safe relative hash-router path to prevent open redirects
    const safeReturnTo = returnTo && /^\/?#\//.test(returnTo) ? returnTo : undefined;
    const result = linearAgent.getOAuthAuthorizeUrl(settings.linearOAuthClientId, redirectUri, safeReturnTo);

    if (!result) {
      return c.json({ error: "OAuth client ID not configured" }, 400);
    }

    return c.json({ url: result.url });
  });

  // Check OAuth configuration status
  api.get("/linear/oauth/status", (c) => {
    const settings = getSettings();
    return c.json({
      configured: linearAgent.isLinearOAuthConfigured({
        clientId: settings.linearOAuthClientId,
        clientSecret: settings.linearOAuthClientSecret,
        accessToken: settings.linearOAuthAccessToken,
      }),
      hasClientId: !!settings.linearOAuthClientId.trim(),
      hasClientSecret: !!settings.linearOAuthClientSecret.trim(),
      hasWebhookSecret: !!settings.linearOAuthWebhookSecret.trim(),
      hasAccessToken: !!settings.linearOAuthAccessToken.trim(),
    });
  });

  // Disconnect OAuth (clear tokens)
  api.post("/linear/oauth/disconnect", (c) => {
    updateSettings({
      linearOAuthAccessToken: "",
      linearOAuthRefreshToken: "",
    });
    return c.json({ ok: true });
  });
}
