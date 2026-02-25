import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock usage-limits ─────────────────────────────────────────────────────
vi.mock("../usage-limits.js", () => ({
  getUsageLimits: vi.fn(async () => ({
    five_hour: null,
    seven_day: null,
    extra_usage: null,
  })),
}));

// ─── Mock update-checker ───────────────────────────────────────────────────
vi.mock("../update-checker.js", () => ({
  getUpdateState: vi.fn(() => ({
    currentVersion: "1.0.0",
    latestVersion: null,
    lastChecked: 0,
    isServiceMode: false,
    checking: false,
    updateInProgress: false,
  })),
  checkForUpdate: vi.fn(async () => {}),
  isUpdateAvailable: vi.fn(() => false),
  setUpdateInProgress: vi.fn(),
}));

// ─── Mock service ──────────────────────────────────────────────────────────
vi.mock("../service.js", () => ({
  refreshServiceDefinition: vi.fn(),
}));

import { Hono } from "hono";
import { getUsageLimits } from "../usage-limits.js";
import {
  getUpdateState,
  checkForUpdate,
  isUpdateAvailable,
  setUpdateInProgress,
} from "../update-checker.js";
import { registerSystemRoutes } from "./system-routes.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a mock CliLauncher with vi.fn() stubs for the methods used by system routes. */
function createMockLauncher() {
  return {
    getSession: vi.fn(() => undefined as any),
    isAlive: vi.fn(() => false),
  };
}

/** Build a mock WsBridge with vi.fn() stubs for the methods used by system routes. */
function createMockWsBridge() {
  return {
    getSession: vi.fn(() => undefined as any),
    getCodexRateLimits: vi.fn(() => null),
    injectUserMessage: vi.fn(),
  };
}

/** Build a mock TerminalManager with vi.fn() stubs for the methods used by system routes. */
function createMockTerminalManager() {
  return {
    getInfo: vi.fn(() => null as { id: string; cwd: string } | null),
    spawn: vi.fn(() => "terminal-123"),
    kill: vi.fn(),
  };
}

// ─── Test setup ────────────────────────────────────────────────────────────

let app: Hono;
let launcher: ReturnType<typeof createMockLauncher>;
let wsBridge: ReturnType<typeof createMockWsBridge>;
let terminalManager: ReturnType<typeof createMockTerminalManager>;

