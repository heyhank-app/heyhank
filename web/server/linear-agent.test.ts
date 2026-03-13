// Tests for the Linear Agent Interaction SDK client module.
// Covers webhook verification, OAuth token management, GraphQL calls,
// activity posting, and configuration checks.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// Mock settings-manager — must be before importing the module under test
vi.mock("./settings-manager.js", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import * as settingsManager from "./settings-manager.js";
import type { CompanionSettings } from "./settings-manager.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Default settings for tests
function makeSettings(overrides: Partial<CompanionSettings> = {}): CompanionSettings {
  return {
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
    linearApiKey: "",
    linearAutoTransition: false,
    linearAutoTransitionStateId: "",
    linearAutoTransitionStateName: "",
    linearArchiveTransition: false,
    linearArchiveTransitionStateId: "",
    linearArchiveTransitionStateName: "",
    linearOAuthClientId: "client-id",
    linearOAuthClientSecret: "client-secret",
    linearOAuthWebhookSecret: "webhook-secret",
    linearOAuthAccessToken: "access-token",
    linearOAuthRefreshToken: "refresh-token",
    editorTabEnabled: false,
    aiValidationEnabled: false,
    aiValidationAutoApprove: true,
    aiValidationAutoDeny: false,
    publicUrl: "",
    updateChannel: "stable",
    dockerAutoUpdate: false,
    updatedAt: 0,
    ...overrides,
  };
}

// Import module under test — must come after mocks
let linearAgent: typeof import("./linear-agent.js");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // Re-import to reset module state
  linearAgent = await import("./linear-agent.js");
  // Re-mock since resetModules clears mocks
  const sm = await import("./settings-manager.js");
  vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
});

// ─── Webhook signature verification ──────────────────────────────────────────

describe("verifyWebhookSignature", () => {
  it("returns true for valid HMAC-SHA256 signature", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthWebhookSecret: "test-secret" }));

    const body = '{"type":"AgentSessionEvent"}';
    const signature = createHmac("sha256", "test-secret").update(body).digest("hex");

    expect(linearAgent.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthWebhookSecret: "test-secret" }));

    expect(linearAgent.verifyWebhookSignature("body", "bad-signature")).toBe(false);
  });

  it("returns false when webhook secret is not configured", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthWebhookSecret: "" }));

    expect(linearAgent.verifyWebhookSignature("body", "some-sig")).toBe(false);
  });

  it("returns false when signature is null", async () => {
    expect(linearAgent.verifyWebhookSignature("body", null)).toBe(false);
  });

  it("returns false for malformed hex signature (timing-safe compare failure)", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthWebhookSecret: "test-secret" }));

    // Non-hex string will cause Buffer.from to produce different length
    expect(linearAgent.verifyWebhookSignature("body", "not-valid-hex!!")).toBe(false);
  });
});

// ─── OAuth configuration checks ─────────────────────────────────────────────

describe("isLinearOAuthConfigured", () => {
  it("returns true when all required fields are present", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());

    expect(linearAgent.isLinearOAuthConfigured()).toBe(true);
  });

  it("returns false when client ID is missing", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthClientId: "" }));

    expect(linearAgent.isLinearOAuthConfigured()).toBe(false);
  });

  it("returns false when access token is missing", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthAccessToken: "" }));

    expect(linearAgent.isLinearOAuthConfigured()).toBe(false);
  });
});

describe("getOAuthAuthorizeUrl", () => {
  it("returns authorization URL and state nonce with correct parameters", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthClientId: "my-client-id" }));

    const result = linearAgent.getOAuthAuthorizeUrl("http://localhost:3456/api/linear/oauth/callback");
    expect(result).not.toBeNull();
    expect(result!.url).toContain("linear.app/oauth/authorize");
    expect(result!.url).toContain("client_id=my-client-id");
    expect(result!.url).toContain("response_type=code");
    expect(result!.url).toContain("actor=app");
    expect(result!.url).toContain("app%3Amentionable");
    expect(result!.url).toContain("state=");
    expect(result!.state).toBeTruthy();
  });

  it("returns null when client ID is not configured", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthClientId: "" }));

    expect(linearAgent.getOAuthAuthorizeUrl("http://localhost/callback")).toBeNull();
  });
});

// ─── OAuth state CSRF protection ─────────────────────────────────────────────

describe("OAuth state nonce (CSRF protection)", () => {
  it("generates unique state nonces", () => {
    const state1 = linearAgent.generateOAuthState();
    const state2 = linearAgent.generateOAuthState();
    expect(state1).not.toBe(state2);
    expect(state1.length).toBe(48); // 24 bytes → 48 hex chars
  });

  it("validates a generated state nonce (single use)", () => {
    const state = linearAgent.generateOAuthState();
    expect(linearAgent.validateOAuthState(state)).toBe(true);
    // Second use should fail — consumed
    expect(linearAgent.validateOAuthState(state)).toBe(false);
  });

  it("rejects unknown state nonces", () => {
    expect(linearAgent.validateOAuthState("unknown-nonce")).toBe(false);
  });

  it("rejects null/undefined state", () => {
    expect(linearAgent.validateOAuthState(null)).toBe(false);
    expect(linearAgent.validateOAuthState(undefined)).toBe(false);
  });
});

// ─── Token exchange ─────────────────────────────────────────────────────────

