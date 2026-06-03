import type { SdkSessionInfo } from "./types.js";
import type { ContentBlock } from "./types.js";
import { captureEvent, captureException } from "./analytics.js";

const BASE = "/api";
const AUTH_STORAGE_KEY = "heyhank_auth_token";

function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// Tracks an in-flight token re-verification so that a burst of failed requests
// (the sidebar polls listSessions every few seconds, plus draft counts every
// 30s, plus update checks) does not trigger N parallel /auth/verify probes
// and N parallel logouts.
let inflightAuthRecheck: Promise<void> | null = null;

function handle401(status: number): void {
  if (status !== 401 && status !== 403) return;
  if (typeof window === "undefined") return;
  const token = localStorage.getItem(AUTH_STORAGE_KEY);
  // No token to verify — fall through to a normal logout.
  if (!token) {
    triggerLogout();
    return;
  }
  if (inflightAuthRecheck) return;
  // Re-verify the token explicitly before wiping it. A 401/403 from any
  // arbitrary endpoint is not a reliable signal that the token is bad — it
  // could be a transient backend hiccup or an endpoint-specific check. Only
  // log out when the dedicated /auth/verify endpoint also rejects the token.
  inflightAuthRecheck = verifyAuthToken(token)
    .then((isValid) => {
      if (!isValid) triggerLogout();
    })
    .catch(() => {
      // Network error during re-verify — assume token is still good; another
      // failed request will retry the check on the next 401/403.
    })
    .finally(() => {
      inflightAuthRecheck = null;
    });
}

function triggerLogout(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  // Dynamic import to avoid circular dependency
  import("./store.js").then(({ useStore }) => {
    useStore.getState().logout();
  }).catch(() => {});
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function trackApiSuccess(method: string, path: string, durationMs: number, status: number): void {
  captureEvent("api_request_succeeded", {
    method,
    path,
    status,
    duration_ms: Math.round(durationMs),
  });
}

function trackApiFailure(
  method: string,
  path: string,
  durationMs: number,
  error: unknown,
  status?: number,
): void {
  captureEvent("api_request_failed", {
    method,
    path,
    status,
    duration_ms: Math.round(durationMs),
    error: error instanceof Error ? error.message : String(error),
  });
  captureException(error, { method, path, status });
}

async function post<T = unknown>(path: string, body?: object): Promise<T> {
  const startedAt = nowMs();
  let failureTracked = false;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || res.statusText);
      trackApiFailure("POST", path, nowMs() - startedAt, apiError, res.status);
      failureTracked = true;
      throw apiError;
    }
    trackApiSuccess("POST", path, nowMs() - startedAt, res.status);
    return res.json();
  } catch (error) {
    if (!failureTracked) {
      trackApiFailure("POST", path, nowMs() - startedAt, error);
    }
    throw error;
  }
}

async function get<T = unknown>(path: string): Promise<T> {
  const startedAt = nowMs();
  let failureTracked = false;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || res.statusText);
      trackApiFailure("GET", path, nowMs() - startedAt, apiError, res.status);
      failureTracked = true;
      throw apiError;
    }
    trackApiSuccess("GET", path, nowMs() - startedAt, res.status);
    return res.json();
  } catch (error) {
    if (!failureTracked) {
      trackApiFailure("GET", path, nowMs() - startedAt, error);
    }
    throw error;
  }
}

async function put<T = unknown>(path: string, body?: object): Promise<T> {
  const startedAt = nowMs();
  let failureTracked = false;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || res.statusText);
      trackApiFailure("PUT", path, nowMs() - startedAt, apiError, res.status);
      failureTracked = true;
      throw apiError;
    }
    trackApiSuccess("PUT", path, nowMs() - startedAt, res.status);
    return res.json();
  } catch (error) {
    if (!failureTracked) {
      trackApiFailure("PUT", path, nowMs() - startedAt, error);
    }
    throw error;
  }
}

async function patch<T = unknown>(path: string, body?: object): Promise<T> {
  const startedAt = nowMs();
  let failureTracked = false;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || res.statusText);
      trackApiFailure("PATCH", path, nowMs() - startedAt, apiError, res.status);
      failureTracked = true;
      throw apiError;
    }
    trackApiSuccess("PATCH", path, nowMs() - startedAt, res.status);
    return res.json();
  } catch (error) {
    if (!failureTracked) {
      trackApiFailure("PATCH", path, nowMs() - startedAt, error);
    }
    throw error;
  }
}

async function del<T = unknown>(path: string, body?: object): Promise<T> {
  const startedAt = nowMs();
  let failureTracked = false;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...getAuthHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || res.statusText);
      trackApiFailure("DELETE", path, nowMs() - startedAt, apiError, res.status);
      failureTracked = true;
      throw apiError;
    }
    trackApiSuccess("DELETE", path, nowMs() - startedAt, res.status);
    return res.json();
  } catch (error) {
    if (!failureTracked) {
      trackApiFailure("DELETE", path, nowMs() - startedAt, error);
    }
    throw error;
  }
}

export interface ContainerCreateOpts {
  image?: string;
  ports?: number[];
  volumes?: string[];
  env?: Record<string, string>;
}

export interface ContainerStatus {
  available: boolean;
  version: string | null;
}

export interface CloudProviderPlan {
  provider: "modal";
  sessionId: string;
  image: string;
  cwd: string;
  mappedPorts: Array<{ containerPort: number; hostPort: number }>;
  commandPreview: string;
}

export interface CreateSessionOpts {
  model?: string;
  permissionMode?: string;
  cwd?: string;
  claudeBinary?: string;
  codexBinary?: string;
  codexInternetAccess?: boolean;
  allowedTools?: string[];
  envSlug?: string;
  branch?: string;
  createBranch?: boolean;
  useWorktree?: boolean;
  backend?: string;
  sandboxEnabled?: boolean;
  sandboxSlug?: string;
  container?: ContainerCreateOpts;
  resumeSessionAt?: string;
  forkSession?: boolean;
}

export interface BackendInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface BackendModelInfo {
  value: string;
  label: string;
  description: string;
}

export interface ClaudeDiscoveredSession {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  slug?: string;
  lastActivityAt: number;
  sourceFile: string;
}

export interface ClaudeSessionHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: number;
  model?: string;
  stopReason?: string | null;
}

export interface ClaudeSessionHistoryPage {
  sourceFile: string;
  messages: ClaudeSessionHistoryMessage[];
  nextCursor: number;
  hasMore: boolean;
  totalMessages: number;
}

export interface GitRepoInfo {
  repoRoot: string;
  repoName: string;
  currentBranch: string;
  defaultBranch: string;
  isWorktree: boolean;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  worktreePath: string | null;
  ahead: number;
  behind: number;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMainWorktree: boolean;
  isDirty: boolean;
}

export interface WorktreeCreateResult {
  worktreePath: string;
  branch: string;
  isNew: boolean;
}