beforeEach(() => {
  vi.clearAllMocks();

  launcher = createMockLauncher();
  wsBridge = createMockWsBridge();
  terminalManager = createMockTerminalManager();

  app = new Hono();
  const api = new Hono();
  registerSystemRoutes(api, {
    launcher: launcher as any,
    wsBridge: wsBridge as any,
    terminalManager: terminalManager as any,
    updateCheckStaleMs: 60_000,
  });
  app.route("/api", api);
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/usage-limits
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/usage-limits", () => {
  it("returns usage limits from the global getter", async () => {
    const limits = {
      five_hour: { utilization: 0.5, resets_at: "2026-01-01T00:00:00Z" },
      seven_day: null,
      extra_usage: null,
    };
    vi.mocked(getUsageLimits).mockResolvedValue(limits as any);

    const res = await app.request("/api/usage-limits");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.five_hour.utilization).toBe(0.5);
    expect(json.seven_day).toBeNull();
    expect(getUsageLimits).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sessions/:id/usage-limits
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/sessions/:id/usage-limits", () => {
  it("returns codex rate limits when the session is a codex backend", async () => {
    // When the session's backendType is "codex", we should return mapped codex limits
    wsBridge.getSession.mockReturnValue({ backendType: "codex" } as any);
    wsBridge.getCodexRateLimits.mockReturnValue({
      primary: { usedPercent: 0.42, windowDurationMins: 300, resetsAt: 1700000000 },
      secondary: null,
    } as any);

    const res = await app.request("/api/sessions/codex-sess-1/usage-limits");

    expect(res.status).toBe(200);
    const json = await res.json();
    // Primary limit should be mapped to five_hour
    expect(json.five_hour).not.toBeNull();
    expect(json.five_hour.utilization).toBe(0.42);
    // Secondary was null, so seven_day should be null
    expect(json.seven_day).toBeNull();
    expect(json.extra_usage).toBeNull();
    // Should NOT have called getUsageLimits (we used codex-specific path)
    expect(getUsageLimits).not.toHaveBeenCalled();
  });

  it("returns empty limits when codex session has no rate limit data", async () => {
    wsBridge.getSession.mockReturnValue({ backendType: "codex" } as any);
    wsBridge.getCodexRateLimits.mockReturnValue(null);

    const res = await app.request("/api/sessions/codex-sess-2/usage-limits");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ five_hour: null, seven_day: null, extra_usage: null });
  });

  it("falls back to global usage limits for non-codex sessions", async () => {
    // A claude-type session should use the global getUsageLimits
    wsBridge.getSession.mockReturnValue({ backendType: "claude" } as any);
    vi.mocked(getUsageLimits).mockResolvedValue({
      five_hour: { utilization: 0.1, resets_at: null },
      seven_day: null,
      extra_usage: null,
    } as any);

    const res = await app.request("/api/sessions/claude-sess-1/usage-limits");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.five_hour.utilization).toBe(0.1);
    expect(getUsageLimits).toHaveBeenCalled();
  });

  it("falls back to global usage limits when session is not found", async () => {
    // When wsBridge.getSession returns undefined, should still return global limits
    wsBridge.getSession.mockReturnValue(undefined);
    vi.mocked(getUsageLimits).mockResolvedValue({
      five_hour: null,
      seven_day: null,
      extra_usage: null,
    } as any);

    const res = await app.request("/api/sessions/unknown/usage-limits");

    expect(res.status).toBe(200);
    expect(getUsageLimits).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/update-check
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/update-check", () => {
  it("calls checkForUpdate when lastChecked is 0 (stale)", async () => {
    // lastChecked=0 means never checked, so it should trigger a refresh
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: null,
      lastChecked: 0,
      isServiceMode: false,
      checking: false,
      updateInProgress: false,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(false);

    const res = await app.request("/api/update-check");

    expect(res.status).toBe(200);
    expect(checkForUpdate).toHaveBeenCalled();
    const json = await res.json();
    expect(json.currentVersion).toBe("1.0.0");
    expect(json.updateAvailable).toBe(false);
  });

  it("does NOT call checkForUpdate when lastChecked is recent (not stale)", async () => {
    // Set lastChecked to "now" so it is within the 60s stale window
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      lastChecked: Date.now(),
      isServiceMode: false,
      checking: false,
      updateInProgress: false,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(false);

    const res = await app.request("/api/update-check");

    expect(res.status).toBe(200);
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/update-check
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/update-check", () => {
  it("always calls checkForUpdate regardless of staleness", async () => {
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      lastChecked: Date.now(),
      isServiceMode: true,
      checking: false,
      updateInProgress: false,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(true);

    const res = await app.request("/api/update-check", { method: "POST" });

    expect(res.status).toBe(200);
    expect(checkForUpdate).toHaveBeenCalled();
    const json = await res.json();
    expect(json.updateAvailable).toBe(true);
    expect(json.isServiceMode).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/update
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/update", () => {
  it("returns 400 when not running in service mode", async () => {
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      lastChecked: Date.now(),
      isServiceMode: false,
      checking: false,
      updateInProgress: false,
    });

    const res = await app.request("/api/update", { method: "POST" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/service mode/i);
  });

  it("returns 400 when no update is available", async () => {
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      lastChecked: Date.now(),
      isServiceMode: true,
      checking: false,
      updateInProgress: false,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(false);

    const res = await app.request("/api/update", { method: "POST" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no update/i);
  });

  it("returns 409 when an update is already in progress", async () => {
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      lastChecked: Date.now(),
      isServiceMode: true,
      checking: false,
      updateInProgress: true,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(true);

    const res = await app.request("/api/update", { method: "POST" });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already in progress/i);
  });

  it("starts the update when all preconditions are met", async () => {
    vi.mocked(getUpdateState).mockReturnValue({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      lastChecked: Date.now(),
      isServiceMode: true,
      checking: false,
      updateInProgress: false,
    });
    vi.mocked(isUpdateAvailable).mockReturnValue(true);

    const res = await app.request("/api/update", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/restart/i);
    expect(setUpdateInProgress).toHaveBeenCalledWith(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/terminal
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/terminal", () => {
  it("returns active: false when no terminal is running", async () => {
    terminalManager.getInfo.mockReturnValue(null);

    const res = await app.request("/api/terminal");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.active).toBe(false);
  });

  it("returns terminal info when a terminal is running", async () => {
    terminalManager.getInfo.mockReturnValue({ id: "t-42", cwd: "/home/user" });

    const res = await app.request("/api/terminal");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.active).toBe(true);
    expect(json.terminalId).toBe("t-42");
    expect(json.cwd).toBe("/home/user");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/terminal/spawn
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/terminal/spawn", () => {
  it("spawns a terminal and returns its id", async () => {
    terminalManager.spawn.mockReturnValue("new-terminal-id");

    const res = await app.request("/api/terminal/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/workspace" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.terminalId).toBe("new-terminal-id");
    expect(terminalManager.spawn).toHaveBeenCalledWith(
      "/workspace",
      undefined,
      undefined,
      expect.objectContaining({}),
    );
  });

  it("returns 400 when cwd is missing", async () => {
    const res = await app.request("/api/terminal/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cwd/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/terminal/kill
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/terminal/kill", () => {
  it("kills the specified terminal", async () => {
    const res = await app.request("/api/terminal/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId: "t-42" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(terminalManager.kill).toHaveBeenCalledWith("t-42");
  });

  it("returns 400 when terminalId is missing", async () => {
    const res = await app.request("/api/terminal/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/terminalId/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sessions/:id/message
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/sessions/:id/message", () => {
  it("injects a user message into a running session", async () => {
    launcher.getSession.mockReturnValue({ id: "sess-1" } as any);
    launcher.isAlive.mockReturnValue(true);

    const res = await app.request("/api/sessions/sess-1/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello world" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sessionId).toBe("sess-1");
    expect(wsBridge.injectUserMessage).toHaveBeenCalledWith("sess-1", "hello world");
  });

  it("returns 404 when the session does not exist", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/missing/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when the session is not running", async () => {
    launcher.getSession.mockReturnValue({ id: "sess-1" } as any);
    launcher.isAlive.mockReturnValue(false);

    const res = await app.request("/api/sessions/sess-1/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not running/i);
  });

  it("returns 400 when content is missing or empty", async () => {
    launcher.getSession.mockReturnValue({ id: "sess-1" } as any);
    launcher.isAlive.mockReturnValue(true);

    // Empty content field
    const res1 = await app.request("/api/sessions/sess-1/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toMatch(/content/i);

    // Missing content field entirely
    const res2 = await app.request("/api/sessions/sess-1/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.error).toMatch(/content/i);
  });
});
