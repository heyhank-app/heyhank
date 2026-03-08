// Tests for the Linear Agent SDK webhook and OAuth routes.
// Covers webhook signature verification, event dispatch, OAuth callback,
// authorization URL generation, status endpoint, and disconnect flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock linear-agent module
vi.mock("../linear-agent.js", () => ({
  verifyWebhookSignature: vi.fn(),
  isLinearOAuthConfigured: vi.fn(),
  getOAuthAuthorizeUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  validateOAuthState: vi.fn(),
}));

// Mock settings-manager
vi.mock("../settings-manager.js", () => ({
  getSettings: vi.fn().mockReturnValue({
    publicUrl: "https://companion.example.com",
    linearOAuthClientId: "client-id",
    linearOAuthClientSecret: "client-secret",
    linearOAuthWebhookSecret: "webhook-secret",
    linearOAuthAccessToken: "access-token",
  }),
  updateSettings: vi.fn(),
}));

import * as linearAgent from "../linear-agent.js";
import * as settingsManager from "../settings-manager.js";
import {
  registerLinearAgentWebhookRoute,
  registerLinearAgentProtectedRoutes,
} from "./linear-agent-routes.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function createMockBridge() {
  return {
    handleEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("../linear-agent-bridge.js").LinearAgentBridge;
}

function createApp() {
  const app = new Hono();
  const bridge = createMockBridge();
  registerLinearAgentWebhookRoute(app, bridge);
  registerLinearAgentProtectedRoutes(app);
  return { app, bridge };
}

const validPayload = {
  type: "AgentSessionEvent",
  action: "created",
  data: {
    id: "session-123",
    promptContext: "Fix the bug",
  },
};

// ─── Webhook endpoint tests ─────────────────────────────────────────────────

describe("POST /linear/agent-webhook", () => {
  let app: Hono;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, bridge } = createApp());
  });

  it("returns 401 when webhook signature is invalid", async () => {
    vi.mocked(linearAgent.verifyWebhookSignature).mockReturnValue(false);

    const res = await app.request("/linear/agent-webhook", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json", "linear-signature": "bad-sig" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(linearAgent.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.request("/linear/agent-webhook", {
      method: "POST",
      body: "not-json{{",
      headers: { "Content-Type": "text/plain", "linear-signature": "valid-sig" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("dispatches AgentSessionEvent to bridge and returns 200", async () => {
    vi.mocked(linearAgent.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.request("/linear/agent-webhook", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json", "linear-signature": "valid-sig" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Wait a tick for the async dispatch
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.handleEvent).toHaveBeenCalledWith(validPayload);
  });

  it("ignores non-AgentSessionEvent types", async () => {
    vi.mocked(linearAgent.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.request("/linear/agent-webhook", {
      method: "POST",
      body: JSON.stringify({ type: "Issue", action: "created", data: {} }),
      headers: { "Content-Type": "application/json", "linear-signature": "valid-sig" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBe(true);
    expect(bridge.handleEvent).not.toHaveBeenCalled();
  });

  it("accepts x-linear-signature header as fallback", async () => {
    vi.mocked(linearAgent.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.request("/linear/agent-webhook", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json", "x-linear-signature": "valid-sig" },
    });

    expect(res.status).toBe(200);
    expect(linearAgent.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(String),
      "valid-sig",
    );
  });
});

// ─── OAuth callback tests ───────────────────────────────────────────────────

describe("GET /linear/oauth/callback", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app } = createApp());
  });

  it("redirects with error when error parameter is present", async () => {
    const res = await app.request("/linear/oauth/callback?error=access_denied");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_error=access_denied");
  });

  it("redirects with error when no code parameter", async () => {
    const res = await app.request("/linear/oauth/callback");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_error=no_code");
  });

  it("redirects with error when state is missing (CSRF protection)", async () => {
    const res = await app.request("/linear/oauth/callback?code=auth-code-123");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_error=invalid_state");
  });

  it("redirects with error when state is invalid (CSRF protection)", async () => {
    vi.mocked(linearAgent.validateOAuthState).mockReturnValue(false);

    const res = await app.request("/linear/oauth/callback?code=auth-code-123&state=bad-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_error=invalid_state");
  });

  it("exchanges code for tokens and redirects on success", async () => {
    vi.mocked(linearAgent.validateOAuthState).mockReturnValue(true);
    vi.mocked(linearAgent.exchangeCodeForTokens).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });

    const res = await app.request("/linear/oauth/callback?code=auth-code-123&state=valid-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_success=true");

    // Should persist tokens
    expect(settingsManager.updateSettings).toHaveBeenCalledWith({
      linearOAuthAccessToken: "new-access",
      linearOAuthRefreshToken: "new-refresh",
    });
  });

  it("redirects with error when token exchange fails", async () => {
    vi.mocked(linearAgent.validateOAuthState).mockReturnValue(true);
    vi.mocked(linearAgent.exchangeCodeForTokens).mockResolvedValue(null);

    const res = await app.request("/linear/oauth/callback?code=bad-code&state=valid-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("oauth_error=token_exchange_failed");
  });
});

// ─── OAuth authorize URL endpoint ───────────────────────────────────────────

describe("GET /linear/oauth/authorize-url", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app } = createApp());
  });

  it("returns authorization URL when configured", async () => {
    vi.mocked(linearAgent.getOAuthAuthorizeUrl).mockReturnValue({
      url: "https://linear.app/oauth/authorize?client_id=test&state=abc123",
      state: "abc123",
    });

    const res = await app.request("/linear/oauth/authorize-url");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("linear.app/oauth/authorize");
  });

  it("returns 400 when OAuth client ID is not configured", async () => {
    vi.mocked(linearAgent.getOAuthAuthorizeUrl).mockReturnValue(null);

    const res = await app.request("/linear/oauth/authorize-url");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not configured");
  });
});

// ─── OAuth status endpoint ──────────────────────────────────────────────────

describe("GET /linear/oauth/status", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app } = createApp());
  });

  it("returns OAuth configuration status", async () => {
    vi.mocked(linearAgent.isLinearOAuthConfigured).mockReturnValue(true);

    const res = await app.request("/linear/oauth/status");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.hasClientId).toBe(true);
    expect(body.hasClientSecret).toBe(true);
    expect(body.hasWebhookSecret).toBe(true);
    expect(body.hasAccessToken).toBe(true);
  });
});

// ─── OAuth disconnect endpoint ──────────────────────────────────────────────

describe("POST /linear/oauth/disconnect", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app } = createApp());
  });

  it("clears OAuth tokens and returns success", async () => {
    const res = await app.request("/linear/oauth/disconnect", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(settingsManager.updateSettings).toHaveBeenCalledWith({
      linearOAuthAccessToken: "",
      linearOAuthRefreshToken: "",
    });
  });
});