export interface HeyHankEnv {
  name: string;
  slug: string;
  variables: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface HeyHankSandbox {
  name: string;
  slug: string;
  initScript?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImagePullState {
  image: string;
  status: "idle" | "pulling" | "ready" | "error";
  progress: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListResult {
  path: string;
  dirs: DirEntry[];
  home: string;
  error?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  isServiceMode: boolean;
  updateInProgress: boolean;
  lastChecked: number;
  channel: "stable" | "prerelease";
}

export interface UsageLimits {
  five_hour: { utilization: number; resets_at: string | null } | null;
  seven_day: { utilization: number; resets_at: string | null } | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number | null;
  } | null;
}

export interface EditorStartResult {
  available: boolean;
  installed: boolean;
  mode: "host" | "container";
  url?: string;
  message?: string;
}

export interface BrowserStartResult {
  available: boolean;
  mode: "host" | "container";
  url?: string;
  message?: string;
}

/** Keep in sync with web/server/tailscale-manager.ts TailscaleStatus */
export interface TailscaleStatus {
  installed: boolean;
  binaryPath: string | null;
  connected: boolean;
  dnsName: string | null;
  funnelActive: boolean;
  funnelUrl: string | null;
  error: string | null;
  needsOperatorMode?: boolean;
  warning?: string;
}

export interface AppSettings {
  anthropicApiKeyConfigured: boolean;
  anthropicModel: string;
  claudeCodeOAuthTokenConfigured: boolean;
  openaiApiKeyConfigured: boolean;
  codexDeviceAuthConfigured: boolean;
  onboardingCompleted: boolean;
  geminiApiKeyConfigured: boolean;
  geminiVoice: string;
  assistantName: string;
  userName: string;
  editorTabEnabled: boolean;
  internalAiProvider: string;
  aiValidationEnabled: boolean;
  aiValidationAutoApprove: boolean;
  aiValidationAutoDeny: boolean;
  publicUrl: string;
  updateChannel: "stable" | "prerelease";
  dockerAutoUpdate: boolean;
  hankChatProvider: string;
  hankChatModel: string;
  hankChatAvatarEnabled: boolean;
  hankChatAvatarUrl: string;
  openrouterApiKeyConfigured: boolean;
  /** Enhanced Claude CLI auth detection */
  claudeCliAuth?: { installed: boolean; loggedIn: boolean; oauthTokenConfigured: boolean; cliVersion: string | null };
  /** Enhanced Codex CLI auth detection */
  codexCliAuth?: { installed: boolean; loggedIn: boolean; apiKeyConfigured: boolean; cliVersion: string | null };
}

export interface ArchiveInfo {
  hasLinkedIssue: boolean;
  issueNotDone: boolean;
}

export interface GitHubPRInfo {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; status: string; conclusion: string | null }[];
  checksSummary: { total: number; success: number; failure: number; pending: number };
  reviewThreads: { total: number; resolved: number; unresolved: number };
}

export interface PRStatusResponse {
  available: boolean;
  pr: GitHubPRInfo | null;
}

export interface CronJobInfo {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  recurring: boolean;
  backendType: "claude" | "codex";
  model: string;
  cwd: string;
  envSlug?: string;
  enabled: boolean;
  permissionMode: string;
  codexInternetAccess?: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastSessionId?: string;
  consecutiveFailures: number;
  totalRuns: number;
  nextRunAt?: number | null;
}

export interface CronJobExecution {
  sessionId: string;
  jobId: string;
  startedAt: number;
  completedAt?: number;
  success?: boolean;
  error?: string;
  costUsd?: number;
}

export interface McpServerConfigAgent {
  type: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface AgentInfo {
  id: string;
  version: 1;
  name: string;
  description: string;
  icon?: string;
  backendType: "claude" | "codex";
  model: string;
  permissionMode: string;
  cwd: string;
  envSlug?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  codexInternetAccess?: boolean;
  prompt: string;
  mcpServers?: Record<string, McpServerConfigAgent>;
  skills?: string[];
  container?: {
    image?: string;
    ports?: number[];
    volumes?: string[];
    initScript?: string;
  };
  branch?: string;
  createBranch?: boolean;
  useWorktree?: boolean;
  triggers?: {
    webhook?: {
      enabled: boolean;
      secret: string;
    };
    schedule?: {
      enabled: boolean;
      expression: string;
      recurring: boolean;
    };
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastSessionId?: string;
  totalRuns: number;
  consecutiveFailures: number;
  nextRunAt?: number | null;
}

export interface AgentExecution {
  sessionId: string;
  agentId: string;
  triggerType: "manual" | "webhook" | "schedule";
  startedAt: number;
  completedAt?: number;
  success?: boolean;
  error?: string;
}

export interface ExecutionListResult {
  executions: AgentExecution[];
  total: number;
}

/** Portable export format (no internal tracking fields) */
export type AgentExport = Omit<
  AgentInfo,
  "id" | "createdAt" | "updatedAt" | "totalRuns" | "consecutiveFailures" | "lastRunAt" | "lastSessionId" | "enabled" | "nextRunAt"
>;

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  scope: "global" | "project";
  projectPath?: string;
  projectPaths?: string[];
  createdAt: number;
  updatedAt: number;
}

// ─── Platform Types ─────────────────────────────────────────────────────────

export interface PlatformMessage {
  id: string;
  from: string;
  fromName?: string;
  to?: string;
  channel?: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readBy: string[];
}

export interface CostRecord {
  agentId: string;
  agentName: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  createdAt: string;
  closedAt: string | null;
}

export interface CostSummary {
  allTimeCost: number;
  allTimeTokensIn: number;
  allTimeTokensOut: number;
  totalRecords: number;
}

export interface KillSwitchState {
  killed: boolean;
  reason?: string;
  activatedAt?: string;
}

export interface SharedContextFile {
  filename: string;
  content: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface LLMProvider {
  name: string;
  status: string;
  models?: string[];
  endpoint?: string;
  note?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  provider: string;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCost?: number;
}

export interface AutoApproveRule {
  agentId: string;
  allowedTools: string[];
  deniedTools: string[];
  autoApproveSafe: boolean;
  autoDenyDangerous: boolean;
  maxCostPerAction?: number;
}

// ─── Claude Config Browser ──────────────────────────────────────────────────

export interface ClaudeConfigResponse {
  project: {
    root: string;
    claudeMd: { path: string; content: string }[];
    settings: { path: string; content: string } | null;
    settingsLocal: { path: string; content: string } | null;
    commands: { name: string; path: string }[];
  };
  user: {
    root: string;
    claudeMd: { path: string; content: string } | null;
    skills: { slug: string; name: string; description: string; path: string }[];
    agents: { name: string; path: string }[];
    settings: { path: string; content: string } | null;
    commands: { name: string; path: string }[];
  };
}

// ─── SSE Session Creation ────────────────────────────────────────────────────

export interface CreationProgressEvent {
  step: string;
  label: string;
  status: "in_progress" | "done" | "error";
  detail?: string;
}

export interface CreateSessionStreamResult {
  sessionId: string;
  state: string;
  cwd: string;
  backendType?: "claude" | "codex";
  resumeSessionAt?: string;
  forkSession?: boolean;
}

/**
 * Create a session with real-time progress streaming via SSE.
 * Uses fetch + ReadableStream (EventSource is GET-only, this is POST).
 */
export async function createSessionStream(
  opts: CreateSessionOpts | undefined,
  onProgress: (progress: CreationProgressEvent) => void,
): Promise<CreateSessionStreamResult> {
  const res = await fetch(`${BASE}/sessions/create-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(opts ?? {}),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: CreateSessionStreamResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events: split on double newlines
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      let eventType = "";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      if (!data) continue;

      const parsed = JSON.parse(data);
      if (eventType === "progress") {
        onProgress(parsed as CreationProgressEvent);
      } else if (eventType === "done") {
        result = parsed as CreateSessionStreamResult;
      } else if (eventType === "error") {
        throw new Error((parsed as { error: string }).error || "Session creation failed");
      }
    }
  }

  if (!result) {
    throw new Error("Stream ended without session creation result");
  }

  return result;
}

/**
 * Verify an auth token with the server.
 * This does NOT use the auth header helpers since it's called before auth is established.
 */
/**
 * Attempt auto-authentication for localhost users.
 * The server returns the token if the request comes from 127.0.0.1/::1.
 * No auth header needed — this is a pre-auth endpoint.
 */
export async function autoAuth(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/auth/auto`);
    if (res.ok) {
      const data = await res.json() as { ok: boolean; token?: string };
      if (data.ok && data.token) return data.token;
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyAuthToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      const data = await res.json();
      return !!(data as { ok?: boolean }).ok;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Federation Types ──────────────────────────────────────────────────────
export interface FederationNodeStatus {
  id: string;
  url: string;
  name: string;
  secret?: string;
  connected: boolean;
  inboundConnected: boolean;
  remoteNodeId: string | null;
  remoteName: string | null;
  sessionCount: number;
  addedAt: string;
}

export interface FederationRemoteSession {
  sessionId: string;
  name?: string;
  model?: string;
  cwd?: string;
  status?: string;
  backendType?: string;
  isConnected?: boolean;
  nodeId: string;
  nodeName: string;
}

export const api = {
  // Auth
  getAuthQr: () =>
    get<{ qrCodes: { label: string; url: string; qrDataUrl: string }[] }>("/auth/qr"),
  getAuthToken: () =>
    get<{ token: string }>("/auth/token"),
  regenerateAuthToken: () =>
    post<{ token: string }>("/auth/regenerate"),

  createSession: (opts?: CreateSessionOpts) =>
    post<{ sessionId: string; state: string; cwd: string }>(
      "/sessions/create",
      opts,
    ),

  listSessions: () => get<SdkSessionInfo[]>("/sessions"),
  searchSessions: (query: string) =>
    get<{ results: Array<{ sessionId: string; sessionName: string; matches: Array<{ role: string; text: string; timestamp?: number }> }>; query: string }>(
      `/sessions/search?q=${encodeURIComponent(query)}`,
    ),
  discoverClaudeSessions: (limit = 200) =>
    get<{ sessions: ClaudeDiscoveredSession[] }>(
      `/claude/sessions/discover?limit=${encodeURIComponent(String(limit))}`,
    ),
  getClaudeSessionHistory: (sessionId: string, opts?: { cursor?: number; limit?: number }) => {
    const cursor = Math.max(0, Math.floor(opts?.cursor ?? 0));
    const limit = Math.max(1, Math.floor(opts?.limit ?? 40));
    return get<ClaudeSessionHistoryPage>(
      `/claude/sessions/${encodeURIComponent(sessionId)}/history?cursor=${encodeURIComponent(String(cursor))}&limit=${encodeURIComponent(String(limit))}`,
    );
  },

  killSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/kill`),

  deleteSession: (sessionId: string) =>
    del(`/sessions/${encodeURIComponent(sessionId)}`),

  relaunchSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/relaunch`),

  archiveSession: (sessionId: string, opts?: { force?: boolean }) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/archive`, opts),

  getArchiveInfo: (sessionId: string) =>
    get<ArchiveInfo>(`/sessions/${encodeURIComponent(sessionId)}/archive-info`),

  unarchiveSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/unarchive`),

  renameSession: (sessionId: string, name: string) =>
    patch<{ ok: boolean; name: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/name`,
      { name },
    ),

  listDirs: (path?: string) =>
    get<DirListResult>(
      `/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),

  getHome: () => get<{ home: string; cwd: string }>("/fs/home"),

  // Environments
  listEnvs: () => get<HeyHankEnv[]>("/envs"),
  getEnv: (slug: string) =>
    get<HeyHankEnv>(`/envs/${encodeURIComponent(slug)}`),
  createEnv: (name: string, variables: Record<string, string>) =>
    post<HeyHankEnv>("/envs", { name, variables }),
  updateEnv: (
    slug: string,
    data: {
      name?: string;
      variables?: Record<string, string>;
    },
  ) => put<HeyHankEnv>(`/envs/${encodeURIComponent(slug)}`, data),
  deleteEnv: (slug: string) => del(`/envs/${encodeURIComponent(slug)}`),

  // Sandboxes
  listSandboxes: () => get<HeyHankSandbox[]>("/sandboxes"),
  getSandbox: (slug: string) =>
    get<HeyHankSandbox>(`/sandboxes/${encodeURIComponent(slug)}`),
  createSandbox: (name: string, opts?: { initScript?: string }) =>
    post<HeyHankSandbox>("/sandboxes", { name, ...opts }),
  updateSandbox: (
    slug: string,
    data: {
      name?: string;
      initScript?: string;
    },
  ) => put<HeyHankSandbox>(`/sandboxes/${encodeURIComponent(slug)}`, data),
  deleteSandbox: (slug: string) => del(`/sandboxes/${encodeURIComponent(slug)}`),
  testInitScript: (slug: string, cwd: string, initScript?: string) =>
    post<{ success: boolean; exitCode: number; output: string }>(
      `/sandboxes/${encodeURIComponent(slug)}/test-init`,
      { cwd, initScript },
    ),

  buildBaseImage: () =>
    post<{ ok: boolean; tag: string }>("/docker/build-base"),
  getBaseImageStatus: () =>
    get<{ exists: boolean; tag: string }>("/docker/base-image"),

  // Settings
  getSettings: () => get<AppSettings>("/settings"),
  updateSettings: (data: {
    anthropicApiKey?: string;
    anthropicModel?: string;
    claudeCodeOAuthToken?: string;
    openaiApiKey?: string;
    onboardingCompleted?: boolean;
    geminiApiKey?: string;
    geminiVoice?: string;
    assistantName?: string;
    userName?: string;
    editorTabEnabled?: boolean;
    internalAiProvider?: string;
    aiValidationEnabled?: boolean;
    aiValidationAutoApprove?: boolean;
    aiValidationAutoDeny?: boolean;
    publicUrl?: string;
    updateChannel?: "stable" | "prerelease";
    dockerAutoUpdate?: boolean;
    hankChatProvider?: string;
    hankChatModel?: string;
    hankChatAvatarEnabled?: boolean;
    hankChatAvatarUrl?: string;
    obsidianVaultPath?: string;
  }) => put<AppSettings>("/settings", data),
  verifyAnthropicKey: (apiKey: string) =>
    post<{ valid: boolean; error?: string }>("/settings/anthropic/verify", { apiKey }),

  // Tailscale
  getTailscaleStatus: () => get<TailscaleStatus>("/tailscale/status"),
  startTailscaleFunnel: () => post<TailscaleStatus>("/tailscale/funnel/start"),
  stopTailscaleFunnel: () => post<TailscaleStatus>("/tailscale/funnel/stop"),

  // Git operations
  getRepoInfo: (path: string) =>
    get<GitRepoInfo>(`/git/repo-info?path=${encodeURIComponent(path)}`),
  listBranches: (repoRoot: string) =>
    get<GitBranchInfo[]>(
      `/git/branches?repoRoot=${encodeURIComponent(repoRoot)}`,
    ),
  gitFetch: (repoRoot: string) =>
    post<{ success: boolean; output: string }>("/git/fetch", { repoRoot }),
  gitPull: (cwd: string) =>
    post<{
      success: boolean;
      output: string;
      git_ahead: number;
      git_behind: number;
    }>("/git/pull", { cwd }),

  // Git worktrees
  listWorktrees: (repoRoot: string) =>
    get<GitWorktreeInfo[]>(
      `/git/worktrees?repoRoot=${encodeURIComponent(repoRoot)}`,
    ),
  createWorktree: (
    repoRoot: string,
    branch: string,
    opts?: { baseBranch?: string; createBranch?: boolean },
  ) =>
    post<WorktreeCreateResult>("/git/worktree", {
      repoRoot,
      branch,
      ...opts,
    }),
  removeWorktree: (repoRoot: string, worktreePath: string, force?: boolean) =>
    del("/git/worktree", { repoRoot, worktreePath, force }),

  // GitHub PR status
  getPRStatus: (cwd: string, branch: string) =>
    get<PRStatusResponse>(
      `/git/pr-status?cwd=${encodeURIComponent(cwd)}&branch=${encodeURIComponent(branch)}`,
    ),

  // Backends
  getBackends: () => get<BackendInfo[]>("/backends"),
  getBackendModels: (backendId: string) =>
    get<BackendModelInfo[]>(`/backends/${encodeURIComponent(backendId)}/models`),

  // Containers
  getContainerStatus: () => get<ContainerStatus>("/containers/status"),
  getContainerImages: () => get<string[]>("/containers/images"),

  // Image pull manager
  getImageStatus: (tag: string) =>
    get<ImagePullState>(`/images/${encodeURIComponent(tag)}/status`),
  pullImage: (tag: string) =>
    post<{ ok: boolean; state: ImagePullState }>(`/images/${encodeURIComponent(tag)}/pull`),
  getCloudProviderPlan: (provider: "modal", cwd: string, sessionId: string) =>
    get<CloudProviderPlan>(
      `/cloud/providers/${encodeURIComponent(provider)}/plan?cwd=${encodeURIComponent(cwd)}&sessionId=${encodeURIComponent(sessionId)}`,
    ),

  // Editor
  startEditor: (sessionId: string) =>
    post<EditorStartResult>(
      `/sessions/${encodeURIComponent(sessionId)}/editor/start`,
    ),

  // Browser preview
  startBrowser: (sessionId: string, url?: string) =>
    post<BrowserStartResult>(
      `/sessions/${encodeURIComponent(sessionId)}/browser/start`,
      url ? { url } : undefined,
    ),
  navigateBrowser: (sessionId: string, url: string) =>
    post<{ ok?: boolean; error?: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/browser/navigate`,
      { url },
    ),

  // Editor filesystem
  getFileTree: (path: string) =>
    get<{ path: string; tree: TreeNode[] }>(
      `/fs/tree?path=${encodeURIComponent(path)}`,
    ),
  readFile: (path: string) =>
    get<{ path: string; content: string }>(
      `/fs/read?path=${encodeURIComponent(path)}`,
    ),
  getFileBlob: async (path: string): Promise<string> => {
    const res = await fetch(`${BASE}/fs/raw?path=${encodeURIComponent(path)}`, {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      handle401(res.status);
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error || res.statusText);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  writeFile: (path: string, content: string) =>
    put<{ ok: boolean; path: string }>("/fs/write", { path, content }),
  getFileDiff: (path: string, base?: "last-commit" | "default-branch") =>
    get<{ path: string; diff: string }>(
      `/fs/diff?path=${encodeURIComponent(path)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
    ),
  getChangedFiles: (cwd: string, base?: "last-commit" | "default-branch") =>
    get<{ files: Array<{ path: string; status: string }> }>(
      `/fs/changed-files?cwd=${encodeURIComponent(cwd)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
    ),
  getClaudeMdFiles: (cwd: string) =>
    get<{ cwd: string; files: { path: string; content: string }[] }>(
      `/fs/claude-md?cwd=${encodeURIComponent(cwd)}`,
    ),
  saveClaudeMd: (path: string, content: string) =>
    put<{ ok: boolean; path: string }>("/fs/claude-md", { path, content }),
  getClaudeConfig: (cwd: string) =>
    get<ClaudeConfigResponse>(`/fs/claude-config?cwd=${encodeURIComponent(cwd)}`),

  // Usage limits
  getUsageLimits: () => get<UsageLimits>("/usage-limits"),
  getSessionUsageLimits: (sessionId: string) =>
    get<UsageLimits>(`/sessions/${encodeURIComponent(sessionId)}/usage-limits`),

  // Terminal
  spawnTerminal: (cwd: string, cols?: number, rows?: number, opts?: { containerId?: string }) =>
    post<{ terminalId: string }>("/terminal/spawn", { cwd, cols, rows, containerId: opts?.containerId }),
  killTerminal: (terminalId: string) =>
    post<{ ok: boolean }>("/terminal/kill", { terminalId }),
  getTerminal: (terminalId?: string) =>
    get<{ active: boolean; terminalId?: string; cwd?: string }>(
      terminalId
        ? `/terminal?terminalId=${encodeURIComponent(terminalId)}`
        : "/terminal",
    ),

  // Update checking
  checkForUpdate: () => get<UpdateInfo>("/update-check"),
  forceCheckForUpdate: () => post<UpdateInfo>("/update-check"),
  triggerUpdate: () =>
    post<{ ok: boolean; message: string }>("/update"),

  // Cron jobs
  listCronJobs: () => get<CronJobInfo[]>("/cron/jobs"),
  getCronJob: (id: string) => get<CronJobInfo>(`/cron/jobs/${encodeURIComponent(id)}`),
  createCronJob: (data: Partial<CronJobInfo>) => post<CronJobInfo>("/cron/jobs", data),
  updateCronJob: (id: string, data: Partial<CronJobInfo>) =>
    put<CronJobInfo>(`/cron/jobs/${encodeURIComponent(id)}`, data),
  deleteCronJob: (id: string) => del(`/cron/jobs/${encodeURIComponent(id)}`),
  toggleCronJob: (id: string) => post<CronJobInfo>(`/cron/jobs/${encodeURIComponent(id)}/toggle`),
  runCronJob: (id: string) => post(`/cron/jobs/${encodeURIComponent(id)}/run`),
  getCronJobExecutions: (id: string) =>
    get<CronJobExecution[]>(`/cron/jobs/${encodeURIComponent(id)}/executions`),

  // Background process management
  killProcess: (sessionId: string, taskId: string) =>
    post<{ ok: boolean; taskId: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(taskId)}/kill`,
    ),
  killAllProcesses: (sessionId: string, taskIds: string[]) =>
    post<{ ok: boolean; results: { taskId: string; ok: boolean; error?: string }[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/processes/kill-all`,
      { taskIds },
    ),

  // System dev process scanning
  getSystemProcesses: (sessionId: string) =>
    get<{ ok: boolean; processes: { pid: number; command: string; fullCommand: string; ports: number[]; cwd?: string; startedAt?: number }[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/processes/system`,
    ),
  killSystemProcess: (sessionId: string, pid: number) =>
    post<{ ok: boolean; pid: number }>(
      `/sessions/${encodeURIComponent(sessionId)}/processes/system/${pid}/kill`,
    ),

  // Agents
  listAgents: () => get<AgentInfo[]>("/agents"),
  getAgent: (id: string) => get<AgentInfo>(`/agents/${encodeURIComponent(id)}`),
  createAgent: (data: Partial<AgentInfo> & { stagingId?: string; cloneFromAgentId?: string }) =>
    post<AgentInfo>("/agents", data),
  updateAgent: (id: string, data: Partial<AgentInfo>) =>
    put<AgentInfo>(`/agents/${encodeURIComponent(id)}`, data),
  deleteAgent: (id: string) => del(`/agents/${encodeURIComponent(id)}`),
  toggleAgent: (id: string) => post<AgentInfo>(`/agents/${encodeURIComponent(id)}/toggle`),
  runAgent: (id: string, input?: string) =>
    post<{ ok: boolean; message: string; sessionId: string | null; agentName?: string }>(
      `/agents/${encodeURIComponent(id)}/run`,
      { input },
    ),
  getAgentExecutions: (id: string) =>
    get<AgentExecution[]>(`/agents/${encodeURIComponent(id)}/executions`),
  importAgent: (data: AgentExport) => post<AgentInfo>("/agents/import", data),
  exportAgent: (id: string) => get<AgentExport>(`/agents/${encodeURIComponent(id)}/export`),
  regenerateAgentWebhookSecret: (id: string) =>
    post<AgentInfo>(`/agents/${encodeURIComponent(id)}/regenerate-secret`),

  // Executions (cross-agent, for Runs view)
  listExecutions: (opts?: { agentId?: string; triggerType?: string; status?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.agentId) params.set("agentId", opts.agentId);
    if (opts?.triggerType) params.set("triggerType", opts.triggerType);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return get<ExecutionListResult>(`/executions${qs ? `?${qs}` : ""}`);
  },

  cancelExecution: (sessionId: string, reason?: string) =>
    post<{ ok: boolean; wasLive: boolean }>(
      `/executions/${encodeURIComponent(sessionId)}/cancel`,
      reason ? { reason } : undefined,
    ),

  deleteExecution: (sessionId: string) =>
    del<{ ok: boolean; removed: number }>(`/executions/${encodeURIComponent(sessionId)}`),

  bulkDeleteExecutions: (opts: { sessionIds?: string[]; status?: "success" | "error" }) =>
    post<{ ok: boolean; removed: number }>(`/executions/bulk-delete`, opts),

  // Skills
  listSkills: () =>
    get<{ slug: string; name: string; description: string; path: string }[]>("/skills"),
  deleteSkill: (slug: string) =>
    del<{ ok: boolean; slug: string }>(`/skills/${encodeURIComponent(slug)}`),

  // Skill Marketplace
  marketplaceListSources: () =>
    get<{ id: string; name: string; owner: string; url: string; description: string }[]>(
      "/marketplace/sources",
    ),
  marketplaceListSkills: (sourceId: string) =>
    get<{ slug: string; name: string; description: string; sourceId: string }[]>(
      `/marketplace/sources/${encodeURIComponent(sourceId)}/skills`,
    ),
  marketplaceInstall: (sourceId: string, slug: string, overwrite = false) =>
    post<{ ok: true; slug: string; path: string }>("/marketplace/install", {
      sourceId,
      slug,
      overwrite,
    }),
  marketplaceInstalledMeta: (slug: string) =>
    get<{ sourceId: string; slug: string; ghOwner: string; ghRepo: string; branch: string; installedAt: string } | null>(
      `/marketplace/installed/${encodeURIComponent(slug)}`,
    ),

  // Cross-session messaging
  sendSessionMessage: (sessionId: string, content: string) =>
    post<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/message`, { content }),

  // Saved prompts
  listPrompts: (cwd?: string, scope?: "global" | "project" | "all") => {
    const params = new URLSearchParams();
    if (cwd) params.set("cwd", cwd);
    if (scope) params.set("scope", scope);
    const query = params.toString();
    return get<SavedPrompt[]>(`/prompts${query ? `?${query}` : ""}`);
  },
  createPrompt: (data: { name: string; content: string; scope: "global" | "project"; cwd?: string; projectPaths?: string[] }) =>
    post<SavedPrompt>("/prompts", data),
  updatePrompt: (id: string, data: { name?: string; content?: string; scope?: "global" | "project"; projectPaths?: string[] }) =>
    put<SavedPrompt>(`/prompts/${encodeURIComponent(id)}`, data),
  deletePrompt: (id: string) =>
    del<{ ok: boolean }>(`/prompts/${encodeURIComponent(id)}`),

  // ─── Platform: Message Bus ──────────────────────────────────────────
  listMessages: (opts?: { to?: string; from?: string; channel?: string; type?: string; unreadBy?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.to) params.set("to", opts.to);
    if (opts?.from) params.set("from", opts.from);
    if (opts?.channel) params.set("channel", opts.channel);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.unreadBy) params.set("unreadBy", opts.unreadBy);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return get<PlatformMessage[]>(`/messages${qs ? `?${qs}` : ""}`);
  },
  postMessage: (data: { from: string; fromName?: string; to?: string; channel?: string; type: string; content: string; metadata?: Record<string, unknown> }) =>
    post<PlatformMessage>("/messages", data),
  markMessageRead: (id: string, agentId: string) =>
    post<{ ok: boolean }>(`/messages/${encodeURIComponent(id)}/read`, { agentId }),
  getUnreadCount: (agentId: string) =>
    get<{ count: number }>(`/messages/unread/${encodeURIComponent(agentId)}`),
  deleteMessage: (id: string) =>
    del<{ ok: boolean }>(`/messages/${encodeURIComponent(id)}`),
  clearMessages: () => del<{ ok: boolean }>("/messages"),

  // ─── Platform: Cost Tracker ─────────────────────────────────────────
  getCosts: (limit?: number) =>
    get<CostRecord[]>(`/costs${limit ? `?limit=${limit}` : ""}`),
  getCostSummary: () =>
    get<CostSummary>("/costs/summary"),
  getSpendLimit: () =>
    get<{ limit: number | null }>("/costs/limit"),
  setSpendLimit: (limit: number | null) =>
    put<{ ok: boolean }>("/costs/limit", { limit }),
  resetCosts: () => del<{ deleted: number }>("/costs"),

  // ─── Platform: Kill Switch ──────────────────────────────────────────
  getKillSwitch: () =>
    get<KillSwitchState>("/kill-switch"),
  activateKillSwitch: (reason?: string) =>
    post<KillSwitchState>("/kill-switch/activate", { reason }),
  deactivateKillSwitch: () =>
    post<KillSwitchState>("/kill-switch/deactivate"),

  // ─── Platform: Shared Context ───────────────────────────────────────
  listSharedContext: () =>
    get<SharedContextFile[]>("/shared-context"),
  getSharedContext: (filename: string) =>
    get<SharedContextFile>(`/shared-context/${encodeURIComponent(filename)}`),
  writeSharedContext: (filename: string, content: string) =>
    put<SharedContextFile>(`/shared-context/${encodeURIComponent(filename)}`, { content }),
  deleteSharedContext: (filename: string) =>
    del<{ ok: boolean }>(`/shared-context/${encodeURIComponent(filename)}`),

  // ─── Platform: LLM Providers ────────────────────────────────────────
  getLLMProviders: () =>
    get<{ providers: LLMProvider[] }>("/llm/providers"),
  getOllamaModels: () =>
    get<{ models: OllamaModel[] }>("/llm/ollama/models"),
  pullOllamaModel: (model: string) =>
    post<{ ok: boolean; model: string }>("/llm/ollama/pull", { model }),
  chatLLM: (data: { provider: string; model: string; messages: { role: string; content: string }[]; temperature?: number; maxTokens?: number }) =>
    post<LLMChatResponse>("/llm/chat", data),

  // ─── Platform: Auto-Approve ─────────────────────────────────────────
  getAutoApproveRules: () =>
    get<{ rules: AutoApproveRule[] }>("/auto-approve/rules"),

  // ─── Platform: Push Notifications ───────────────────────────────────
  subscribePush: (subscription: PushSubscription) =>
    post<{ ok: boolean }>("/push/subscribe", { subscription: subscription.toJSON() }),
  unsubscribePush: () =>
    post<{ ok: boolean }>("/push/unsubscribe"),
  testPush: () =>
    post<{ ok: boolean }>("/push/test"),

  // ─── Media Generation ───────────────────────────────────────────────
  generateImage: (prompt: string, opts?: { model?: string; aspectRatio?: string }) =>
    post<{ ok: boolean; images: Array<{ filename: string; path: string; mimeType: string; prompt: string; model: string }> }>("/media/generate-image", { prompt, ...opts }),
  generateVideo: (prompt: string, opts?: { model?: string; durationSeconds?: number; aspectRatio?: string }) =>
    post<{ ok: boolean; operationName: string; status: string; prompt: string; model: string }>("/media/generate-video", { prompt, ...opts }),
  pollVideoStatus: (operationName: string) =>
    get<{ operationName: string; status: string; videoPath?: string }>(`/media/video-status/${operationName}`),
  listMedia: () =>
    get<{ files: Array<{ filename: string; path: string; mtime: number }> }>("/media"),
  uploadMedia: async (base64: string, mimeType: string, filename?: string): Promise<{ ok: boolean; filename: string; url: string }> => {
    const res = await fetch("/api/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ base64, mimeType, filename }),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
  deleteMedia: (filename: string) =>
    del<{ ok: boolean }>(`/media/file/${encodeURIComponent(filename)}`),
  bulkDeleteMedia: (filenames: string[]) =>
    post<{ ok: boolean; deleted: number; errors: Array<{ filename: string; error: string }> }>(
      "/media/bulk-delete",
      { filenames },
    ),

  // ─── Session File Uploads (non-image attachments) ─────────────────────
  // Stages one or more files under ~/.heyhank/uploads/<sessionId>/ and
  // returns absolute paths so the agent can read them directly.
  uploadSessionFiles: async (
    sessionId: string,
    files: File[],
  ): Promise<{
    ok: boolean;
    files: Array<{ name: string; path: string; size: number; mimeType: string }>;
    errors: Array<{ name: string; error: string }>;
    maxBytes: number;
  }> => {
    const formData = new FormData();
    for (const f of files) formData.append("file", f);
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
      method: "POST",
      headers: { ...getAuthHeaders() },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }
    return res.json();
  },

  // ─── Reference Images ─────────────────────────────────────────────────
  listReferences: () =>
    get<{
      categories: Array<{
        name: string;
        count: number;
        files: Array<{ filename: string; url: string; path: string; size: number; uploadedAt: number }>;
      }>;
    }>("/references"),
  createReferenceCategory: (name: string) =>
    post<{ ok: boolean; created: boolean; name: string }>("/references/categories", { name }),
  deleteReferenceCategory: (name: string) =>
    del<{ ok: boolean }>(`/references/categories/${encodeURIComponent(name)}`),
  uploadReference: async (
    category: string,
    file: File,
  ): Promise<{ ok: boolean; category: string; file: { filename: string; url: string; size: number; uploadedAt: number } }> => {
    const formData = new FormData();
    formData.append("category", category);
    formData.append("file", file);
    const res = await fetch("/api/references/upload", {
      method: "POST",
      headers: { ...getAuthHeaders() },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }
    return res.json();
  },
  deleteReference: (category: string, filename: string) =>
    del<{ ok: boolean }>(`/references/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`),

  // ─── Federation ────────────────────────────────────────────────────
  getFederationIdentity: () =>
    get<{ nodeId: string; name: string; createdAt: string }>("/federation/identity"),
  updateFederationIdentity: (name: string) =>
    put<{ ok: boolean; nodeId: string; name: string }>("/federation/identity", { name }),
  getFederationNodes: () =>
    get<{ identity: { nodeId: string; name: string }; nodes: FederationNodeStatus[] }>("/federation/nodes"),
  addFederationNode: (data: { url: string; secret: string; name?: string }) =>
    post<{ ok: boolean; node: FederationNodeStatus }>("/federation/nodes", data),
  removeFederationNode: (id: string) =>
    del<{ ok: boolean }>(`/federation/nodes/${encodeURIComponent(id)}`),
  testFederationNode: (id: string) =>
    post<{ ok: boolean; connected: boolean; node: FederationNodeStatus }>(`/federation/nodes/${encodeURIComponent(id)}/test`),
  getFederationRemoteSessions: () =>
    get<{ sessions: FederationRemoteSession[] }>("/federation/remote-sessions"),
  federationProxy: (sessionId: string, text: string) =>
    post<{ result?: { replyText: string }; error?: string }>("/federation/proxy", { sessionId, text }),

  // ─── Telephony ─────────────────────────────────────────────────────
  startCall: (config: { phone: string; prompt: string; voice?: string }) =>
    post<{ id: string; phone: string; status: string; error?: string }>("/telephony/calls", config),
  getActiveCalls: () =>
    get<{ calls: Array<{ id: string; phone: string; status: string; prompt: string; durationSeconds: number; startedAt: number; transcript: Array<{ speaker: string; text: string; ts: number }> }> }>("/telephony/calls"),
  getCall: (id: string) =>
    get<{ id: string; phone: string; status: string; prompt: string; transcript: Array<{ speaker: string; text: string; ts: number }>; summary: string | null; durationSeconds: number }>(`/telephony/calls/${encodeURIComponent(id)}`),
  endCall: (id: string) =>
    del<{ id: string; status: string; summary: string | null }>(`/telephony/calls/${encodeURIComponent(id)}`),
  getCallHistory: (limit = 50) =>
    get<{ calls: Array<{ id: string; phone: string; status: string; prompt: string; summary: string | null; durationSeconds: number; startedAt: number }> }>(`/telephony/history?limit=${limit}`),
  getTelephonySettings: () =>
    get<{ enabled: boolean; freeswitch: { eslHost: string; eslPort: number }; trunks: Array<{ id: string; name: string; provider: string; callerId: string; enabled: boolean }>; defaultVoice: string }>("/telephony/settings"),
  updateTelephonySettings: (settings: Record<string, unknown>) =>
    put<{ success: boolean }>("/telephony/settings", settings),
  testFreeSwitchConnection: () =>
    post<{ connected: boolean; status?: string; error?: string }>("/telephony/test-connection"),
  getContacts: () =>
    get<{ contacts: Array<{ id: string; name: string; phone: string; notes?: string; script?: string; callFlow?: any }> }>("/telephony/contacts"),
  addContact: (contact: { name: string; phone: string; notes?: string; script?: string; callFlow?: any }) =>
    post<{ id: string; name: string; phone: string; notes?: string; script?: string; callFlow?: any }>("/telephony/contacts", contact),
  updateContact: (id: string, patch: Record<string, unknown>) =>
    put<{ id: string; name: string; phone: string; notes?: string; script?: string; callFlow?: any }>(`/telephony/contacts/${encodeURIComponent(id)}`, patch),
  deleteContact: (id: string) =>
    del<{ success: boolean }>(`/telephony/contacts/${encodeURIComponent(id)}`),

  // ─── Social Media ────────────────────────────────────────────────
  getSocialSettings: () =>
    get<{ backend: string | null; backends: Record<string, { url?: string; apiKey?: string }>; defaultPlatforms: string[]; browserPlatforms?: string[]; requireApproval?: boolean }>("/socialmedia/settings"),
  getSocialBrowserStatus: () =>
    get<{ platforms: Array<{ platform: string; running: boolean; loggedIn: boolean | null; currentUrl: string | null; hasProfile: boolean }> }>("/socialmedia/browser-status"),
  updateSocialSettings: (settings: Record<string, unknown>) =>
    put<{ ok: boolean }>("/socialmedia/settings", settings),
  testSocialConnection: () =>
    post<{ ok: boolean; error?: string }>("/socialmedia/test-connection"),
  getSocialProfiles: () =>
    get<{ profiles: Array<{ id: string; platform: string; name: string; picture?: string | null }> }>("/socialmedia/profiles"),
  createSocialPost: (data: { text: string; platforms: string[]; scheduledAt?: string | null; mediaUrls?: string[]; title?: string; firstComment?: string; videoUrl?: string; thumbnailUrl?: string; isDraft?: boolean; createdBy?: string }) =>
    post<any>("/socialmedia/posts", data),
  listSocialPosts: (opts?: { status?: string; platform?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.platform) params.set("platform", opts.platform);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return get<{ posts: Array<{ id: string; text: string; status: string; platforms: string[]; createdAt: string; scheduledAt?: string | null }> }>(`/socialmedia/posts?${params}`);
  },
  getSocialPost: (id: string) =>
    get<{ id: string; text: string; status: string; platforms: string[]; createdAt: string; scheduledAt?: string | null }>(`/socialmedia/posts/${encodeURIComponent(id)}`),
  updateSocialPost: (id: string, data: { text?: string; scheduledAt?: string | null; platforms?: string[] }) =>
    patch<{ id: string; text: string; status: string }>(`/socialmedia/posts/${encodeURIComponent(id)}`, data),
  publishSocialPost: (id: string) => post<any>(`/socialmedia/posts/${id}/publish`),
  moveSocialPostToDraft: (id: string) =>
    post<{ id: string; status: string }>(`/socialmedia/posts/${encodeURIComponent(id)}/move-to-draft`),
  deleteSocialPost: (id: string) =>
    del<{ ok: boolean }>(`/socialmedia/posts/${encodeURIComponent(id)}`),
  archiveSocialPost: (id: string) =>
    post<{ id: string; status: string }>(`/socialmedia/posts/${encodeURIComponent(id)}/archive`),
  unarchiveSocialPost: (id: string) =>
    post<{ id: string; status: string }>(`/socialmedia/posts/${encodeURIComponent(id)}/unarchive`),
  getSocialPostAnalytics: (id: string) =>
    get<{ impressions: number; likes: number; shares: number; comments: number }>(`/socialmedia/posts/${encodeURIComponent(id)}/analytics`),
  getSocialPostComments: (id: string) =>
    get<{ comments: Array<{ id: string; author: string; text: string; createdAt?: string; likes?: number }> }>(`/socialmedia/posts/${encodeURIComponent(id)}/comments`),
  replySocialComment: (postId: string, commentId: string | null, text: string) =>
    post<{ ok: boolean; error?: string }>(`/socialmedia/posts/${encodeURIComponent(postId)}/comments`, { commentId, text }),
  getSocialCalendar: (month: string) =>
    get<{ month: string; days: Record<string, Array<{ id: string; text: string; status: string; platforms: string[]; scheduledAt?: string | null }>> }>(`/socialmedia/calendar?month=${month}`),
  getSocialAccountAnalytics: (profileId: string) =>
    get<{ followers: number; following: number; posts: number }>(`/socialmedia/analytics/${encodeURIComponent(profileId)}`),

  // ─── Hashtag Pools ─────────────────────────────────────────────────
  listHashtagPools: () =>
    get<{ pools: Array<{ id: string; name: string; industry: string; language: string; popular: string[]; medium: string[]; niche: string[]; branded: string[]; blocked: string[]; createdAt: string; updatedAt: string }> }>("/socialmedia/hashtag-pools"),
  createHashtagPool: (pool: { name: string; industry?: string; language?: string; popular?: string[]; medium?: string[]; niche?: string[]; branded?: string[]; blocked?: string[] }) =>
    post<{ id: string; name: string }>("/socialmedia/hashtag-pools", pool),
  updateHashtagPool: (id: string, data: Record<string, unknown>) =>
    put<{ id: string; name: string }>(`/socialmedia/hashtag-pools/${encodeURIComponent(id)}`, data),
  deleteHashtagPool: (id: string) =>
    del<{ ok: boolean }>(`/socialmedia/hashtag-pools/${encodeURIComponent(id)}`),

  // ─── Assistant (Todos, Notes, Reminders) ─────────────────────────
  listTodos: (filter?: { done?: boolean; priority?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (filter?.done !== undefined) params.set("done", String(filter.done));
    if (filter?.priority) params.set("priority", filter.priority);
    if (filter?.category) params.set("category", filter.category);
    return get<{ todos: Array<{ id: string; text: string; priority: string; done: boolean; createdAt: string; doneAt?: string; category?: string }> }>(`/assistant/todos?${params}`);
  },
  addTodo: (data: { text: string; priority?: string; category?: string }) =>
    post<{ id: string; text: string; priority: string; done: boolean; createdAt: string; category?: string }>("/assistant/todos", data),
  updateTodo: (id: string, data: { text?: string; priority?: string; category?: string; done?: boolean }) =>
    patch<{ id: string; text: string; priority: string; done: boolean }>(`/assistant/todos/${encodeURIComponent(id)}`, data),
  deleteTodo: (id: string) =>
    del<{ ok: boolean }>(`/assistant/todos/${encodeURIComponent(id)}`),
  listNotes: (search?: string) =>
    get<{ notes: Array<{ id: string; title: string; content: string; tags: string[]; createdAt: string; updatedAt: string }> }>(`/assistant/notes${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  addNote: (data: { title: string; content: string; tags?: string[] }) =>
    post<{ id: string; title: string; content: string; tags: string[]; createdAt: string }>("/assistant/notes", data),
  updateNote: (id: string, data: { title?: string; content?: string; tags?: string[] }) =>
    patch<{ id: string; title: string; content: string; tags: string[] }>(`/assistant/notes/${encodeURIComponent(id)}`, data),
  deleteNote: (id: string) =>
    del<{ ok: boolean }>(`/assistant/notes/${encodeURIComponent(id)}`),
  listReminders: (all?: boolean) =>
    get<{ reminders: Array<{ id: string; text: string; triggerAt: string; fired: boolean; createdAt: string }> }>(`/assistant/reminders${all ? "?all=true" : ""}`),
  addReminder: (data: { text: string; triggerAt: string }) =>
    post<{ id: string; text: string; triggerAt: string; fired: boolean; calendarEventUid?: string }>("/assistant/reminders", data),
  updateReminder: (id: string, data: { text?: string; triggerAt?: string }) =>
    patch<{ id: string; text: string; triggerAt: string; fired: boolean; calendarEventUid?: string }>(`/assistant/reminders/${encodeURIComponent(id)}`, data),
  deleteReminder: (id: string) =>
    del<{ ok: boolean }>(`/assistant/reminders/${encodeURIComponent(id)}`),

  // ─── CRM Contacts ───────────────────────────────────────────────────
  listCrmContacts: (search?: string) =>
    get<{ contacts: Array<{ id: string; name: string; company?: string; email?: string; phone?: string; notes?: string; tags: string[]; lastContactDate?: string; interactions: Array<{ date: string; type: string; summary: string }>; createdAt: string; updatedAt: string }> }>(`/assistant/contacts${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  addCrmContact: (data: { name: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }) =>
    post<{ id: string; name: string; company?: string; email?: string; phone?: string; tags: string[]; createdAt: string }>("/assistant/contacts", data),
  getCrmContact: (id: string) =>
    get<{ id: string; name: string; company?: string; email?: string; phone?: string; notes?: string; tags: string[]; lastContactDate?: string; interactions: Array<{ date: string; type: string; summary: string }>; createdAt: string; updatedAt: string }>(`/assistant/contacts/${encodeURIComponent(id)}`),
  updateCrmContact: (id: string, data: { name?: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }) =>
    patch<{ id: string; name: string; company?: string; email?: string; phone?: string; tags: string[] }>(`/assistant/contacts/${encodeURIComponent(id)}`, data),
  deleteCrmContact: (id: string) =>
    del<{ ok: boolean }>(`/assistant/contacts/${encodeURIComponent(id)}`),
  logCrmInteraction: (id: string, data: { type: "call" | "email" | "meeting" | "note"; summary: string }) =>
    post<{ id: string; name: string; interactions: Array<{ date: string; type: string; summary: string }> }>(`/assistant/contacts/${encodeURIComponent(id)}/interactions`, data),

  // ─── Decisions ──────────────────────────────────────────────────────
  listDecisions: (search?: string) =>
    get<{ decisions: Array<{ id: string; title: string; context: string; decision: string; alternatives: string[]; reasoning: string; tags: string[]; createdAt: string }> }>(`/assistant/decisions${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  addDecision: (data: { title: string; context: string; decision: string; alternatives?: string[]; reasoning?: string; tags?: string[] }) =>
    post<{ id: string; title: string; context: string; decision: string; alternatives: string[]; reasoning: string; tags: string[]; createdAt: string }>("/assistant/decisions", data),
  deleteDecision: (id: string) =>
    del<{ ok: boolean }>(`/assistant/decisions/${encodeURIComponent(id)}`),

  // ─── Email ─────────────────────────────────────────────────────────
  listEmailAccounts: () =>
    get<{ accounts: Array<{ id: string; name: string; email: string; imap: { host: string; port: number; secure: boolean }; smtp: { host: string; port: number; secure: boolean } }> }>("/assistant/email/accounts"),
  addEmailAccount: (data: { name: string; email: string; imap: { host: string; port: number; secure: boolean }; smtp: { host: string; port: number; secure: boolean }; auth: { user: string; pass: string } }) =>
    post<{ id: string; name: string; email: string }>("/assistant/email/accounts", data),
  deleteEmailAccount: (id: string) =>
    del<{ ok: boolean }>(`/assistant/email/accounts/${encodeURIComponent(id)}`),
  testEmailAccount: (id: string) =>
    post<{ ok: boolean; error?: string }>(`/assistant/email/accounts/${encodeURIComponent(id)}/test`, {}),
  getUnreadSummary: () =>
    get<{ summary: Array<{ accountName: string; email: string; unread: number }> }>("/assistant/email/unread"),
  listEmails: (accountId: string, options?: { limit?: number; unseen?: boolean; folder?: string }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.unseen) params.set("unseen", "true");
    if (options?.folder) params.set("folder", options.folder);
    return get<{ emails: Array<{ uid: number; subject: string; from: string; to: string; date: string; seen: boolean; accountId: string; accountName: string }> }>(`/assistant/email/${encodeURIComponent(accountId)}/messages?${params}`);
  },
  readEmail: (accountId: string, uid: number) =>
    get<{ uid: number; subject: string; from: string; to: string; date: string; seen: boolean; textBody: string; accountId: string; accountName: string }>(`/assistant/email/${encodeURIComponent(accountId)}/messages/${uid}`),
  searchEmails: (accountId: string, query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", String(limit));
    return get<{ emails: Array<{ uid: number; subject: string; from: string; to: string; date: string; seen: boolean }> }>(`/assistant/email/${encodeURIComponent(accountId)}/search?${params}`);
  },
  sendEmailMessage: (accountId: string, data: { to: string; subject: string; body: string }) =>
    post<{ messageId: string }>(`/assistant/email/${encodeURIComponent(accountId)}/send`, data),
  replyToEmail: (accountId: string, data: { uid: number; body: string }) =>
    post<{ messageId: string }>(`/assistant/email/${encodeURIComponent(accountId)}/reply`, data),

  // Gemini conversations
  listGeminiConversations: () =>
    get<Array<{ id: string; title: string; messages: Array<{ role: string; text: string; ts: number }>; createdAt: string; duration?: number }>>("/gemini/conversations"),
  getGeminiConversation: (id: string) =>
    get<{ id: string; title: string; messages: Array<{ role: string; text: string; ts: number }>; createdAt: string; duration?: number }>(`/gemini/conversations/${encodeURIComponent(id)}`),
  saveGeminiConversation: (messages: Array<{ role: string; text: string; ts: number }>, duration?: number) =>
    post<{ id: string; title: string }>("/gemini/conversations", { messages, duration }),
  deleteGeminiConversation: (id: string) =>
    del<{ ok: boolean }>(`/gemini/conversations/${encodeURIComponent(id)}`),

  // Export / Import
  exportAll: () =>
    get<{ version: number; exportedAt: string; agents: unknown[]; settings: unknown; notes: unknown[]; todos: unknown[]; reminders: unknown[]; geminiConversations: unknown[] }>("/export"),
  importData: (data: { agents?: unknown[]; notes?: unknown[]; todos?: unknown[] }) =>
    post<{ imported: Record<string, number> }>("/import", data),

  // Providers
  getProviders: () =>
    get<Array<{
      id: string; name: string; description: string; category: string;
      cliProviderFlag: string; defaultModel?: string; docsUrl?: string;
      envFields: Array<{ key: string; label: string; required: boolean; secret: boolean; placeholder?: string }>;
      configured: boolean; enabled: boolean;
      envConfigured: Record<string, boolean>;
      customModel?: string;
    }>>("/providers"),
  getProvider: (id: string) =>
    get<{
      id: string; name: string; description: string; category: string;
      envFields: Array<{ key: string; label: string; required: boolean; secret: boolean; placeholder?: string }>;
      configured: boolean; enabled: boolean;
      envConfigured: Record<string, boolean>;
      envValues: Record<string, string>;
      customModel?: string;
    }>(`/providers/${encodeURIComponent(id)}`),
  updateProvider: (id: string, data: { enabled?: boolean; envValues?: Record<string, string>; customModel?: string }) =>
    put<{ configured: boolean; enabled: boolean }>(`/providers/${encodeURIComponent(id)}`, data),
  deleteProvider: (id: string) =>
    del<{ ok: boolean }>(`/providers/${encodeURIComponent(id)}`),

  getDailyBriefing: (date?: string) =>
    get<{
      date: string;
      email: { accounts: Array<{ accountName: string; email: string; unread: number }>; totalUnread: number };
      calendar: { events: Array<Record<string, unknown>>; count: number };
      todos: { open: number; overdue: number; dueToday: number };
      delegations: { count: number };
      projects: Array<{ name: string; total: number; done: number; open: number }>;
    }>(date ? `/assistant/briefing?date=${date}` : "/assistant/briefing"),
};

// ─── Documents ────────────────────────────────────────────────────────────
export const documentsApi = {
  list: (folder?: string, tag?: string) => {
    const params = new URLSearchParams();
    if (folder) params.set("folder", folder);
    if (tag) params.set("tag", tag);
    const qs = params.toString();
    return get<{ documents: Array<{ id: string; title: string; fileType: string; size: number; folder: string; tags: string[]; createdAt: string; updatedAt: string; summary?: string }> }>(`/assistant/documents${qs ? `?${qs}` : ""}`);
  },
  create: (data: { title: string; content: string; fileType: string; folder?: string; tags?: string[]; summary?: string }) =>
    post<{ id: string; title: string; fileType: string; folder: string; tags: string[]; createdAt: string }>("/assistant/documents", data),
  get: (id: string) =>
    get<{ meta: { id: string; title: string; fileType: string; size: number; folder: string; tags: string[]; summary?: string }; content: string }>(`/assistant/documents/${encodeURIComponent(id)}`),
  update: (id: string, data: { title?: string; tags?: string[]; folder?: string; summary?: string }) =>
    patch<{ id: string; title: string; folder: string; tags: string[] }>(`/assistant/documents/${encodeURIComponent(id)}`, data),
  delete: (id: string) =>
    del<{ success: boolean }>(`/assistant/documents/${encodeURIComponent(id)}`),
  search: (q: string) =>
    get<{ documents: Array<{ id: string; title: string; fileType: string; folder: string; tags: string[]; summary?: string }> }>(`/assistant/documents/search?q=${encodeURIComponent(q)}`),
  folders: () =>
    get<{ folders: string[] }>("/assistant/documents/folders"),
};

// ─── Templates ────────────────────────────────────────────────────────────
export const templatesApi = {
  list: (category?: string) =>
    get<{ templates: Array<{ id: string; name: string; category: string; content: string; variables: Array<{ name: string; description?: string; defaultValue?: string; required?: boolean }>; tags: string[]; usageCount: number; createdAt: string }> }>(`/assistant/templates${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  create: (data: { name: string; content: string; category: string; tags?: string[] }) =>
    post<{ id: string; name: string; category: string; variables: Array<{ name: string }>; createdAt: string }>("/assistant/templates", data),
  get: (id: string) =>
    get<{ id: string; name: string; category: string; content: string; variables: Array<{ name: string; description?: string }> }>(`/assistant/templates/${encodeURIComponent(id)}`),
  update: (id: string, data: { name?: string; content?: string; category?: string; tags?: string[] }) =>
    patch<{ id: string; name: string; category: string }>(`/assistant/templates/${encodeURIComponent(id)}`, data),
  delete: (id: string) =>
    del<{ success: boolean }>(`/assistant/templates/${encodeURIComponent(id)}`),
  use: (id: string, variables: Record<string, string>) =>
    post<{ result: string; templateName: string }>(`/assistant/templates/${encodeURIComponent(id)}/use`, { variables }),
  search: (q: string) =>
    get<{ templates: Array<{ id: string; name: string; category: string }> }>(`/assistant/templates/search?q=${encodeURIComponent(q)}`),
  categories: () =>
    get<{ categories: string[] }>("/assistant/templates/categories"),
};

// ─── News & Monitoring ───────────────────────────────────────────────────
export const newsApi = {
  listSources: () =>
    get<{ sources: Array<{ id: string; name: string; type: string; url?: string; keywords?: string[]; category: string; enabled: boolean; lastChecked?: string }> }>("/assistant/news/sources"),
  addSource: (data: { name: string; type: string; category: string; url?: string; keywords?: string[]; checkInterval?: number }) =>
    post<{ id: string; name: string; type: string; category: string }>("/assistant/news/sources", data),
  updateSource: (id: string, data: Record<string, unknown>) =>
    patch<{ id: string; name: string; enabled: boolean }>(`/assistant/news/sources/${encodeURIComponent(id)}`, data),
  deleteSource: (id: string) =>
    del<{ success: boolean }>(`/assistant/news/sources/${encodeURIComponent(id)}`),
  list: (opts?: { category?: string; unread?: boolean; saved?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    if (opts?.unread) params.set("unread", "true");
    if (opts?.saved) params.set("saved", "true");
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return get<{ items: Array<{ id: string; sourceId: string; sourceName: string; title: string; summary: string; url?: string; category: string; publishedAt: string; read: boolean; saved: boolean; relevance?: number }> }>(`/assistant/news${qs ? `?${qs}` : ""}`);
  },
  stats: () =>
    get<{ total: number; unread: number; sources: number; byCategory: Record<string, number> }>("/assistant/news/stats"),
  search: (q: string) =>
    get<{ items: Array<{ id: string; title: string; summary: string; sourceName: string }> }>(`/assistant/news/search?q=${encodeURIComponent(q)}`),
  markRead: (id: string) =>
    patch<{ success: boolean }>(`/assistant/news/${encodeURIComponent(id)}/read`, {}),
  markAllRead: (category?: string) =>
    post<{ markedRead: number }>("/assistant/news/mark-all-read", { category }),
  toggleSaved: (id: string) =>
    patch<{ id: string; saved: boolean }>(`/assistant/news/${encodeURIComponent(id)}/save`, {}),
};

// ─── Time Tracking ───────────────────────────────────────────────────────
export const timeApi = {
  getTimer: () =>
    get<{ timer: { id: string; task: string; project?: string; category?: string; startTime: string } | null }>("/assistant/time/timer"),
  startTimer: (task: string, project?: string, category?: string) =>
    post<{ id: string; task: string; startTime: string }>("/assistant/time/timer/start", { task, project, category }),
  stopTimer: (notes?: string) =>
    post<{ id: string; task: string; duration: number; startTime: string; endTime: string }>("/assistant/time/timer/stop", { notes }),
  logTime: (data: { task: string; duration: number; project?: string; category?: string; notes?: string; date?: string }) =>
    post<{ id: string; task: string; duration: number }>("/assistant/time/log", data),
  listEntries: (start?: string, end?: string, project?: string) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (project) params.set("project", project);
    const qs = params.toString();
    return get<{ entries: Array<{ id: string; task: string; project?: string; category?: string; startTime: string; duration?: number; notes?: string; source: string }> }>(`/assistant/time/entries${qs ? `?${qs}` : ""}`);
  },
  report: (period?: string) =>
    get<{ period: string; totalMinutes: number; byProject: Record<string, number>; byCategory: Record<string, number>; byDay: Record<string, number> }>(`/assistant/time/report?period=${period || "week"}`),
  projects: () =>
    get<{ projects: string[] }>("/assistant/time/projects"),
  deleteEntry: (id: string) =>
    del<{ success: boolean }>(`/assistant/time/entries/${encodeURIComponent(id)}`),
};

// ─── Finance ─────────────────────────────────────────────────────────────
export const financeApi = {
  listInvoices: (status?: string) =>
    get<{ invoices: Array<{ id: string; invoiceNumber: string; clientName: string; total: number; currency: string; status: string; issueDate: string; dueDate: string; paidDate?: string }> }>(`/assistant/invoices${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createInvoice: (data: { clientName: string; items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; clientEmail?: string; taxRate?: number; currency?: string; dueDate?: string; notes?: string }) =>
    post<{ id: string; invoiceNumber: string; clientName: string; total: number; currency: string; status: string }>("/assistant/invoices", data),
  getInvoice: (id: string) =>
    get<{ id: string; invoiceNumber: string; clientName: string; items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; total: number; currency: string; status: string }>(`/assistant/invoices/${encodeURIComponent(id)}`),
  updateInvoice: (id: string, data: Record<string, unknown>) =>
    patch<{ id: string; invoiceNumber: string; status: string }>(`/assistant/invoices/${encodeURIComponent(id)}`, data),
  markPaid: (id: string) =>
    post<{ id: string; invoiceNumber: string; status: string }>(`/assistant/invoices/${encodeURIComponent(id)}/paid`, {}),
  deleteInvoice: (id: string) =>
    del<{ success: boolean }>(`/assistant/invoices/${encodeURIComponent(id)}`),
  listExpenses: (category?: string, start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    return get<{ expenses: Array<{ id: string; description: string; amount: number; currency: string; category: string; date: string; vendor?: string; project?: string }> }>(`/assistant/expenses${qs ? `?${qs}` : ""}`);
  },
  logExpense: (data: { description: string; amount: number; category: string; vendor?: string; project?: string; date?: string; notes?: string }) =>
    post<{ id: string; description: string; amount: number; category: string }>("/assistant/expenses", data),
  deleteExpense: (id: string) =>
    del<{ success: boolean }>(`/assistant/expenses/${encodeURIComponent(id)}`),
  expenseCategories: () =>
    get<{ categories: string[] }>("/assistant/expenses/categories"),
  summary: (period?: string) =>
    get<{ totalRevenue: number; totalExpenses: number; netProfit: number; currency: string; invoicesByStatus: Record<string, { count: number; total: number }>; outstandingInvoices: Array<{ id: string; invoiceNumber: string; clientName: string; total: number; dueDate: string }> }>(`/assistant/finance/summary?period=${period || "month"}`),
  getSettings: () =>
    get<{ defaultCurrency: string; defaultTaxRate: number; invoicePrefix: string; companyName?: string }>("/assistant/finance/settings"),
  updateSettings: (data: Record<string, unknown>) =>
    patch<{ defaultCurrency: string; defaultTaxRate: number }>("/assistant/finance/settings", data),
};

// ─── KPI Dashboard ───────────────────────────────────────────────────────
export const kpiApi = {
  list: (category?: string) =>
    get<{ kpis: Array<{ id: string; name: string; unit: string; category: string; target?: number; currentValue?: number; trend?: string; trendPercent?: number; direction: string }> }>(`/assistant/kpis${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  dashboard: () =>
    get<{ kpis: Array<{ id: string; name: string; unit: string; category: string; target?: number; currentValue?: number; trend?: string; trendPercent?: number; direction: string }>; summary: { total: number; onTarget: number; warning: number; critical: number; noData: number } }>("/assistant/kpis/dashboard"),
  define: (data: { name: string; unit: string; category: string; target?: number; direction?: string; description?: string }) =>
    post<{ id: string; name: string; unit: string; category: string }>("/assistant/kpis", data),
  get: (id: string) =>
    get<{ id: string; name: string; unit: string; currentValue?: number; target?: number; history: Array<{ value: number; date: string }> }>(`/assistant/kpis/${encodeURIComponent(id)}`),
  update: (id: string, data: Record<string, unknown>) =>
    patch<{ id: string; name: string }>(`/assistant/kpis/${encodeURIComponent(id)}`, data),
  record: (id: string, value: number, date?: string, note?: string) =>
    post<{ id: string; name: string; currentValue: number; trend?: string }>(`/assistant/kpis/${encodeURIComponent(id)}/record`, { value, date, note }),
  history: (id: string, period?: string) =>
    get<{ history: Array<{ value: number; date: string; note?: string }> }>(`/assistant/kpis/${encodeURIComponent(id)}/history${period ? `?period=${period}` : ""}`),
  delete: (id: string) =>
    del<{ success: boolean }>(`/assistant/kpis/${encodeURIComponent(id)}`),
  categories: () =>
    get<{ categories: string[] }>("/assistant/kpis/categories"),
};

// ─── IG Wizard (Claude-driven hooks + CTAs) ──────────────────────────────────

/** A complete lead package — see server/ig-wizard.ts LeadPackage for full docs. */
export interface IgWizardLeadPackage {
  cta: string;
  trigger: string;
  dmTemplate: string;
}

export interface IgWizardCtas {
  engagement: string[];
  leads: IgWizardLeadPackage[];
  growth: string[];
}

export interface IgWizardResult {
  hooks: string[];
  ctas: IgWizardCtas;
  niche: string;
  language: string;
  model: string;
}

export type IgStyle = "cozy" | "business" | "pointing" | "bold" | "screen";

export interface IgCaptionResult {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  /** hook + body + cta + hashtags, joined and ready to paste. */
  caption: string;
  /** AI-suggested image style for this post. */
  style: IgStyle;
  language: string;
  model: string;
  /** True if the body was grounded in a research brief (real facts) vs generic. */
  grounded?: boolean;
}

export interface IgCaptionInput {
  topic: string;
  language?: "en" | "de";
  /** Optional pre-picked hook to anchor the caption to. */
  hook?: string;
  /** Optional pre-picked lead CTA to anchor the caption to. */
  cta?: string;
  /** Pre-built grounding text from a research brief (manual research flow). */
  grounding?: string;
  /** Research inline before composing (auto flow). Ignored if grounding is set. */
  autoResearch?: boolean;
  /** Optional niche/angle to focus the inline research. */
  niche?: string;
}

// ─── Research / Content Brief ────────────────────────────────────────────────

export interface IgBriefFact {
  fact: string;
  source?: string;
}

export interface IgFreshItem {
  headline: string;
  detail: string;
  source?: string;
  date?: string;
}

export interface IgContentBrief {
  topic: string;
  niche: string;
  language: string;
  angles: string[];
  facts: IgBriefFact[];
  freshItems: IgFreshItem[];
  painPoints: string[];
  myths: string[];
  hotDataPoint?: string;
  ownTakes: string[];
  sources: string[];
  generatedAt: string;
  cached: boolean;
}

export interface IgResearchInput {
  topic: string;
  niche?: string;
  language?: "en" | "de";
  forceRefresh?: boolean;
}

export type IgPlanCtaType = "lead" | "engagement" | "growth";

export interface IgPlanBrief {
  day: number;
  angle: string;
  hook: string;
  ctaType: IgPlanCtaType;
}

export interface IgPlanResult {
  topic: string;
  language: string;
  briefs: IgPlanBrief[];
  model: string;
}

export interface IgPlanInput {
  topic: string;
  language?: "en" | "de";
  days?: number;
}

export interface IgCoverImage {
  filename: string;
  url: string;
  path: string;
  prompt: string;
  model: string;
}

/** A social draft created by promoting a wizard post (see posts/:id/to-draft). */
export interface IgComposeDraftPost {
  id: string;
  text: string;
  status: string;
  platforms: string[];
  mediaUrls: string[];
  firstComment?: string;
  format?: string;
  createdAt: string;
}

export type WizardPostFormat = "post" | "carousel" | "reel";

export interface WizardPost {
  id: string;
  topic: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  caption: string;
  platforms: string[];
  format?: WizardPostFormat;
  imageUrl?: string | null;
  imageFilename?: string | null;
  mediaUrls?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  hero?: string;
  style?: string;
  cap?: boolean;
  source: "single" | "plan";
  day?: number | null;
  promotedDraftId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWizardPostInput {
  topic: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  caption: string;
  source: "single" | "plan";
  platforms?: string[];
  hero?: string;
  style?: string;
  day?: number;
}

export type InspirationFormat = "post" | "carousel" | "reel" | "story";

export interface InspirationItem {
  id: string;
  handle: string;
  format: InspirationFormat;
  caption: string;
  topic?: string;
  mediaUrls: string[];
  sourceUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInspirationInput {
  handle: string;
  format: InspirationFormat;
  caption: string;
  topic?: string;
  mediaUrls?: string[];
  sourceUrl?: string;
  notes?: string;
}

export const igWizardApi = {
  generate: (niche: string, language: "en" | "de" = "en") =>
    post<IgWizardResult>("/ig-wizard/generate", { niche, language }),
  caption: (input: IgCaptionInput) =>
    post<IgCaptionResult>("/ig-wizard/caption", { language: "en", ...input }),
  research: (input: IgResearchInput) =>
    post<IgContentBrief>("/ig-wizard/research", { language: "en", ...input }),
  plan: (input: IgPlanInput) =>
    post<IgPlanResult>("/ig-wizard/plan", { language: "en", days: 30, ...input }),
  // ── Saved Posts (the wizard's persistent workbench) ──
  posts: {
    list: () => get<{ posts: WizardPost[] }>("/ig-wizard/posts"),
    create: (input: CreateWizardPostInput) =>
      post<{ ok: boolean; post: WizardPost }>("/ig-wizard/posts", input),
    update: (id: string, changes: Partial<CreateWizardPostInput>) =>
      patch<WizardPost>(`/ig-wizard/posts/${encodeURIComponent(id)}`, changes),
    remove: (id: string) => del<{ ok: boolean }>(`/ig-wizard/posts/${encodeURIComponent(id)}`),
    bulkRemove: (ids: string[]) =>
      post<{ ok: boolean; removed: number }>("/ig-wizard/posts/bulk-delete", { ids }),
    generateImage: (id: string, hero?: string, style?: string, cap?: boolean) =>
      post<{ ok: boolean; post: WizardPost; image: IgCoverImage }>(`/ig-wizard/posts/${encodeURIComponent(id)}/image`, { hero, style, cap }),
    generateCarousel: (id: string, slides: number, hero?: string, style?: string, cap?: boolean) =>
      post<{ ok: boolean; post: WizardPost; slides: { text: string }[]; mediaUrls: string[] }>(`/ig-wizard/posts/${encodeURIComponent(id)}/carousel`, { slides, hero, style, cap }),
    generateReel: (id: string, durationSeconds?: 4 | 6 | 8) =>
      post<{ ok: boolean; post: WizardPost; videoUrl: string }>(`/ig-wizard/posts/${encodeURIComponent(id)}/reel`, { durationSeconds }),
    toDraft: (id: string) =>
      post<{ ok: boolean; draft: IgComposeDraftPost; post: WizardPost }>(`/ig-wizard/posts/${encodeURIComponent(id)}/to-draft`, {}),
    bulkToDraft: (ids: string[]) =>
      post<{ ok: boolean; promoted: number; results: Array<{ id: string; ok: boolean; draftId?: string; error?: string }> }>(
        "/ig-wizard/posts/bulk-to-draft",
        { ids },
      ),
  },
  // ── Inspiration (manual swipe file from creators you admire) ──
  inspiration: {
    list: () => get<{ items: InspirationItem[] }>("/ig-wizard/inspiration"),
    create: (input: CreateInspirationInput) =>
      post<{ ok: boolean; item: InspirationItem }>("/ig-wizard/inspiration", input),
    remove: (id: string) =>
      del<{ ok: boolean }>(`/ig-wizard/inspiration/${encodeURIComponent(id)}`),
    adapt: (id: string, language: "en" | "de" = "en", topic?: string) =>
      post<{ ok: boolean; post: WizardPost; result: IgCaptionResult }>(
        `/ig-wizard/inspiration/${encodeURIComponent(id)}/adapt`,
        { language, topic },
      ),
    /** Upload an image/video file → returns its /api/media/file URL. */
    uploadMedia: async (file: File): Promise<{ ok: boolean; filename: string; url: string }> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload failed (${res.status}): ${text}`);
      }
      return res.json();
    },
  },
};

// ─── Auto-DM rules (used by IG Wizard Create-Rule button) ────────────────────

export interface AutoDmRuleCreateInput {
  platform: "instagram" | "facebook";
  keyword: string;
  dmTemplate: string;
  /** Destination for the {{link}} tracking placeholder (usually a Substack post). */
  targetUrl?: string | null;
  /** Optional public comment-reply posted after a successful DM (engagement boost). */
  publicReply?: string | null;
  postId?: string | null;
  enabled?: boolean;
  notes?: string;
}

export interface AutoDmRule {
  id: string;
  platform: "instagram" | "facebook";
  keyword: string;
  dmTemplate: string;
  targetUrl?: string | null;
  publicReply?: string | null;
  enabled: boolean;
  sentCount: number;
  publicReplyCount?: number;
  createdAt: string;
  updatedAt: string;
  postId?: string | null;
  notes?: string;
}

export interface RuleFunnel {
  ruleId: string;
  keyword: string;
  linksSent: number;
  linksClicked: number;
  totalClicks: number;
  clickRate: number | null;
  lastClickAt: string | null;
}

export interface FunnelSummary {
  rules: RuleFunnel[];
  totals: {
    linksSent: number;
    linksClicked: number;
    totalClicks: number;
    clickRate: number | null;
  };
}

export const autoDmRulesApi = {
  create: (input: AutoDmRuleCreateInput) =>
    post<{ ok: boolean; rule: AutoDmRule }>("/automation/rules", input),
  funnel: () => get<FunnelSummary>("/automation/funnel"),
};