describe("exchangeCodeForTokens", () => {
  it("exchanges authorization code for tokens", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 86400,
        scope: "read,write",
      }),
    });

    const result = await linearAgent.exchangeCodeForTokens("auth-code", "http://localhost/callback");

    expect(result).toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(mockFetch).toHaveBeenCalledWith("https://api.linear.app/oauth/token", expect.objectContaining({
      method: "POST",
    }));
  });

  it("returns null when client credentials are missing", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthClientId: "" }));

    const result = await linearAgent.exchangeCodeForTokens("code", "http://localhost/callback");
    expect(result).toBeNull();
  });

  it("returns null when token exchange fails", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    });

    const result = await linearAgent.exchangeCodeForTokens("bad-code", "http://localhost/callback");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await linearAgent.exchangeCodeForTokens("code", "http://localhost/callback");
    expect(result).toBeNull();
  });
});

// ─── Token refresh ──────────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  it("refreshes token and persists new credentials", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: "refreshed-access",
        refresh_token: "refreshed-refresh",
        expires_in: 86400,
      }),
    });

    const result = await linearAgent.refreshAccessToken();

    expect(result).toBe("refreshed-access");
    expect(sm.updateSettings).toHaveBeenCalledWith({
      linearOAuthAccessToken: "refreshed-access",
      linearOAuthRefreshToken: "refreshed-refresh",
    });
  });

  it("returns null when refresh credentials are missing", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthRefreshToken: "" }));

    const result = await linearAgent.refreshAccessToken();
    expect(result).toBeNull();
  });

  it("returns null when refresh request fails", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await linearAgent.refreshAccessToken();
    expect(result).toBeNull();
  });

  it("keeps old refresh token if new one is not provided", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthRefreshToken: "old-refresh" }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: "new-access",
        // No refresh_token in response
        expires_in: 86400,
      }),
    });

    await linearAgent.refreshAccessToken();

    expect(sm.updateSettings).toHaveBeenCalledWith({
      linearOAuthAccessToken: "new-access",
      linearOAuthRefreshToken: "old-refresh",
    });
  });
});

// ─── GraphQL helper ─────────────────────────────────────────────────────────

describe("linearGraphQL", () => {
  it("sends authenticated GraphQL request and returns data", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { viewer: { id: "user-1" } } }),
    });

    const result = await linearAgent.linearGraphQL("{ viewer { id } }");

    expect(result).toEqual({ data: { viewer: { id: "user-1" } } });
    expect(mockFetch).toHaveBeenCalledWith("https://api.linear.app/graphql", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer access-token",
      }),
    }));
  });

  it("throws when no access token is configured", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings({ linearOAuthAccessToken: "" }));

    await expect(linearAgent.linearGraphQL("{ viewer { id } }")).rejects.toThrow(
      "Linear OAuth not configured"
    );
  });

  it("throws on non-OK response without 401", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(linearAgent.linearGraphQL("{ viewer { id } }")).rejects.toThrow(
      "Linear API error 500"
    );
  });

  it("auto-refreshes token on 401 and retries", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());

    // First call: 401
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Token refresh call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: "new-token",
        refresh_token: "new-refresh",
        expires_in: 86400,
      }),
    });
    // Retry with new token: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { viewer: { id: "user-1" } } }),
    });

    const result = await linearAgent.linearGraphQL("{ viewer { id } }");

    expect(result).toEqual({ data: { viewer: { id: "user-1" } } });
    // Should have made 3 fetch calls: initial GraphQL, token refresh, retry GraphQL
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ─── Activity posting ───────────────────────────────────────────────────────

describe("postActivity", () => {
  it("sends agentActivityCreate mutation with correct input", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { agentActivityCreate: { success: true } } }),
    });

    await linearAgent.postActivity("session-123", { type: "thought", body: "Thinking...", ephemeral: true });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.variables.input).toEqual({
      agentSessionId: "session-123",
      content: { type: "thought", body: "Thinking...", ephemeral: true },
    });
  });

  it("logs error when activity creation returns errors", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ errors: [{ message: "Session not found" }] }),
    });

    await linearAgent.postActivity("bad-session", { type: "response", body: "Done" });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[linear-agent] Activity creation failed:",
      "Session not found"
    );
    consoleSpy.mockRestore();
  });
});

// ─── Session updates ────────────────────────────────────────────────────────

describe("updateSessionUrls", () => {
  it("sends agentSessionUpdate mutation with external URLs", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { agentSessionUpdate: { success: true } } }),
    });

    await linearAgent.updateSessionUrls("session-123", [
      { label: "Companion", url: "http://localhost:3456/#/session/abc" },
    ]);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.variables.input.externalUrls).toEqual([
      { label: "Companion", url: "http://localhost:3456/#/session/abc" },
    ]);
  });
});

describe("updateSessionPlan", () => {
  it("sends agentSessionUpdate mutation with plan items", async () => {
    const sm = await import("./settings-manager.js");
    vi.mocked(sm.getSettings).mockReturnValue(makeSettings());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { agentSessionUpdate: { success: true } } }),
    });

    const plan = [
      { content: "Analyze issue", status: "completed" as const },
      { content: "Fix bug", status: "inProgress" as const },
    ];
    await linearAgent.updateSessionPlan("session-123", plan);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.variables.input.plan).toEqual(plan);
  });
});
