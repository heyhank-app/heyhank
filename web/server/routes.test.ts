import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock auth-manager so all test requests pass the auth middleware
vi.mock("./auth-manager.js", () => ({
  verifyToken: vi.fn(() => true),
  getToken: vi.fn(() => "test-token-for-routes"),
  getLanAddress: vi.fn(() => "192.168.1.100"),
  _resetForTest: vi.fn(),
}));

// Mock env-manager and git-utils modules before any imports
vi.mock("./env-manager.js", () => ({
  listEnvs: vi.fn(() => []),
  getEnv: vi.fn(() => null),
  createEnv: vi.fn(),
  updateEnv: vi.fn(),
  deleteEnv: vi.fn(),
}));

// Mock sandbox-manager — sandboxes now own Docker/container config (separated from envs)
vi.mock("./sandbox-manager.js", () => ({
  listSandboxes: vi.fn(() => []),
  getSandbox: vi.fn(() => null),
  createSandbox: vi.fn(),
  updateSandbox: vi.fn(),
  deleteSandbox: vi.fn(() => false),
}));

vi.mock("./prompt-manager.js", () => ({
  listPrompts: vi.fn(() => []),
  getPrompt: vi.fn(() => null),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(() => false),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  execFileSync: vi.fn(() => ""),
}));

const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string) => null as string | null));
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
  };
});

vi.mock("./git-utils.js", () => ({
  getRepoInfo: vi.fn(() => null),
  listBranches: vi.fn(() => []),
  listWorktrees: vi.fn(() => []),
  ensureWorktree: vi.fn(),
  gitFetch: vi.fn(() => ({ success: true, output: "" })),
  gitPull: vi.fn(() => ({ success: true, output: "" })),
  checkoutBranch: vi.fn(),
  checkoutOrCreateBranch: vi.fn(() => ({ created: false })),
  removeWorktree: vi.fn(),
  isWorktreeDirty: vi.fn(() => false),
}));

vi.mock("./session-names.js", () => ({
  getName: vi.fn(() => undefined),
  setName: vi.fn(),
  getAllNames: vi.fn(() => ({})),
  removeName: vi.fn(),
  _resetForTest: vi.fn(),
}));

vi.mock("./settings-manager.js", () => ({
  DEFAULT_ANTHROPIC_MODEL: "claude-sonnet-4-6",
  getSettings: vi.fn(() => ({
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
    claudeCodeOAuthToken: "",
    openaiApiKey: "",
    onboardingCompleted: false,
    editorTabEnabled: false,
    aiValidationEnabled: false,
    aiValidationAutoApprove: true,
    aiValidationAutoDeny: false,
    publicUrl: "",
    updateChannel: "stable",
    dockerAutoUpdate: false,
    updatedAt: 0,
    geminiApiKey: "",
    geminiVoice: "Puck",
    assistantName: "Maxx",
    userName: "",
    internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
  })),
  updateSettings: vi.fn((patch) => ({
    anthropicApiKey: patch.anthropicApiKey ?? "",
    anthropicModel: patch.anthropicModel ?? "claude-sonnet-4-6",
    claudeCodeOAuthToken: patch.claudeCodeOAuthToken ?? "",
    openaiApiKey: patch.openaiApiKey ?? "",
    onboardingCompleted: patch.onboardingCompleted ?? false,
    editorTabEnabled: patch.editorTabEnabled ?? false,
    aiValidationEnabled: patch.aiValidationEnabled ?? false,
    aiValidationAutoApprove: patch.aiValidationAutoApprove ?? true,
    aiValidationAutoDeny: patch.aiValidationAutoDeny ?? false,
    publicUrl: patch.publicUrl ?? "",
    updateChannel: patch.updateChannel ?? "stable",
    dockerAutoUpdate: patch.dockerAutoUpdate ?? false,
    updatedAt: Date.now(),
    geminiApiKey: patch.geminiApiKey ?? "",
    geminiVoice: patch.geminiVoice ?? "Puck",
    assistantName: patch.assistantName ?? "Maxx",
    userName: patch.userName ?? "",
    internalAiProvider: patch.internalAiProvider ?? "",
    hankChatProvider: patch.hankChatProvider ?? "gemini-live",
    hankChatModel: patch.hankChatModel ?? "",
    mem0ApiKey: patch.mem0ApiKey ?? "",
    mem0UserId: patch.mem0UserId ?? "",
    memoryAutoDetect: patch.memoryAutoDetect ?? true,
  })),
}));


vi.mock("./codex-container-auth.js", () => ({
  hasContainerCodexAuth: vi.fn(() => false),
}));

// Mock cost-tracker to avoid bun:sqlite import (not available in vitest)
vi.mock("./cost-tracker.js", () => ({
  getCostTracker: vi.fn(() => ({
    record: vi.fn(),
    getSessionCost: vi.fn(() => 0),
    getTotalCost: vi.fn(() => 0),
    getRecentSessions: vi.fn(() => []),
  })),
}));

const mockDiscoverClaudeSessions = vi.hoisted(() => vi.fn(
  (_options?: { limit?: number }) =>
    [] as Array<{
      sessionId: string;
      cwd: string;
      gitBranch?: string;
      slug?: string;
      lastActivityAt: number;
      sourceFile: string;
    }>
));
vi.mock("./claude-session-discovery.js", () => ({
  discoverClaudeSessions: mockDiscoverClaudeSessions,
}));

const mockGetClaudeSessionHistoryPage = vi.hoisted(() => vi.fn(
  (_options?: { sessionId: string; limit?: number; cursor?: number }) =>
    null as {
      sourceFile: string;
      nextCursor: number;
      hasMore: boolean;
      totalMessages: number;
      messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }>;
    } | null
));
vi.mock("./claude-session-history.js", () => ({
  getClaudeSessionHistoryPage: mockGetClaudeSessionHistoryPage,
}));

const mockGetUsageLimits = vi.hoisted(() => vi.fn());
const mockUpdateCheckerState = vi.hoisted(() => ({
  currentVersion: "0.22.1",
  latestVersion: null as string | null,
  lastChecked: 0,
  isServiceMode: false,
  checking: false,
  updateInProgress: false,
}));
const mockCheckForUpdate = vi.hoisted(() => vi.fn(async () => {}));
const mockIsUpdateAvailable = vi.hoisted(() => vi.fn(() => false));
const mockSetUpdateInProgress = vi.hoisted(() => vi.fn());

vi.mock("./usage-limits.js", () => ({
  getUsageLimits: mockGetUsageLimits,
}));

vi.mock("./update-checker.js", () => ({
  getUpdateState: vi.fn(() => ({ ...mockUpdateCheckerState })),
  checkForUpdate: mockCheckForUpdate,
  isUpdateAvailable: mockIsUpdateAvailable,
  setUpdateInProgress: mockSetUpdateInProgress,
}));

// Mock image-pull-manager — default: images are always ready
const mockImagePullIsReady = vi.hoisted(() => vi.fn(() => true));
interface MockImagePullState {
  image: string;
  status: "idle" | "pulling" | "ready" | "error";
  progress: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}
const mockImagePullGetState = vi.hoisted(() => vi.fn(
  (image: string): MockImagePullState => ({
    image,
    status: "ready",
    progress: [],
  })
));
const mockImagePullEnsureImage = vi.hoisted(() => vi.fn());
const mockImagePullWaitForReady = vi.hoisted(() => vi.fn(async () => true));
const mockImagePullPull = vi.hoisted(() => vi.fn());
const mockImagePullOnProgress = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock("./image-pull-manager.js", () => ({
  imagePullManager: {
    isReady: mockImagePullIsReady,
    getState: mockImagePullGetState,
    ensureImage: mockImagePullEnsureImage,
    waitForReady: mockImagePullWaitForReady,
    pull: mockImagePullPull,
    onProgress: mockImagePullOnProgress,
  },
}));

import { Hono } from "hono";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRoutes } from "./routes.js";
import * as envManager from "./env-manager.js";
import * as sandboxManager from "./sandbox-manager.js";
import * as promptManager from "./prompt-manager.js";
import * as gitUtils from "./git-utils.js";
import * as sessionNames from "./session-names.js";
import * as settingsManager from "./settings-manager.js";
import { containerManager } from "./container-manager.js";

// ─── Mock factories ──────────────────────────────────────────────────────────

function createMockLauncher() {
  return {
    launch: vi.fn(() => ({
      sessionId: "session-1",
      state: "starting",
      cwd: "/test",
      createdAt: Date.now(),
    })),
    kill: vi.fn(async () => true),
    relaunch: vi.fn(async () => ({ ok: true })),
    listSessions: vi.fn(() => []),
    getSession: vi.fn(),
    setArchived: vi.fn(),
    removeSession: vi.fn(),
  } as any;
}

function createMockBridge() {
  return {
    closeSession: vi.fn(),
    getSession: vi.fn(() => null),
    getAllSessions: vi.fn(() => []),
    getCodexRateLimits: vi.fn(() => null),
    markContainerized: vi.fn(),
    prePopulateCommands: vi.fn(),
    broadcastNameUpdate: vi.fn(),
    injectSystemPrompt: vi.fn(),
  } as any;
}

function createMockStore() {
  return {
    setArchived: vi.fn(() => true),
  } as any;
}

function createMockTracker() {
  return {
    addMapping: vi.fn(),
    getBySession: vi.fn(() => null),
    removeBySession: vi.fn(),
    isWorktreeInUse: vi.fn(() => false),
  } as any;
}

