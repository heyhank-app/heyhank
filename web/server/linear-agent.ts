// ─── Linear Agent Interaction SDK Client ──────────────────────────────────────
// Handles OAuth token management, webhook signature verification, and GraphQL
// mutations for the Linear Agent Interaction SDK (agent sessions, activities).
//
// This module is stateless — it reads credentials from settings-manager.ts on
// each call. Token refresh is handled transparently on 401.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { getSettings, updateSettings } from "./settings-manager.js";

// ─── OAuth state management (CSRF protection) ───────────────────────────────
// Short-lived nonces for the OAuth authorization flow. Each nonce expires after 10 minutes.
const oauthStateNonces = new Map<string, number>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Generate a random state nonce for OAuth CSRF protection. */
export function generateOAuthState(): string {
  // Prune expired nonces
  const now = Date.now();
  for (const [nonce, expiresAt] of oauthStateNonces) {
    if (expiresAt < now) oauthStateNonces.delete(nonce);
  }
  const state = randomBytes(24).toString("hex");
  oauthStateNonces.set(state, now + OAUTH_STATE_TTL_MS);
  return state;
}

/** Validate and consume an OAuth state nonce. Returns true if valid. */
export function validateOAuthState(state: string | null | undefined): boolean {
  if (!state) return false;
  const expiresAt = oauthStateNonces.get(state);
  if (!expiresAt) return false;
  oauthStateNonces.delete(state); // consume — single use
  return Date.now() < expiresAt;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentActivityType = "thought" | "action" | "elicitation" | "response" | "error";

export interface ThoughtContent {
  type: "thought";
  body: string;
  ephemeral?: boolean;
}

export interface ActionContent {
  type: "action";
  action: string;
  parameter?: string;
  result?: string;
  ephemeral?: boolean;
}

export interface ElicitationContent {
  type: "elicitation";
  body: string;
}

export interface ResponseContent {
  type: "response";
  body: string;
}

export interface ErrorContent {
  type: "error";
  body: string;
}

export type AgentActivityContent =
  | ThoughtContent
  | ActionContent
  | ElicitationContent
  | ResponseContent
  | ErrorContent;

export interface AgentPlanItem {
  content: string;
  status: "pending" | "inProgress" | "completed" | "canceled";
}

export interface AgentSessionEventPayload {
  action: "created" | "prompted";
  type: "AgentSessionEvent";
  data: {
    id: string;
    issueId?: string;
    agentId?: string;
    promptContext?: string;
  };
  /** Present on "prompted" events — the user's follow-up message */
  agentActivity?: {
    body?: string;
  };
  webhookTimestamp?: number;
  organizationId?: string;
}

// ─── GraphQL helper ─────────────────────────────────────────────────────────

/** Guard against concurrent 401s triggering multiple simultaneous refresh requests. */
let refreshPromise: Promise<string | null> | null = null;

/** Get a refreshed token, coalescing concurrent refresh requests into a single call. */
async function getRefreshedToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/** Execute a GraphQL query against the Linear API with automatic token refresh. */
export async function linearGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const settings = getSettings();
  let token = settings.linearOAuthAccessToken;

  if (!token) {
    throw new Error("Linear OAuth not configured — no access token");
  }

  let response = await fetchGraphQL(token, query, variables);

  // Auto-refresh on 401 — coalesced to prevent concurrent refresh races
  if (response.status === 401 && settings.linearOAuthRefreshToken) {
    const refreshed = await getRefreshedToken();
    if (refreshed) {
      token = refreshed;
      response = await fetchGraphQL(token, query, variables);
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear API error ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<{ data?: T; errors?: Array<{ message: string }> }>;
}

async function fetchGraphQL(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  return fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
}

// ─── Token management ───────────────────────────────────────────────────────

/** Refresh the OAuth access token using the refresh token. Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  const settings = getSettings();
  const { linearOAuthClientId, linearOAuthClientSecret, linearOAuthRefreshToken } = settings;

  if (!linearOAuthClientId || !linearOAuthClientSecret || !linearOAuthRefreshToken) {
    return null;
  }

  try {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: linearOAuthRefreshToken,
        client_id: linearOAuthClientId,
        client_secret: linearOAuthClientSecret,
      }),
    });

    if (!response.ok) {
      console.error("[linear-agent] Token refresh failed:", response.status);
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Persist new tokens
    updateSettings({
      linearOAuthAccessToken: data.access_token,
      linearOAuthRefreshToken: data.refresh_token || linearOAuthRefreshToken,
    });

    console.log("[linear-agent] OAuth token refreshed successfully");
    return data.access_token;
  } catch (err) {
    console.error("[linear-agent] Token refresh error:", err);
    return null;
  }
}

/** Exchange an authorization code for tokens (used during OAuth callback). */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const settings = getSettings();
  const { linearOAuthClientId, linearOAuthClientSecret } = settings;

  if (!linearOAuthClientId || !linearOAuthClientSecret) {
    return null;
  }

  try {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: linearOAuthClientId,
        client_secret: linearOAuthClientSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[linear-agent] Token exchange failed:", response.status, text);
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  } catch (err) {
    console.error("[linear-agent] Token exchange error:", err);
    return null;
  }
}

// ─── Webhook verification ───────────────────────────────────────────────────

/** Verify a Linear webhook signature using HMAC-SHA256. */
export function verifyWebhookSignature(body: string, signature: string | null): boolean {
  const settings = getSettings();
  const secret = settings.linearOAuthWebhookSecret;

  if (!secret || !signature) return false;

  // Validate signature is a valid 64-char hex string (SHA-256 output)
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;

  const computed = createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
}

// ─── Agent Activities ───────────────────────────────────────────────────────

/** Post an agent activity to a Linear agent session. */
export async function postActivity(
  agentSessionId: string,
  content: AgentActivityContent,
): Promise<void> {
  const result = await linearGraphQL<{ agentActivityCreate?: { success: boolean } }>(
    `mutation CompanionAgentActivity($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) { success }
    }`,
    { input: { agentSessionId, content } },
  );

  if (result.errors?.length) {
    console.error("[linear-agent] Activity creation failed:", result.errors[0].message);
  }
}

/** Update the external URLs on an agent session (links back to Companion). */
export async function updateSessionUrls(
  agentSessionId: string,
  urls: Array<{ label: string; url: string }>,
): Promise<void> {
  const result = await linearGraphQL<{ agentSessionUpdate?: { success: boolean } }>(
    `mutation CompanionAgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
      agentSessionUpdate(id: $id, input: $input) { success }
    }`,
    { id: agentSessionId, input: { externalUrls: urls } },
  );

  if (result.errors?.length) {
    console.error("[linear-agent] Session URL update failed:", result.errors[0].message);
  }
}

/** Update the plan (checklist) on an agent session. */
export async function updateSessionPlan(
  agentSessionId: string,
  plan: AgentPlanItem[],
): Promise<void> {
  const result = await linearGraphQL<{ agentSessionUpdate?: { success: boolean } }>(
    `mutation CompanionAgentPlanUpdate($id: String!, $input: AgentSessionUpdateInput!) {
      agentSessionUpdate(id: $id, input: $input) { success }
    }`,
    { id: agentSessionId, input: { plan } },
  );

  if (result.errors?.length) {
    console.error("[linear-agent] Session plan update failed:", result.errors[0].message);
  }
}

/** Check if Linear OAuth is fully configured (has client credentials + access token). */
export function isLinearOAuthConfigured(): boolean {
  const s = getSettings();
  return !!(s.linearOAuthClientId.trim() && s.linearOAuthClientSecret.trim() && s.linearOAuthAccessToken.trim());
}

/** Get the OAuth authorization URL for installing the app with actor=app. */
export function getOAuthAuthorizeUrl(redirectUri: string): { url: string; state: string } | null {
  const settings = getSettings();
  if (!settings.linearOAuthClientId) return null;

  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: settings.linearOAuthClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write,issues:create,comments:create,app:mentionable",
    actor: "app",
    state,
  });

  return { url: `https://linear.app/oauth/authorize?${params.toString()}`, state };
}