function createMockOrchestrator() {
  return {
    createSession: vi.fn(async () => ({
      ok: true,
      session: { sessionId: "session-1", state: "starting", cwd: "/test", createdAt: Date.now() },
    })),
    createSessionStreaming: vi.fn(async () => ({
      ok: true,
      session: { sessionId: "session-1", state: "starting", cwd: "/test", createdAt: Date.now() },
    })),
    killSession: vi.fn(async () => ({ ok: true })),
    relaunchSession: vi.fn(async () => ({ ok: true })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    archiveSession: vi.fn(async () => ({ ok: true })),
    unarchiveSession: vi.fn(() => ({ ok: true })),
    clearAutoRelaunchCount: vi.fn(),
    getSession: vi.fn(),
  } as any;
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let app: Hono;
let orchestrator: ReturnType<typeof createMockOrchestrator>;
let launcher: ReturnType<typeof createMockLauncher>;
let bridge: ReturnType<typeof createMockBridge>;
let sessionStore: ReturnType<typeof createMockStore>;
let tracker: ReturnType<typeof createMockTracker>;
let terminalManager: { getInfo: ReturnType<typeof vi.fn>; spawn: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockDiscoverClaudeSessions.mockReturnValue([]);
  mockGetClaudeSessionHistoryPage.mockReturnValue(null);
  mockUpdateCheckerState.currentVersion = "0.22.1";
  mockUpdateCheckerState.latestVersion = null;
  mockUpdateCheckerState.lastChecked = 0;
  mockUpdateCheckerState.isServiceMode = false;
  mockUpdateCheckerState.checking = false;
  mockUpdateCheckerState.updateInProgress = false;
  orchestrator = createMockOrchestrator();
  launcher = createMockLauncher();
  bridge = createMockBridge();
  sessionStore = createMockStore();
  tracker = createMockTracker();
  terminalManager = { getInfo: vi.fn(() => null), spawn: vi.fn(() => ""), kill: vi.fn() };
  app = new Hono();
  app.route("/api", createRoutes(orchestrator, launcher, bridge, terminalManager as any));

  // Default no-op mocks for container workspace isolation (called during container session creation)
  vi.spyOn(containerManager, "copyWorkspaceToContainer").mockResolvedValue(undefined);
  vi.spyOn(containerManager, "reseedGitAuth").mockImplementation(() => {});

  // Default: images are always ready via pull manager
  mockImagePullIsReady.mockReturnValue(true);
  mockImagePullGetState.mockImplementation((image: string) => ({
    image,
    status: "ready" as const,
    progress: [],
  }));
  mockImagePullWaitForReady.mockResolvedValue(true);
});

describe("POST /api/terminal/kill", () => {
  it("returns 400 when terminalId is missing", async () => {
    const res = await app.request("/api/terminal/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(terminalManager.kill).not.toHaveBeenCalled();
  });

  it("kills only the requested terminal", async () => {
    const res = await app.request("/api/terminal/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId: "term-1" }),
    });

    expect(res.status).toBe(200);
    expect(terminalManager.kill).toHaveBeenCalledWith("term-1");
  });
});

// ─── Sessions ────────────────────────────────────────────────────────────────

describe("POST /api/sessions/create", () => {
  // Route delegates to orchestrator.createSession — detailed orchestration logic
  // (env resolution, git ops, container creation, etc.) is tested in session-orchestrator.test.ts.
  // Route tests verify correct delegation and HTTP response mapping.

  it("delegates to orchestrator and returns session info on success", async () => {
    orchestrator.createSession.mockResolvedValue({
      ok: true,
      session: { sessionId: "session-1", state: "starting", cwd: "/test", createdAt: Date.now() },
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", cwd: "/test" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ sessionId: "session-1", state: "starting", cwd: "/test" });
    expect(orchestrator.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6", cwd: "/test" }),
    );
  });

  it("passes the full request body through to orchestrator", async () => {
    const body = {
      cwd: "/test",
      resumeSessionAt: "  prior-session-123  ",
      forkSession: true,
      backend: "codex",
      branch: "feat",
      useWorktree: true,
      envSlug: "production",
      sandboxEnabled: true,
      sandboxSlug: "my-sandbox",
    };
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(orchestrator.createSession).toHaveBeenCalledWith(body);
  });

  it("returns error status from orchestrator on failure", async () => {
    orchestrator.createSession.mockResolvedValue({
      ok: false,
      error: "Invalid backend: invalid-backend",
      status: 400,
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", backend: "invalid-backend" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid backend");
  });

  it("returns 500 status from orchestrator on internal errors", async () => {
    orchestrator.createSession.mockResolvedValue({
      ok: false,
      error: "CLI binary not found",
      status: 500,
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test" }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("CLI binary not found");
  });

  it("returns 503 from orchestrator on container startup failure", async () => {
    orchestrator.createSession.mockResolvedValue({
      ok: false,
      error: "Docker is required but container startup failed",
      status: 503,
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", sandboxEnabled: true }),
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("Docker is required");
  });

  it("handles empty request body gracefully", async () => {
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    // Route catches JSON parse errors and defaults to {}
    expect(res.status).toBe(200);
    expect(orchestrator.createSession).toHaveBeenCalledWith({});
  });
});

describe("GET /api/sessions", () => {
  it("returns the list of sessions enriched with names", async () => {
    const sessions = [
      { sessionId: "s1", state: "running", cwd: "/a" },
      { sessionId: "s2", state: "stopped", cwd: "/b" },
    ];
    launcher.listSessions.mockReturnValue(sessions);
    vi.mocked(sessionNames.getAllNames).mockReturnValue({ s1: "Fix auth bug" });

    const res = await app.request("/api/sessions", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([
      {
        sessionId: "s1", state: "running", cwd: "/a", name: "Fix auth bug",
        gitBranch: "", gitAhead: 0, gitBehind: 0, totalLinesAdded: 0, totalLinesRemoved: 0,
      },
      {
        sessionId: "s2", state: "stopped", cwd: "/b",
        gitBranch: "", gitAhead: 0, gitBehind: 0, totalLinesAdded: 0, totalLinesRemoved: 0,
      },
    ]);
  });

  it("enriches sessions with git data from bridge state", async () => {
    const sessions = [
      { sessionId: "s1", state: "running", cwd: "/a" },
      { sessionId: "s2", state: "running", cwd: "/b" },
    ];
    launcher.listSessions.mockReturnValue(sessions);
    vi.mocked(sessionNames.getAllNames).mockReturnValue({});
    bridge.getAllSessions.mockReturnValue([
      {
        session_id: "s1",
        git_branch: "feature/auth",
        git_ahead: 3,
        git_behind: 1,
        total_lines_added: 42,
        total_lines_removed: 7,
      },
    ]);

    const res = await app.request("/api/sessions", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    // s1 should have bridge git data
    expect(json[0]).toMatchObject({
      sessionId: "s1",
      gitBranch: "feature/auth",
      gitAhead: 3,
      gitBehind: 1,
      totalLinesAdded: 42,
      totalLinesRemoved: 7,
    });
    // s2 has no bridge data — defaults to empty/zero
    expect(json[1]).toMatchObject({
      sessionId: "s2",
      gitBranch: "",
      gitAhead: 0,
      gitBehind: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    });
  });

  it("prefers bridge cwd over launcher cwd when available", async () => {
    const sessions = [
      { sessionId: "s1", state: "running", cwd: "/workspace" },
    ];
    launcher.listSessions.mockReturnValue(sessions);
    vi.mocked(sessionNames.getAllNames).mockReturnValue({});
    bridge.getAllSessions.mockReturnValue([
      {
        session_id: "s1",
        cwd: "/home/ubuntu/companion",
      },
    ]);

    const res = await app.request("/api/sessions", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json[0]).toMatchObject({
      sessionId: "s1",
      cwd: "/home/ubuntu/companion",
    });
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns the session when found", async () => {
    const session = { sessionId: "s1", state: "running", cwd: "/test" };
    launcher.getSession.mockReturnValue(session);

    const res = await app.request("/api/sessions/s1", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(session);
  });

  it("returns 404 when session not found", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/nonexistent", { method: "GET" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Session not found" });
  });
});

describe("GET /api/claude/sessions/discover", () => {
  it("returns discovered Claude sessions and forwards limit", async () => {
    mockDiscoverClaudeSessions.mockReturnValue([
      {
        sessionId: "session-123",
        cwd: "/repo",
        gitBranch: "feature/branch",
        slug: "calm-mountain",
        lastActivityAt: 12345,
        sourceFile: "/Users/test/.claude/projects/repo/session-123.jsonl",
      },
    ]);

    const res = await app.request("/api/claude/sessions/discover?limit=250", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockDiscoverClaudeSessions).toHaveBeenCalledWith({ limit: 250 });
    const json = await res.json();
    expect(json).toEqual({
      sessions: [
        {
          sessionId: "session-123",
          cwd: "/repo",
          gitBranch: "feature/branch",
          slug: "calm-mountain",
          lastActivityAt: 12345,
          sourceFile: "/Users/test/.claude/projects/repo/session-123.jsonl",
        },
      ],
    });
  });
});

describe("GET /api/claude/sessions/:id/history", () => {
  it("returns paged Claude transcript history and forwards cursor/limit", async () => {
    // Validate route wiring so frontend pagination requests reach the loader with the same cursor/limit.
    mockGetClaudeSessionHistoryPage.mockReturnValue({
      sourceFile: "/Users/test/.claude/projects/repo/session-123.jsonl",
      nextCursor: 80,
      hasMore: true,
      totalMessages: 140,
      messages: [
        {
          id: "resume-session-123-user-u1",
          role: "user",
          content: "Prior prompt",
          timestamp: 1,
        },
        {
          id: "resume-session-123-assistant-a1",
          role: "assistant",
          content: "Prior answer",
          timestamp: 2,
        },
      ],
    });

    const res = await app.request("/api/claude/sessions/session-123/history?limit=40&cursor=40", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockGetClaudeSessionHistoryPage).toHaveBeenCalledWith({
      sessionId: "session-123",
      limit: 40,
      cursor: 40,
    });
    const json = await res.json();
    expect(json).toMatchObject({
      nextCursor: 80,
      hasMore: true,
      totalMessages: 140,
    });
    expect(json.messages).toHaveLength(2);
  });

  it("returns 404 when transcript history does not exist", async () => {
    // Validate explicit not-found semantics so UI can render a clear empty/error state.
    mockGetClaudeSessionHistoryPage.mockReturnValue(null);

    const res = await app.request("/api/claude/sessions/missing/history", { method: "GET" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Claude session history not found" });
  });
});

describe("POST /api/sessions/:id/editor/start", () => {
  it("returns unavailable when code-server is not installed on host", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });
    mockResolveBinary.mockImplementation((name: string) => (name === "code-server" ? null : null));

    const res = await app.request("/api/sessions/s1/editor/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: false,
      installed: false,
      mode: "host",
    });
    expect(json.message).toContain("not installed");
  });

  it("starts host editor and returns a URL when code-server is available", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo/my app",
    });
    mockResolveBinary.mockImplementation((name: string) => (name === "code-server" ? "/usr/bin/code-server" : null));
    // Mock fetch so the readiness poll resolves immediately instead of timing out
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await app.request("/api/sessions/s1/editor/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: true,
      installed: true,
      mode: "host",
      url: "http://localhost:13338?folder=%2Frepo%2Fmy%20app",
    });
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("--bind-addr 127.0.0.1:13338"),
      expect.objectContaining({ timeout: 10_000 }),
    );
    fetchSpy.mockRestore();
  });

  it("starts container editor and returns mapped host URL", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 13337, hostPort: 49152 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    vi.spyOn(containerManager, "hasBinaryInContainer").mockReturnValue(true);
    vi.spyOn(containerManager, "isContainerAlive").mockReturnValue("running");
    const execSpy = vi.spyOn(containerManager, "execInContainer").mockReturnValue("");
    // Mock fetch so the readiness poll resolves immediately instead of timing out
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await app.request("/api/sessions/s1/editor/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: true,
      installed: true,
      mode: "container",
      url: "http://localhost:49152?folder=%2Fworkspace",
    });
    expect(execSpy).toHaveBeenCalledWith(
      "cid-1",
      expect.arrayContaining(["sh", "-lc"]),
      10_000,
    );
    fetchSpy.mockRestore();
  });
});

describe("POST /api/sessions/:id/kill", () => {
  it("returns ok when session is killed", async () => {
    orchestrator.killSession.mockResolvedValue({ ok: true });

    const res = await app.request("/api/sessions/s1/kill", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(orchestrator.killSession).toHaveBeenCalledWith("s1");
  });

  it("returns 404 when session not found", async () => {
    orchestrator.killSession.mockResolvedValue({ ok: false });

    const res = await app.request("/api/sessions/nonexistent/kill", { method: "POST" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Session not found or already exited" });
  });
});

describe("POST /api/sessions/:id/relaunch", () => {
  it("returns ok when session is relaunched", async () => {
    orchestrator.relaunchSession.mockResolvedValue({ ok: true });

    const res = await app.request("/api/sessions/s1/relaunch", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(orchestrator.relaunchSession).toHaveBeenCalledWith("s1");
  });

  it("returns 503 with error when container is missing", async () => {
    orchestrator.relaunchSession.mockResolvedValue({
      ok: false,
      error: 'Container "heyhank-gone" was removed externally. Please create a new session.',
    });

    const res = await app.request("/api/sessions/s1/relaunch", { method: "POST" });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("removed externally");
  });

  it("returns 404 when session not found via relaunch", async () => {
    orchestrator.relaunchSession.mockResolvedValue({ ok: false, error: "Session not found" });

    const res = await app.request("/api/sessions/nonexistent/relaunch", { method: "POST" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Session not found");
  });
});

describe("GET /api/sessions/:id/processes/system", () => {
  it("parses macOS lsof LISTEN lines and returns dev servers", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      cwd: "/repo",
      state: "running",
    });

    vi.mocked(execSync)
      .mockReturnValueOnce(
        [
          "COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
          "node    12345 test   20u  IPv6 0x123456789      0t0  TCP *:3000 (LISTEN)",
        ].join("\n"),
      )
      .mockReturnValueOnce("node /repo/node_modules/vite/bin/vite.js --port 3000\n");

    const res = await app.request("/api/sessions/s1/processes/system", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      processes: [
        {
          pid: 12345,
          command: "node",
          fullCommand: "node /repo/node_modules/vite/bin/vite.js --port 3000",
          ports: [3000],
        },
      ],
    });
  });

  it("includes process cwd and best-effort start time when available", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      cwd: "/repo",
      state: "running",
    });

    vi.mocked(execSync)
      .mockReturnValueOnce(
        [
          "COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
          "bun     43210 test   20u  IPv4 0x123456789      0t0  TCP *:3457 (LISTEN)",
        ].join("\n"),
      )
      .mockReturnValueOnce("bun run dev\n")
      .mockReturnValueOnce("p43210\nfcwd\nn/Users/test/project\n")
      .mockReturnValueOnce("Mon Feb 23 10:00:00 2026\n");

    const res = await app.request("/api/sessions/s1/processes/system", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.processes).toHaveLength(1);
    expect(json.processes[0]).toMatchObject({
      pid: 43210,
      command: "bun",
      fullCommand: "bun run dev",
      cwd: "/Users/test/project",
      ports: [3457],
    });
    expect(typeof json.processes[0].startedAt).toBe("number");
  });
});

describe("DELETE /api/sessions/:id", () => {
  // Route delegates to orchestrator.deleteSession — detailed cleanup logic
  // (kill, container removal, worktree, etc.) is tested in session-orchestrator.test.ts

  it("delegates to orchestrator and returns ok", async () => {
    orchestrator.deleteSession.mockResolvedValue({ ok: true });

    const res = await app.request("/api/sessions/s1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    expect(orchestrator.deleteSession).toHaveBeenCalledWith("s1");
  });

  it("returns worktree info from orchestrator result", async () => {
    orchestrator.deleteSession.mockResolvedValue({
      ok: true,
      worktree: { cleaned: true, path: "/wt/feat" },
    });

    const res = await app.request("/api/sessions/s1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    expect(json.worktree).toMatchObject({ cleaned: true, path: "/wt/feat" });
  });
});

describe("POST /api/sessions/:id/archive", () => {
  // Route delegates to orchestrator.archiveSession — detailed cleanup logic
  // (kill, container, worktree) is tested in session-orchestrator.test.ts

  it("delegates to orchestrator and returns ok", async () => {
    orchestrator.archiveSession.mockResolvedValue({ ok: true });

    const res = await app.request("/api/sessions/s1/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    expect(orchestrator.archiveSession).toHaveBeenCalledWith("s1", {
      force: undefined,
    });
  });
});

describe("POST /api/sessions/:id/unarchive", () => {
  it("delegates to orchestrator and returns ok", async () => {
    orchestrator.unarchiveSession.mockReturnValue({ ok: true });

    const res = await app.request("/api/sessions/s1/unarchive", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(orchestrator.unarchiveSession).toHaveBeenCalledWith("s1");
  });
});

// ─── Environments ────────────────────────────────────────────────────────────

describe("GET /api/envs", () => {
  it("returns the list of environments", async () => {
    const envs = [
      { name: "Dev", slug: "dev", variables: { A: "1" }, createdAt: 1, updatedAt: 1 },
    ];
    vi.mocked(envManager.listEnvs).mockReturnValue(envs);

    const res = await app.request("/api/envs", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(envs);
  });
});

describe("POST /api/envs", () => {
  it("creates an environment and returns 201", async () => {
    const created = {
      name: "Staging",
      slug: "staging",
      variables: { HOST: "staging.example.com" },
      createdAt: 1000,
      updatedAt: 1000,
    };
    vi.mocked(envManager.createEnv).mockReturnValue(created);

    const res = await app.request("/api/envs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Staging", variables: { HOST: "staging.example.com" } }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual(created);
    expect(envManager.createEnv).toHaveBeenCalledWith(
      "Staging",
      { HOST: "staging.example.com" },
    );
  });

  it("returns 400 when createEnv throws", async () => {
    vi.mocked(envManager.createEnv).mockImplementation(() => {
      throw new Error("Environment name is required");
    });

    const res = await app.request("/api/envs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Environment name is required" });
  });
});

describe("PUT /api/envs/:slug", () => {
  it("updates an existing environment", async () => {
    const updated = {
      name: "Production v2",
      slug: "production-v2",
      variables: { KEY: "new-value" },
      createdAt: 1000,
      updatedAt: 2000,
    };
    vi.mocked(envManager.updateEnv).mockReturnValue(updated);

    const res = await app.request("/api/envs/production", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Production v2", variables: { KEY: "new-value" } }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(updated);
    expect(envManager.updateEnv).toHaveBeenCalledWith("production", {
      name: "Production v2",
      variables: { KEY: "new-value" },
    });
  });
});

describe("DELETE /api/envs/:slug", () => {
  it("deletes an existing environment", async () => {
    vi.mocked(envManager.deleteEnv).mockReturnValue(true);

    const res = await app.request("/api/envs/staging", { method: "DELETE" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(envManager.deleteEnv).toHaveBeenCalledWith("staging");
  });

  it("returns 404 when environment not found", async () => {
    vi.mocked(envManager.deleteEnv).mockReturnValue(false);

    const res = await app.request("/api/envs/nonexistent", { method: "DELETE" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Environment not found" });
  });
});

describe("Saved prompts API", () => {
  it("lists prompts with cwd filter", async () => {
    // Confirms route passes cwd/scope filter through to prompt manager.
    const prompts = [
      {
        id: "p1",
        name: "Review",
        content: "Review this PR",
        scope: "global" as const,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    vi.mocked(promptManager.listPrompts).mockReturnValue(prompts);

    const res = await app.request("/api/prompts?cwd=%2Frepo", { method: "GET" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(prompts);
    expect(promptManager.listPrompts).toHaveBeenCalledWith({ cwd: "/repo", scope: undefined });
  });

  it("creates a prompt with legacy cwd", async () => {
    // Confirms payload mapping for prompt creation including project cwd.
    const created = {
      id: "p1",
      name: "Review",
      content: "Review this PR",
      scope: "project" as const,
      projectPath: "/repo",
      projectPaths: ["/repo"],
      createdAt: 1,
      updatedAt: 1,
    };
    vi.mocked(promptManager.createPrompt).mockReturnValue(created);

    const res = await app.request("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Review",
        content: "Review this PR",
        scope: "project",
        cwd: "/repo",
      }),
    });

    expect(res.status).toBe(201);
    expect(promptManager.createPrompt).toHaveBeenCalledWith(
      "Review",
      "Review this PR",
      "project",
      "/repo",
      undefined,
    );
  });

  it("creates a prompt with projectPaths", async () => {
    // Confirms projectPaths array is forwarded to prompt manager.
    const created = {
      id: "p2",
      name: "Multi",
      content: "Multi-project prompt",
      scope: "project" as const,
      projectPath: "/repo-a",
      projectPaths: ["/repo-a", "/repo-b"],
      createdAt: 1,
      updatedAt: 1,
    };
    vi.mocked(promptManager.createPrompt).mockReturnValue(created);

    const res = await app.request("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Multi",
        content: "Multi-project prompt",
        scope: "project",
        projectPaths: ["/repo-a", "/repo-b"],
      }),
    });

    expect(res.status).toBe(201);
    expect(promptManager.createPrompt).toHaveBeenCalledWith(
      "Multi",
      "Multi-project prompt",
      "project",
      undefined,
      ["/repo-a", "/repo-b"],
    );
  });

  it("updates a prompt", async () => {
    // Confirms update fields are forwarded verbatim.
    vi.mocked(promptManager.updatePrompt).mockReturnValue({
      id: "p1",
      name: "Updated",
      content: "Updated content",
      scope: "global",
      createdAt: 1,
      updatedAt: 2,
    });

    const res = await app.request("/api/prompts/p1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", content: "Updated content" }),
    });
    expect(res.status).toBe(200);
    expect(promptManager.updatePrompt).toHaveBeenCalledWith("p1", {
      name: "Updated",
      content: "Updated content",
      scope: undefined,
      projectPaths: undefined,
    });
  });

  it("updates a prompt scope and projectPaths", async () => {
    // Confirms scope and projectPaths updates are forwarded.
    vi.mocked(promptManager.updatePrompt).mockReturnValue({
      id: "p1",
      name: "Updated",
      content: "Updated content",
      scope: "project",
      projectPath: "/repo",
      projectPaths: ["/repo"],
      createdAt: 1,
      updatedAt: 2,
    });

    const res = await app.request("/api/prompts/p1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectPaths: ["/repo"] }),
    });
    expect(res.status).toBe(200);
    expect(promptManager.updatePrompt).toHaveBeenCalledWith("p1", {
      name: undefined,
      content: undefined,
      scope: "project",
      projectPaths: ["/repo"],
    });
  });

  it("deletes a prompt", async () => {
    // Confirms delete endpoint calls manager and returns ok shape.
    vi.mocked(promptManager.deletePrompt).mockReturnValue(true);

    const res = await app.request("/api/prompts/p1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(promptManager.deletePrompt).toHaveBeenCalledWith("p1");
  });
});

// ─── Image Pull Manager API ──────────────────────────────────────────────────

describe("GET /api/images/:tag/status", () => {
  it("returns the pull state for an image", async () => {
    mockImagePullGetState.mockReturnValueOnce({
      image: "heyhank:latest",
      status: "ready",
      progress: [],
    });

    const res = await app.request("/api/images/heyhank%3Alatest/status");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.image).toBe("heyhank:latest");
    expect(json.status).toBe("ready");
  });
});

describe("POST /api/images/:tag/pull", () => {
  it("triggers a pull and returns the current state", async () => {
    vi.spyOn(containerManager, "checkDocker").mockReturnValue(true);
    mockImagePullGetState.mockReturnValueOnce({
      image: "heyhank:latest",
      status: "pulling",
      progress: [],
      startedAt: Date.now(),
    });

    const res = await app.request("/api/images/heyhank%3Alatest/pull", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockImagePullPull).toHaveBeenCalledWith("heyhank:latest");
  });

  it("returns 503 when Docker is not available", async () => {
    vi.spyOn(containerManager, "checkDocker").mockReturnValue(false);

    const res = await app.request("/api/images/heyhank%3Alatest/pull", {
      method: "POST",
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("Docker is not available");
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  it("returns settings status without exposing the key", async () => {
    vi.mocked(settingsManager.getSettings).mockReturnValue({
      anthropicApiKey: "or-secret",
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 123,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      anthropicApiKeyConfigured: true,
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthTokenConfigured: false,
      openaiApiKeyConfigured: false,
      codexDeviceAuthConfigured: false,
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
    });
  });

  it("reports key as not configured when empty", async () => {
    vi.mocked(settingsManager.getSettings).mockReturnValue({
      anthropicApiKey: "",
      anthropicModel: "openai/gpt-4o-mini",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 123,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      anthropicApiKeyConfigured: false,
      anthropicModel: "openai/gpt-4o-mini",
      claudeCodeOAuthTokenConfigured: false,
      openaiApiKeyConfigured: false,
      codexDeviceAuthConfigured: false,
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
    });
  });

  // Verifies publicUrl is included in GET response when set to a non-empty value
  it("includes publicUrl in response when configured", async () => {
    vi.mocked(settingsManager.getSettings).mockReturnValue({
      anthropicApiKey: "",
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "https://example.com",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 100,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.publicUrl).toBe("https://example.com");
  });
});

describe("PUT /api/settings", () => {
  it("updates settings", async () => {
    vi.mocked(settingsManager.updateSettings).mockReturnValue({
      anthropicApiKey: "new-key",
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 456,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "new-key" }),
    });

    expect(res.status).toBe(200);
    expect(settingsManager.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiKey: "new-key",
      }),
    );
    const json = await res.json();
    expect(json).toMatchObject({
      anthropicApiKeyConfigured: true,
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthTokenConfigured: false,
      openaiApiKeyConfigured: false,
      codexDeviceAuthConfigured: false,
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
    });
  });

  it("trims key and falls back to default model for blank value", async () => {
    vi.mocked(settingsManager.updateSettings).mockReturnValue({
      anthropicApiKey: "trimmed-key",
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 789,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "  trimmed-key  ", anthropicModel: "   " }),
    });

    expect(res.status).toBe(200);
    expect(settingsManager.updateSettings).toHaveBeenCalledWith({
      anthropicApiKey: "trimmed-key",
      anthropicModel: "claude-sonnet-4-6",
      editorTabEnabled: undefined,
    });
  });

  it("updates only model without overriding key", async () => {
    vi.mocked(settingsManager.updateSettings).mockReturnValue({
      anthropicApiKey: "existing-key",
      anthropicModel: "openai/gpt-4o-mini",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 999,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicModel: "openai/gpt-4o-mini" }),
    });

    expect(res.status).toBe(200);
    expect(settingsManager.updateSettings).toHaveBeenCalledWith({
      anthropicApiKey: undefined,
      anthropicModel: "openai/gpt-4o-mini",
      editorTabEnabled: undefined,
    });
  });

  it("returns 400 for non-string model", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "new-key", anthropicModel: 123 }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "anthropicModel must be a string" });
  });

  it("returns 400 for non-string key", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: 123 }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "anthropicApiKey must be a string" });
  });

  it("returns 400 for non-boolean editor tab setting", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorTabEnabled: "yes" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "editorTabEnabled must be a boolean" });
  });

  // Rejects invalid updateChannel values that aren't "stable" or "prerelease"
  it("returns 400 for invalid updateChannel value", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updateChannel: "nightly" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "updateChannel must be 'stable' or 'prerelease'" });
  });

  // Verifies that PUT /api/settings accepts a publicUrl string and passes
  // it (trimmed, trailing-slash-stripped) to updateSettings
  it("accepts and saves publicUrl string", async () => {
    vi.mocked(settingsManager.updateSettings).mockReturnValue({
      anthropicApiKey: "",
      anthropicModel: "claude-sonnet-4-6",
      claudeCodeOAuthToken: "",
      openaiApiKey: "",
      onboardingCompleted: false,
      editorTabEnabled: false,
      aiValidationEnabled: false,
      aiValidationAutoApprove: true,
      aiValidationAutoDeny: false,
      publicUrl: "https://my-server.com",
      updateChannel: "stable",
      dockerAutoUpdate: false,
      updatedAt: 500,
      geminiApiKey: "",
      geminiVoice: "Puck",
      assistantName: "Maxx",
      userName: "",
      internalAiProvider: "",
    hankChatProvider: "gemini-live",
    hankChatModel: "",
    hankChatAvatarEnabled: true,
    hankChatAvatarUrl: "",
    mem0ApiKey: "",
    mem0UserId: "",
    memoryAutoDetect: true,
    obsidianVaultPath: "",
    });

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicUrl: "  https://my-server.com///  " }),
    });

    expect(res.status).toBe(200);
    // The route trims whitespace and strips trailing slashes before calling updateSettings
    expect(settingsManager.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        publicUrl: "https://my-server.com",
      }),
    );
    const json = await res.json();
    expect(json.publicUrl).toBe("https://my-server.com");
  });

  // Rejects non-string publicUrl values with a 400 error
  it("returns 400 for non-string publicUrl", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicUrl: 123 }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "publicUrl must be a string" });
  });

  // Rejects publicUrl values that are not valid http/https URLs
  it("returns 400 for publicUrl with invalid scheme", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicUrl: "ftp://bad-scheme.com" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "publicUrl must be a valid http/https URL" });
  });

  it("returns 400 when no settings fields are provided", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "At least one settings field is required" });
  });

  // Validates that claudeCodeOAuthToken must be a string
  it("returns 400 for non-string claudeCodeOAuthToken", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claudeCodeOAuthToken: 123 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "claudeCodeOAuthToken must be a string" });
  });

  // Validates that openaiApiKey must be a string
  it("returns 400 for non-string openaiApiKey", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openaiApiKey: true }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "openaiApiKey must be a string" });
  });

  // Validates that onboardingCompleted must be a boolean
  it("returns 400 for non-boolean onboardingCompleted", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingCompleted: "yes" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "onboardingCompleted must be a boolean" });
  });

  // Validates that dockerAutoUpdate must be a boolean
  it("returns 400 for non-boolean dockerAutoUpdate", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dockerAutoUpdate: "yes" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "dockerAutoUpdate must be a boolean" });
  });
});

describe("POST /api/settings/anthropic/verify", () => {
  it("returns 400 when no apiKey provided", async () => {
    // Verifies the endpoint rejects requests that omit the apiKey field
    const res = await app.request("/api/settings/anthropic/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ valid: false, error: "API key is required" });
  });

  it("returns valid:true when fetch succeeds", async () => {
    // Verifies successful Anthropic API key validation when the upstream API responds ok
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/settings/anthropic/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-ant-valid-key" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ valid: true });

    // Verify the correct Anthropic API endpoint and headers were used
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-valid-key",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("returns valid:false with error when fetch returns non-ok", async () => {
    // Verifies the endpoint correctly reports invalid keys when the Anthropic API rejects them
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/settings/anthropic/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-ant-invalid-key" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ valid: false, error: "API returned 401" });

    vi.unstubAllGlobals();
  });

  it("returns valid:false when fetch throws", async () => {
    // Verifies graceful error handling when the network request itself fails
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/settings/anthropic/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-ant-some-key" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ valid: false, error: "Request failed" });

    vi.unstubAllGlobals();
  });
});

// ─── Git ─────────────────────────────────────────────────────────────────────

describe("GET /api/git/repo-info", () => {
  it("returns repo info for a valid path", async () => {
    const info = {
      repoRoot: "/repo",
      repoName: "my-repo",
      currentBranch: "main",
      defaultBranch: "main",
      isWorktree: false,
    };
    vi.mocked(gitUtils.getRepoInfo).mockReturnValue(info);

    const res = await app.request("/api/git/repo-info?path=/repo", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(info);
    expect(gitUtils.getRepoInfo).toHaveBeenCalledWith("/repo");
  });

  it("returns 400 when path query parameter is missing", async () => {
    const res = await app.request("/api/git/repo-info", { method: "GET" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "path required" });
  });
});

describe("GET /api/git/branches", () => {
  it("returns branches for a repo", async () => {
    const branches = [
      { name: "main", isCurrent: true, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
      { name: "dev", isCurrent: false, isRemote: false, worktreePath: null, ahead: 2, behind: 0 },
    ];
    vi.mocked(gitUtils.listBranches).mockReturnValue(branches);

    const res = await app.request("/api/git/branches?repoRoot=/repo", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(branches);
    expect(gitUtils.listBranches).toHaveBeenCalledWith("/repo");
  });
});

describe("POST /api/git/worktree", () => {
  it("creates a worktree", async () => {
    const result = {
      worktreePath: "/home/.heyhank/worktrees/repo/feat",
      branch: "feat",
      actualBranch: "feat",
      isNew: true,
    };
    vi.mocked(gitUtils.ensureWorktree).mockReturnValue(result);
    const res = await app.request("/api/git/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoRoot: "/repo", branch: "feat", baseBranch: "main" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(result);
    expect(gitUtils.ensureWorktree).toHaveBeenCalledWith("/repo", "feat", {
      baseBranch: "main",
    });
  });
});

describe("DELETE /api/git/worktree", () => {
  it("removes a worktree", async () => {
    vi.mocked(gitUtils.removeWorktree).mockReturnValue({ removed: true });
    const res = await app.request("/api/git/worktree", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoRoot: "/repo", worktreePath: "/wt/feat", force: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ removed: true });
    expect(gitUtils.removeWorktree).toHaveBeenCalledWith("/repo", "/wt/feat", { force: true });
  });
});


// ─── Session Naming ─────────────────────────────────────────────────────────

describe("PATCH /api/sessions/:id/name", () => {
  it("updates session name and returns ok", async () => {
    launcher.getSession.mockReturnValue({ sessionId: "s1", state: "running", cwd: "/test" });

    const res = await app.request("/api/sessions/s1/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fix auth bug" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, name: "Fix auth bug" });
    expect(sessionNames.setName).toHaveBeenCalledWith("s1", "Fix auth bug");
    // Verify the name update is broadcast to connected browsers via WebSocket
    expect(bridge.broadcastNameUpdate).toHaveBeenCalledWith("s1", "Fix auth bug");
  });

  it("trims whitespace from name", async () => {
    launcher.getSession.mockReturnValue({ sessionId: "s1", state: "running", cwd: "/test" });

    const res = await app.request("/api/sessions/s1/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  My Session  " }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, name: "My Session" });
    expect(sessionNames.setName).toHaveBeenCalledWith("s1", "My Session");
  });

  it("returns 404 when session not found", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/nonexistent/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Some name" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Session not found" });
  });

  it("returns 400 when name is empty", async () => {
    const res = await app.request("/api/sessions/s1/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "name is required" });
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request("/api/sessions/s1/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

// ─── Update checking ────────────────────────────────────────────────────────

describe("GET /api/update-check", () => {
  it("triggers a refresh when never checked", async () => {
    mockUpdateCheckerState.lastChecked = 0;

    const res = await app.request("/api/update-check", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockCheckForUpdate).toHaveBeenCalledOnce();
  });

  it("does not trigger a refresh when the previous check is fresh", async () => {
    mockUpdateCheckerState.lastChecked = Date.now();

    const res = await app.request("/api/update-check", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/update-check", () => {
  it("always forces a refresh", async () => {
    mockUpdateCheckerState.lastChecked = Date.now();

    const res = await app.request("/api/update-check", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockCheckForUpdate).toHaveBeenCalledOnce();
  });
});

// ─── Filesystem ──────────────────────────────────────────────────────────────

describe("GET /api/fs/home", () => {
  it("returns home directory and cwd", async () => {
    const res = await app.request("/api/fs/home", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("home");
    expect(json).toHaveProperty("cwd");
    expect(typeof json.home).toBe("string");
    expect(typeof json.cwd).toBe("string");
  });

  it("returns home as cwd when process.cwd() is the package root", async () => {
    const origCwd = process.cwd;
    const origEnv = process.env.__HEYHANK_PACKAGE_ROOT;
    try {
      process.env.__HEYHANK_PACKAGE_ROOT = "/opt/heyhank";
      process.cwd = () => "/opt/heyhank";
      const res = await app.request("/api/fs/home", { method: "GET" });
      const json = await res.json();
      expect(json.cwd).toBe(json.home);
    } finally {
      process.cwd = origCwd;
      process.env.__HEYHANK_PACKAGE_ROOT = origEnv;
    }
  });

  it("returns home as cwd when process.cwd() is inside the package root", async () => {
    const origCwd = process.cwd;
    const origEnv = process.env.__HEYHANK_PACKAGE_ROOT;
    try {
      process.env.__HEYHANK_PACKAGE_ROOT = "/opt/heyhank";
      process.cwd = () => "/opt/heyhank/node_modules/.bin";
      const res = await app.request("/api/fs/home", { method: "GET" });
      const json = await res.json();
      expect(json.cwd).toBe(json.home);
    } finally {
      process.cwd = origCwd;
      process.env.__HEYHANK_PACKAGE_ROOT = origEnv;
    }
  });

  it("returns actual cwd when launched from a project directory", async () => {
    const origCwd = process.cwd;
    const origEnv = process.env.__HEYHANK_PACKAGE_ROOT;
    try {
      process.env.__HEYHANK_PACKAGE_ROOT = "/opt/heyhank";
      process.cwd = () => "/Users/testuser/my-project";
      const res = await app.request("/api/fs/home", { method: "GET" });
      const json = await res.json();
      expect(json.cwd).toBe("/Users/testuser/my-project");
    } finally {
      process.cwd = origCwd;
      process.env.__HEYHANK_PACKAGE_ROOT = origEnv;
    }
  });

  it("returns home as cwd when process.cwd() equals home directory", async () => {
    const { homedir } = await import("node:os");
    const origCwd = process.cwd;
    const origEnv = process.env.__HEYHANK_PACKAGE_ROOT;
    try {
      delete process.env.__HEYHANK_PACKAGE_ROOT;
      process.cwd = () => homedir();
      const res = await app.request("/api/fs/home", { method: "GET" });
      const json = await res.json();
      expect(json.cwd).toBe(json.home);
    } finally {
      process.cwd = origCwd;
      process.env.__HEYHANK_PACKAGE_ROOT = origEnv;
    }
  });
});

describe("GET /api/fs/diff", () => {
  // guardPath() allows paths under homedir()/process.cwd(). These tests use
  // synthetic paths like /repo/file.ts that don't exist on disk, so spy on
  // process.cwd to include "/" — execSync is mocked, so the real FS isn't touched.
  let origCwd: typeof process.cwd;
  beforeEach(() => {
    origCwd = process.cwd;
    process.cwd = () => "/repo";
  });
  afterEach(() => {
    process.cwd = origCwd;
  });

  it("returns 400 when path is missing", async () => {
    const res = await app.request("/api/fs/diff", { method: "GET" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "path required" });
  });

  it("diffs against HEAD by default when no base param is provided", async () => {
    // Validates that /api/fs/diff defaults to HEAD (uncommitted changes only).
    const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;
    vi.mocked(execSync)
      .mockReturnValueOnce("/repo\n") // rev-parse --show-toplevel
      .mockReturnValueOnce("file.ts\n") // ls-files --full-name
      .mockReturnValueOnce(diffOutput); // git diff HEAD

    const res = await app.request("/api/fs/diff?path=/repo/file.ts", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.diff).toBe(diffOutput);
    expect(json.path).toContain("file.ts");
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("git diff HEAD"),
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("diffs against default branch when base=default-branch", async () => {
    // Validates that /api/fs/diff uses the repository default branch as base (origin/main here).
    const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;
    vi.mocked(execSync)
      .mockReturnValueOnce("/repo\n") // rev-parse --show-toplevel
      .mockReturnValueOnce("file.ts\n") // ls-files --full-name
      .mockReturnValueOnce("refs/remotes/origin/main\n") // symbolic-ref refs/remotes/origin/HEAD
      .mockReturnValueOnce(diffOutput); // git diff origin/main

    const res = await app.request("/api/fs/diff?path=/repo/file.ts&base=default-branch", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.diff).toBe(diffOutput);
    expect(json.path).toContain("file.ts");
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("git diff 'origin/main'"),
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("returns no-index diff for untracked files", async () => {
    // Untracked files have no base-branch diff content, so API must fallback to a full-file no-index diff.
    const untrackedDiff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello`;

    vi.mocked(execSync)
      .mockReturnValueOnce("/repo\n") // rev-parse --show-toplevel
      .mockReturnValueOnce("new.txt\n") // ls-files --full-name
      .mockReturnValueOnce("refs/remotes/origin/main\n") // symbolic-ref refs/remotes/origin/HEAD
      .mockReturnValueOnce("") // git diff origin/main -> empty for untracked
      .mockReturnValueOnce("new.txt\n") // ls-files --others --exclude-standard
      .mockImplementationOnce(() => {
        const err = new Error("diff exits with 1 for differences") as Error & { stdout: string };
        err.stdout = untrackedDiff;
        throw err;
      }); // git diff --no-index

    const res = await app.request("/api/fs/diff?path=/repo/new.txt&base=default-branch", { method: "GET" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.diff).toContain("new file mode");
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("git diff --no-index -- /dev/null"),
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("falls back to local default branch when origin HEAD is unavailable", async () => {
    // Ensures fallback chain works when symbolic-ref fails (e.g. no origin/HEAD): use local fallback branch.
    const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 line1
+added`;
    vi.mocked(execSync)
      .mockReturnValueOnce("/repo\n") // rev-parse --show-toplevel
      .mockReturnValueOnce("file.ts\n") // ls-files --full-name
      .mockImplementationOnce(() => {
        const err = new Error("no symbol ref") as Error & { stdout: string };
        err.stdout = "error: ref refs/remotes/origin/HEAD is not a symbolic ref";
        throw err;
      }) // symbolic-ref refs/remotes/origin/HEAD unavailable
      .mockReturnValueOnce("main\n") // branch --list fallback
      .mockReturnValueOnce(diffOutput); // git diff main

    const res = await app.request("/api/fs/diff?path=/repo/file.ts&base=default-branch", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.diff).toBe(diffOutput);
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("git diff 'main'"),
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("returns empty diff when git command fails", async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });

    // Use path under /repo (stubbed cwd) so guardPath allows it; execSync throws to simulate "not a repo".
    const res = await app.request("/api/fs/diff?path=/repo/not-a-repo/file.ts", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.diff).toBe("");
    expect(json.path).toContain("file.ts");
  });
});

// ─── Backends ─────────────────────────────────────────────────────────────────

describe("GET /api/backends", () => {
  it("returns both backends with availability status", async () => {
    // resolveBinary returns a path for both binaries
    mockResolveBinary
      .mockReturnValueOnce("/usr/bin/claude")
      .mockReturnValueOnce("/usr/bin/codex");

    const res = await app.request("/api/backends", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([
      { id: "claude", name: "Claude Code", available: true },
      { id: "codex", name: "Codex", available: true },
    ]);
  });

  it("marks backends as unavailable when binary is not found", async () => {
    // resolveBinary returns null for both
    mockResolveBinary
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const res = await app.request("/api/backends", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([
      { id: "claude", name: "Claude Code", available: false },
      { id: "codex", name: "Codex", available: false },
    ]);
  });

  it("handles mixed availability", async () => {
    mockResolveBinary
      .mockReturnValueOnce("/usr/bin/claude") // claude found
      .mockReturnValueOnce(null); // codex not found

    const res = await app.request("/api/backends", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json[0].available).toBe(true);
    expect(json[1].available).toBe(false);
  });
});

describe("GET /api/backends/:id/models", () => {
  it("returns codex models from cache file sorted by priority", async () => {
    const cacheContent = JSON.stringify({
      models: [
        { slug: "gpt-5.1-codex-mini", display_name: "gpt-5.1-codex-mini", description: "Fast model", visibility: "list", priority: 10 },
        { slug: "gpt-5.2-codex", display_name: "gpt-5.2-codex", description: "Frontier model", visibility: "list", priority: 0 },
        { slug: "gpt-5-codex", display_name: "gpt-5-codex", description: "Old model", visibility: "hide", priority: 8 },
      ],
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(cacheContent);

    const res = await app.request("/api/backends/codex/models", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    // Should only include visible models, sorted by priority
    expect(json).toEqual([
      { value: "gpt-5.2-codex", label: "gpt-5.2-codex", description: "Frontier model" },
      { value: "gpt-5.1-codex-mini", label: "gpt-5.1-codex-mini", description: "Fast model" },
    ]);
  });

  it("returns 404 when codex cache file does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const res = await app.request("/api/backends/codex/models", { method: "GET" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Codex models cache not found");
  });

  it("returns 500 when cache file is malformed", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not valid json{{{");

    const res = await app.request("/api/backends/codex/models", { method: "GET" });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Failed to parse");
  });

  it("returns 404 for claude backend (uses frontend defaults)", async () => {
    const res = await app.request("/api/backends/claude/models", { method: "GET" });

    expect(res.status).toBe(404);
  });
});

// ─── Session creation with backend type ──────────────────────────────────────

describe("POST /api/sessions/create with backend", () => {
  // Route delegates to orchestrator.createSession — backend resolution is tested
  // in session-orchestrator.test.ts. Route tests verify the body is passed through.

  it("passes backend codex through to orchestrator", async () => {
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.2-codex", cwd: "/test", backend: "codex" }),
    });

    expect(res.status).toBe(200);
    expect(orchestrator.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.2-codex", backend: "codex" }),
    );
  });

  it("passes request without backend to orchestrator (defaults handled by orchestrator)", async () => {
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test" }),
    });

    expect(res.status).toBe(200);
    expect(orchestrator.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/test" }),
    );
  });
});

// ─── Per-session usage limits ─────────────────────────────────────────────────

describe("GET /api/sessions/:id/usage-limits", () => {
  it("returns Claude usage limits for a claude session", async () => {
    bridge.getSession.mockReturnValue({ backendType: "claude" });
    mockGetUsageLimits.mockResolvedValue({
      five_hour: { utilization: 42, resets_at: "2025-01-01T12:00:00Z" },
      seven_day: { utilization: 15, resets_at: null },
      extra_usage: null,
    });

    const res = await app.request("/api/sessions/s1/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      five_hour: { utilization: 42, resets_at: "2025-01-01T12:00:00Z" },
      seven_day: { utilization: 15, resets_at: null },
      extra_usage: null,
    });
    expect(mockGetUsageLimits).toHaveBeenCalled();
  });

  it("returns mapped Codex rate limits for a codex session", async () => {
    bridge.getSession.mockReturnValue({ backendType: "codex" });
    bridge.getCodexRateLimits.mockReturnValue({
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1730947200 * 1000 },
      secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1731552000 * 1000 },
    });

    const res = await app.request("/api/sessions/s1/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.five_hour).toEqual({
      utilization: 25,
      resets_at: new Date(1730947200 * 1000).toISOString(),
    });
    expect(json.seven_day).toEqual({
      utilization: 10,
      resets_at: new Date(1731552000 * 1000).toISOString(),
    });
    expect(json.extra_usage).toBeNull();
    expect(mockGetUsageLimits).not.toHaveBeenCalled();
  });

  it("returns empty limits when codex session has no rate limits yet", async () => {
    bridge.getSession.mockReturnValue({ backendType: "codex" });
    bridge.getCodexRateLimits.mockReturnValue(null);

    const res = await app.request("/api/sessions/s1/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ five_hour: null, seven_day: null, extra_usage: null });
  });

  it("maps Codex rate limits when bridge still returns second-based timestamps", async () => {
    bridge.getSession.mockReturnValue({ backendType: "codex" });
    bridge.getCodexRateLimits.mockReturnValue({
      // Backward-compat coverage for pre-normalized payloads from bridge/session state.
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1730947200 },
      secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1731552000 },
    });

    const res = await app.request("/api/sessions/s1/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.five_hour).toEqual({
      utilization: 25,
      resets_at: new Date(1730947200 * 1000).toISOString(),
    });
    expect(json.seven_day).toEqual({
      utilization: 10,
      resets_at: new Date(1731552000 * 1000).toISOString(),
    });
  });

  it("handles codex rate limits with null secondary", async () => {
    bridge.getSession.mockReturnValue({ backendType: "codex" });
    bridge.getCodexRateLimits.mockReturnValue({
      primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 0 },
      secondary: null,
    });

    const res = await app.request("/api/sessions/s1/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.five_hour).toEqual({ utilization: 50, resets_at: null });
    expect(json.seven_day).toBeNull();
  });

  it("falls back to Claude limits when session is not found", async () => {
    bridge.getSession.mockReturnValue(null);
    mockGetUsageLimits.mockResolvedValue({
      five_hour: null,
      seven_day: null,
      extra_usage: null,
    });

    const res = await app.request("/api/sessions/unknown/usage-limits", { method: "GET" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ five_hour: null, seven_day: null, extra_usage: null });
    expect(mockGetUsageLimits).toHaveBeenCalled();
  });
});

// ─── SSE Session Creation Streaming ──────────────────────────────────────────

/** Parse an SSE response body into an array of {event, data} objects */
async function parseSSE(res: Response): Promise<{ event: string; data: string }[]> {
  const text = await res.text();
  const events: { event: string; data: string }[] = [];
  // SSE frames are separated by double newlines
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    let data = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (data) events.push({ event, data });
  }
  return events;
}

describe("POST /api/sessions/create-stream", () => {
  // Route delegates to orchestrator.createSessionStreaming — detailed orchestration logic
  // (git ops, container creation, image pulling, etc.) is tested in session-orchestrator.test.ts.
  // Route tests verify SSE transport: progress events are emitted, done/error events are correct.

  it("emits progress events from orchestrator and done event on success", async () => {
    // Mock createSessionStreaming to call the progress callback with some events
    orchestrator.createSessionStreaming.mockImplementation(async (_body: any, onProgress: any) => {
      await onProgress("resolving_env", "Resolving environment...", "in_progress");
      await onProgress("resolving_env", "Resolving environment...", "done");
      await onProgress("launching_cli", "Launching Claude Code...", "in_progress");
      await onProgress("launching_cli", "Launching Claude Code...", "done");
      return {
        ok: true,
        session: { sessionId: "session-1", state: "starting", cwd: "/test", createdAt: Date.now(), backendType: "claude" },
      };
    });

    const res = await app.request("/api/sessions/create-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await parseSSE(res);

    // Should have progress events
    const progressEvents = events.filter((e) => e.event === "progress");
    expect(progressEvents.length).toBe(4);

    // First progress should be resolving_env in_progress
    const first = JSON.parse(progressEvents[0].data);
    expect(first.step).toBe("resolving_env");
    expect(first.status).toBe("in_progress");

    // Done event should be emitted with session info
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    const doneData = JSON.parse(doneEvent!.data);
    expect(doneData.sessionId).toBe("session-1");
    expect(doneData.cwd).toBe("/test");
  });

  it("emits error event when orchestrator returns failure", async () => {
    orchestrator.createSessionStreaming.mockResolvedValue({
      ok: false,
      error: "Invalid backend: invalid",
      status: 400,
    });

    const res = await app.request("/api/sessions/create-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", backend: "invalid" }),
    });

    expect(res.status).toBe(200);
    const events = await parseSSE(res);
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data).error).toContain("Invalid backend");
  });

  it("passes request body through to orchestrator", async () => {
    const body = {
      cwd: "/test",
      backend: "codex",
      branch: "feat/new",
      useWorktree: true,
      sandboxEnabled: true,
      sandboxSlug: "docker",
    };

    const res = await app.request("/api/sessions/create-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(orchestrator.createSessionStreaming).toHaveBeenCalledWith(
      body,
      expect.any(Function),
    );
  });

  it("does not emit done event when orchestrator returns error", async () => {
    orchestrator.createSessionStreaming.mockImplementation(async (_body: any, onProgress: any) => {
      await onProgress("resolving_env", "Resolving environment...", "in_progress");
      return { ok: false, error: "CLI binary not found", status: 500 };
    });

    const res = await app.request("/api/sessions/create-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test" }),
    });

    const events = await parseSSE(res);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeUndefined();
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

describe("POST /api/auth/verify", () => {
  it("returns ok:true for valid token", async () => {
    // verifyToken is mocked to return true, so any token should succeed
    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-token-for-routes" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("returns 401 for invalid token", async () => {
    // Temporarily override verifyToken to reject
    const { verifyToken } = await import("./auth-manager.js");
    (verifyToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Invalid token");
  });
});

// ---------------------------------------------------------------------------
// Container status / images endpoints
// ---------------------------------------------------------------------------

describe("GET /api/containers/status", () => {
  it("returns docker availability and version", async () => {
    // containerManager is already imported and its methods can be spied on
    const checkSpy = vi.spyOn(containerManager, "checkDocker").mockReturnValue(true);
    const versionSpy = vi.spyOn(containerManager, "getDockerVersion").mockReturnValue("24.0.7");

    const res = await app.request("/api/containers/status");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.available).toBe(true);
    expect(data.version).toBe("24.0.7");

    checkSpy.mockRestore();
    versionSpy.mockRestore();
  });

  it("returns null version when docker is unavailable", async () => {
    const checkSpy = vi.spyOn(containerManager, "checkDocker").mockReturnValue(false);

    const res = await app.request("/api/containers/status");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.version).toBeNull();

    checkSpy.mockRestore();
  });
});

describe("GET /api/containers/images", () => {
  it("returns list of available images", async () => {
    const spy = vi.spyOn(containerManager, "listImages").mockReturnValue(["node:22", "ubuntu:latest"]);

    const res = await app.request("/api/containers/images");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(["node:22", "ubuntu:latest"]);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Recording management endpoints (recorder=undefined by default)
// ---------------------------------------------------------------------------

describe("Recording endpoints (no recorder)", () => {
  it("POST /api/sessions/:id/recording/start returns 501 when recorder is not available", async () => {
    // Default test setup doesn't pass a recorder to createRoutes
    const res = await app.request("/api/sessions/sess-1/recording/start", { method: "POST" });
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.error).toContain("Recording not available");
  });

  it("POST /api/sessions/:id/recording/stop returns 501 when recorder is not available", async () => {
    const res = await app.request("/api/sessions/sess-1/recording/stop", { method: "POST" });
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.error).toContain("Recording not available");
  });

  it("GET /api/sessions/:id/recording/status returns unavailable when no recorder", async () => {
    const res = await app.request("/api/sessions/sess-1/recording/status");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recording).toBe(false);
    expect(data.available).toBe(false);
  });

  it("GET /api/recordings returns empty list when no recorder", async () => {
    const res = await app.request("/api/recordings");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recordings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Process kill endpoints
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:id/processes/:taskId/kill", () => {
  it("returns 400 for invalid task ID format", async () => {
    // Task IDs must be hex strings
    launcher.getSession.mockReturnValue({ pid: 1234 });
    const res = await app.request("/api/sessions/sess-1/processes/not-hex!/kill", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid task ID");
  });

  it("returns 404 when session does not exist", async () => {
    launcher.getSession.mockReturnValue(undefined);
    const res = await app.request("/api/sessions/nonexistent/processes/abcdef/kill", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 503 when session PID is unknown", async () => {
    launcher.getSession.mockReturnValue({ pid: null });
    const res = await app.request("/api/sessions/sess-1/processes/abcdef/kill", {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });

  it("kills process in container when session has containerId", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234, containerId: "cid123" });
    const execSpy = vi.spyOn(containerManager, "execInContainer").mockReturnValue("");

    const res = await app.request("/api/sessions/sess-1/processes/abcdef/kill", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(execSpy).toHaveBeenCalled();

    execSpy.mockRestore();
  });

  it("kills process on host when session has no container", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234 });
    // execFileSync is mocked at module level — the endpoint uses dynamic import
    const res = await app.request("/api/sessions/sess-1/processes/abcdef/kill", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

describe("POST /api/sessions/:id/processes/kill-all", () => {
  it("returns 404 when session does not exist", async () => {
    launcher.getSession.mockReturnValue(undefined);
    const res = await app.request("/api/sessions/nonexistent/processes/kill-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ["abc123"] }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects invalid task IDs and processes valid ones", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234 });
    const res = await app.request("/api/sessions/sess-1/processes/kill-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ["abc123", "not-valid!"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(2);
    // First one should succeed, second should fail validation
    expect(data.results[0].ok).toBe(true);
    expect(data.results[1].ok).toBe(false);
    expect(data.results[1].error).toContain("Invalid task ID");
  });

  it("kills processes in container when session has containerId", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234, containerId: "cid123" });
    const execSpy = vi.spyOn(containerManager, "execInContainer").mockReturnValue("");

    const res = await app.request("/api/sessions/sess-1/processes/kill-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ["abc123"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].ok).toBe(true);
    expect(execSpy).toHaveBeenCalled();

    execSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// System process kill endpoint
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:id/processes/system/:pid/kill", () => {
  it("returns 400 for invalid PID", async () => {
    const res = await app.request("/api/sessions/sess-1/processes/system/notanumber/kill", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid PID");
  });

  it("returns 404 when session does not exist", async () => {
    launcher.getSession.mockReturnValue(undefined);
    const res = await app.request("/api/sessions/sess-1/processes/system/9999/kill", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("refuses to kill the heyhank server process", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234 });
    const res = await app.request(`/api/sessions/sess-1/processes/system/${process.pid}/kill`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Cannot kill the HeyHank server");
  });

  it("refuses to kill the session's own CLI process", async () => {
    launcher.getSession.mockReturnValue({ pid: 5678 });
    const res = await app.request("/api/sessions/sess-1/processes/system/5678/kill", {
      method: "POST",
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Use the session kill endpoint");
  });

  it("kills process in container when session has containerId", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234, containerId: "cid123" });
    const execSpy = vi.spyOn(containerManager, "execInContainer").mockReturnValue("");

    const res = await app.request("/api/sessions/sess-1/processes/system/9999/kill", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith(
      "cid123",
      ["kill", "-TERM", "9999"],
      5_000,
    );

    execSpy.mockRestore();
  });

  it("kills process on host when session has no container", async () => {
    launcher.getSession.mockReturnValue({ pid: 1234 });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const res = await app.request("/api/sessions/sess-1/processes/system/9999/kill", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    killSpy.mockRestore();
  });
});

// ── Browser preview endpoints ─────────────────────────────────────────────────

describe("POST /api/sessions/:id/browser/start", () => {
  it("returns host mode for non-container sessions", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    const res = await app.request("/api/sessions/s1/browser/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: true,
      mode: "host",
    });
  });

  it("returns unavailable when container is missing", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue(undefined);

    const res = await app.request("/api/sessions/s1/browser/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: false,
      mode: "container",
    });
    expect(json.message).toContain("Container not found");
  });

  it("returns unavailable when Xvfb binary is missing", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 6080, hostPort: 49200 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    vi.spyOn(containerManager, "isContainerAlive").mockReturnValue("running");
    // Xvfb not found, websockify found
    vi.spyOn(containerManager, "hasBinaryInContainer").mockImplementation(
      (_cid: string, bin: string) => bin !== "Xvfb",
    );

    const res = await app.request("/api/sessions/s1/browser/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: false,
      mode: "container",
    });
    expect(json.message).toContain("Xvfb and noVNC");
  });

  it("starts display stack and returns proxied URL for container session", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 6080, hostPort: 49200 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    vi.spyOn(containerManager, "hasBinaryInContainer").mockReturnValue(true);
    vi.spyOn(containerManager, "isContainerAlive").mockReturnValue("running");
    const execSpy = vi.spyOn(containerManager, "execInContainerAsync").mockResolvedValue({ exitCode: 0, output: "" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await app.request("/api/sessions/s1/browser/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: true,
      mode: "container",
    });
    // URL should be a proxied path through the heyhank server
    expect(json.url).toContain("/api/sessions/s1/browser/proxy/vnc.html");
    expect(json.url).toContain("autoconnect=true");
    expect(json.url).toContain("path=ws/novnc/s1");
    // Should have called execInContainerAsync for the display stack and Chrome
    expect(execSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it("returns unavailable when noVNC polling times out", { timeout: 25_000 }, async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 6080, hostPort: 49200 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    vi.spyOn(containerManager, "hasBinaryInContainer").mockReturnValue(true);
    vi.spyOn(containerManager, "isContainerAlive").mockReturnValue("running");
    vi.spyOn(containerManager, "execInContainerAsync").mockResolvedValue({ exitCode: 0, output: "" });
    // Simulate noVNC never becoming ready — all fetches throw
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const res = await app.request("/api/sessions/s1/browser/start", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      available: false,
      mode: "container",
    });
    expect(json.message).toContain("timed out");
    fetchSpy.mockRestore();
  });

  it("rejects file:// URL scheme in browser/start", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 6080, hostPort: 49200 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    vi.spyOn(containerManager, "hasBinaryInContainer").mockReturnValue(true);
    vi.spyOn(containerManager, "isContainerAlive").mockReturnValue("running");
    vi.spyOn(containerManager, "execInContainerAsync").mockResolvedValue({ exitCode: 0, output: "" });

    const res = await app.request("/api/sessions/s1/browser/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ available: false });
    expect(json.message).toContain("http://");
  });
});

describe("POST /api/sessions/:id/browser/navigate", () => {
  it("returns 404 when session not found", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/s1/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:3000" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for non-container session", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    const res = await app.request("/api/sessions/s1/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:3000" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects file:// URL scheme", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });

    const res = await app.request("/api/sessions/s1/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("http://");
  });

  it("navigates Chrome to the given URL", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    const execSpy = vi.spyOn(containerManager, "execInContainerAsync").mockResolvedValue({ exitCode: 0, output: "" });

    const res = await app.request("/api/sessions/s1/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:3000" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, url: "http://localhost:3000" });
    expect(execSpy).toHaveBeenCalledWith(
      "cid-1",
      expect.arrayContaining(["sh", "-c"]),
      { timeout: 10_000 },
    );
  });
});

describe("GET /api/sessions/:id/browser/proxy/*", () => {
  it("returns 404 when session not found", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/s1/browser/proxy/vnc.html");

    expect(res.status).toBe(404);
  });

  it("returns 400 for non-container session", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    const res = await app.request("/api/sessions/s1/browser/proxy/vnc.html");

    expect(res.status).toBe(400);
  });

  it("proxies request to container noVNC server", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
      containerId: "cid-1",
    });
    vi.spyOn(containerManager, "getContainer").mockReturnValue({
      containerId: "cid-1",
      name: "heyhank-s1",
      image: "heyhank:latest",
      portMappings: [{ containerPort: 6080, hostPort: 49200 }],
      hostCwd: "/repo",
      containerCwd: "/workspace",
      state: "running",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>noVNC</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const res = await app.request("/api/sessions/s1/browser/proxy/vnc.html?autoconnect=true");

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("<html>noVNC</html>");
    // fetch should have been called with the container's mapped port
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:49200/vnc.html"),
    );
    fetchSpy.mockRestore();
  });
});

describe("GET /api/sessions/:id/browser/host-proxy/:port/*", () => {
  it("returns 404 when session not found", async () => {
    launcher.getSession.mockReturnValue(undefined);

    const res = await app.request("/api/sessions/s1/browser/host-proxy/3000/index.html");

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid port", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    const res = await app.request("/api/sessions/s1/browser/host-proxy/99999/index.html");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid port");
  });

  it("returns 400 for non-numeric port", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    const res = await app.request("/api/sessions/s1/browser/host-proxy/abc/index.html");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid port");
  });

  // Security: Hono's router resolves literal ".." and "%2e%2e" before matching,
  // returning 404 automatically. Our handler adds a defense-in-depth check for
  // real HTTP servers where encoded traversal may bypass router normalization.
  it("Hono blocks path traversal at router level (returns 404 not route match)", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    // Both literal and encoded ".." are resolved by Hono's router before matching
    const res = await app.request("/api/sessions/s1/browser/host-proxy/3000/%2e%2e/%2e%2e/etc/passwd");
    expect(res.status).toBe(404);
  });

  // Security: block proxying to the heyhank server itself (would bypass remote auth)
  it("rejects proxying to the heyhank server port", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    // Default dev port is 3457
    const res = await app.request("/api/sessions/s1/browser/host-proxy/3457/api/sessions");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Port not allowed");
  });

  it("blocks well-known sensitive service ports", async () => {
    // Sensitive ports (databases, caches, mail) should be blocked to limit SSRF
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });

    for (const blockedPort of [5432, 3306, 6379, 27017]) {
      const res = await app.request(`/api/sessions/s1/browser/host-proxy/${blockedPort}/`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Port not allowed");
    }
  });

  it("proxies request to localhost on the given port", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>App</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const res = await app.request("/api/sessions/s1/browser/host-proxy/3000/index.html");

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("<html>App</html>");
    // fetch should target 127.0.0.1 with the specified port and sub-path
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/index.html",
      expect.objectContaining({ redirect: "follow" }),
    );
    fetchSpy.mockRestore();
  });

  it("forwards query string to upstream", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const res = await app.request("/api/sessions/s1/browser/host-proxy/5173/assets/main.js?v=123");

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/assets/main.js?v=123",
      expect.objectContaining({ redirect: "follow" }),
    );
    fetchSpy.mockRestore();
  });

  // Error message should be generic to avoid leaking internal network info
  it("returns generic 502 when upstream is unreachable", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "s1",
      state: "running",
      cwd: "/repo",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection refused"),
    );

    const res = await app.request("/api/sessions/s1/browser/host-proxy/9999/");

    expect(res.status).toBe(502);
    const json = await res.json();
    // Should NOT leak the raw error message (e.g. "Connection refused 127.0.0.1:9999")
    expect(json.error).toBe("Proxy failed: upstream unreachable");
    fetchSpy.mockRestore();
  });
});
