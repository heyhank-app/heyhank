import { useEffect, useMemo, useCallback, useState } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { navigateToSession } from "../utils/routing.js";
import { connectSession } from "../ws.js";
import type { SessionItem as SessionItemType } from "../utils/project-grouping.js";
import type { AgentInfo } from "../api.js";

interface GeminiConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  duration?: number;
  messages: Array<{ role: string; text: string; ts: number }>;
}

type DerivedStatus = "awaiting" | "running" | "reconnecting" | "idle" | "exited";

function deriveStatus(s: SessionItemType, permCount: number): DerivedStatus {
  if (permCount > 0) return "awaiting";
  if ((s.status === "running" || s.status === "compacting") && s.isConnected) return "running";
  if (s.isReconnecting) return "reconnecting";
  if (s.isConnected) return "idle";
  return "exited";
}

function statusLabel(status: DerivedStatus): string {
  switch (status) {
    case "running": return "Running";
    case "awaiting": return "Awaiting input";
    case "reconnecting": return "Reconnecting";
    case "idle": return "Idle";
    case "exited": return "Stopped";
  }
}

function statusColor(status: DerivedStatus): string {
  switch (status) {
    case "running": return "bg-cc-success";
    case "awaiting": return "bg-cc-warning";
    case "reconnecting": return "bg-cc-warning";
    case "idle": return "bg-cc-muted";
    case "exited": return "bg-cc-border";
  }
}

function StatusDot({ status }: { status: DerivedStatus }) {
  const isPulsing = status === "running" || status === "awaiting";
  const dotClass = status === "running" ? "status-dot-running" : status === "awaiting" ? "status-dot-awaiting" : "";
  return (
    <span className={`relative shrink-0 w-2.5 h-2.5 ${dotClass}`}>
      {isPulsing && (
        <span className={`absolute inset-0 rounded-full ${statusColor(status)} animate-ping opacity-50`} />
      )}
      <span className={`w-2.5 h-2.5 rounded-full ${statusColor(status)} block`} />
    </span>
  );
}

function formatCwd(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : cwd;
}

function timeAgo(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SessionCard({ session, sessionName, onClick }: {
  session: SessionItemType;
  sessionName: string | undefined;
  onClick: () => void;
}) {
  const status = deriveStatus(session, session.permCount);
  const label = sessionName || session.agentName || session.cronJobName || session.model || session.id.slice(0, 8);
  const cwd = formatCwd(session.cwd);

  return (
    <button
      type="button"
      onClick={onClick}
      className="card-hover w-full text-left p-4 rounded-xl bg-cc-hover/50 border border-cc-border/50 hover:border-cc-border hover:bg-cc-hover transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={status} />
          <span className="text-sm font-medium text-cc-fg truncate">{label}</span>
        </div>
        <span className="text-[10px] text-cc-muted shrink-0">{timeAgo(session.createdAt)}</span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-cc-muted mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          status === "running" ? "bg-cc-success/15 text-cc-success" :
          status === "awaiting" ? "bg-cc-warning/15 text-cc-warning" :
          status === "exited" ? "bg-cc-border/30 text-cc-muted" :
          "bg-cc-hover text-cc-muted"
        }`}>
          {statusLabel(status)}
        </span>
        {session.backendType && (
          <span className="px-1.5 py-0.5 rounded bg-cc-hover text-[10px] font-mono-code uppercase">
            {session.backendType === "claude" ? "CC" : "CX"}
          </span>
        )}
        {session.model && (
          <span className="truncate">{session.model.replace("claude-", "").replace("-20251001", "")}</span>
        )}
      </div>

      {cwd && (
        <div className="flex items-center gap-1.5 text-[11px] text-cc-muted">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 opacity-50">
            <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
          </svg>
          <span className="truncate">{cwd}</span>
          {session.gitBranch && (
            <>
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 opacity-50 ml-1">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
              </svg>
              <span className="truncate">{session.gitBranch}</span>
            </>
          )}
        </div>
      )}

      {session.permCount > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-cc-warning">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z" />
          </svg>
          {session.permCount} pending permission{session.permCount > 1 ? "s" : ""}
        </div>
      )}
    </button>
  );
}

export function SessionsDashboard() {
  const sessions = useStore((s) => s.sessions);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const sessionNames = useStore((s) => s.sessionNames);
  const cliConnected = useStore((s) => s.cliConnected);
  const cliReconnecting = useStore((s) => s.cliReconnecting);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const setSdkSessions = useStore((s) => s.setSdkSessions);

  // Dashboard extra data
  const [dashboardAgents, setDashboardAgents] = useState<AgentInfo[]>([]);
  const [federationNodeCount, setFederationNodeCount] = useState<{ total: number; connected: number } | null>(null);
  const [geminiReady, setGeminiReady] = useState<boolean | null>(null);
  const [geminiConversations, setGeminiConversations] = useState<GeminiConversationSummary[]>([]);
  const [expandedConvo, setExpandedConvo] = useState<string | null>(null);

  // Poll sessions
  useEffect(() => {
    const poll = () => {
      api.listSessions().then(setSdkSessions).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [setSdkSessions]);

  // Fetch dashboard extras once
  useEffect(() => {
    api.listAgents().then(setDashboardAgents).catch(() => {});
    api.getFederationNodes().then((res) => {
      const connected = res.nodes.filter((n: { connected: boolean }) => n.connected).length;
      setFederationNodeCount({ total: res.nodes.length, connected });
    }).catch(() => {});
    api.getSettings().then((s) => {
      setGeminiReady(s.geminiApiKeyConfigured);
    }).catch(() => {});
    api.listGeminiConversations().then(setGeminiConversations).catch(() => {});
  }, []);

  const allSessions = useMemo(() => {
    const allIds = new Set<string>();
    for (const id of sessions.keys()) allIds.add(id);
    for (const s of sdkSessions) allIds.add(s.sessionId);

    return Array.from(allIds).map((id) => {
      const bridgeState = sessions.get(id);
      const sdkInfo = sdkSessions.find((s) => s.sessionId === id);
      return {
        id,
        model: bridgeState?.model || sdkInfo?.model || "",
        cwd: bridgeState?.cwd || sdkInfo?.cwd || "",
        gitBranch: bridgeState?.git_branch || sdkInfo?.gitBranch || "",
        isContainerized: bridgeState?.is_containerized || !!sdkInfo?.containerId || false,
        gitAhead: bridgeState?.git_ahead || sdkInfo?.gitAhead || 0,
        gitBehind: bridgeState?.git_behind || sdkInfo?.gitBehind || 0,
        linesAdded: bridgeState?.total_lines_added || sdkInfo?.totalLinesAdded || 0,
        linesRemoved: bridgeState?.total_lines_removed || sdkInfo?.totalLinesRemoved || 0,
        isConnected: cliConnected.get(id) ?? false,
        isReconnecting: cliReconnecting.get(id) ?? false,
        status: sessionStatus.get(id) ?? null,
        sdkState: sdkInfo?.state ?? null,
        createdAt: sdkInfo?.createdAt ?? 0,
        archived: sdkInfo?.archived ?? false,
        backendType: (bridgeState?.backend_type || sdkInfo?.backendType || "claude") as "claude" | "codex",
        repoRoot: bridgeState?.repo_root || "",
        permCount: pendingPermissions.get(id)?.size ?? 0,
        cronJobId: bridgeState?.cronJobId || sdkInfo?.cronJobId,
        cronJobName: bridgeState?.cronJobName || sdkInfo?.cronJobName,
        agentId: bridgeState?.agentId || sdkInfo?.agentId,
        agentName: bridgeState?.agentName || sdkInfo?.agentName,
      } satisfies SessionItemType;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [sessions, sdkSessions, cliConnected, cliReconnecting, sessionStatus, pendingPermissions]);

  const activeSessions = useMemo(() => allSessions.filter((s) => !s.archived && !s.cronJobId && !s.agentId), [allSessions]);
  const agentSessions = useMemo(() => allSessions.filter((s) => !s.archived && !!s.agentId), [allSessions]);
  const cronSessions = useMemo(() => allSessions.filter((s) => !s.archived && !!s.cronJobId), [allSessions]);

  const runningSessions = useMemo(() => activeSessions.filter((s) => {
    const st = deriveStatus(s, s.permCount);
    return st === "running" || st === "awaiting" || st === "idle";
  }), [activeSessions]);

  const stoppedSessions = useMemo(() => activeSessions.filter((s) => {
    const st = deriveStatus(s, s.permCount);
    return st === "exited";
  }), [activeSessions]);

  const handleSelect = useCallback((id: string) => {
    connectSession(id);
    navigateToSession(id);
  }, []);

  const handleNewSession = useCallback(() => {
    window.location.hash = "/new";
  }, []);

  const enabledAgents = dashboardAgents.filter((a) => a.enabled !== false);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {/* ── Dashboard Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-cc-fg">HeyHank</h1>
            <p className="text-xs text-cc-muted mt-0.5">Your AI agent platform</p>
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-cc-primary text-white hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
            New Session
          </button>
        </div>

        {/* ── KPI Status Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {/* Live Sessions */}
          <a href="#/sessions" className="kpi-card rounded-xl px-4 py-3 block no-underline">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-primary opacity-70">
                <path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8Z" />
                <path d="M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
              </svg>
              <span className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Live Sessions</span>
            </div>
            <p className="text-xl font-bold text-cc-fg">{activeSessions.length}</p>
            <p className="text-[11px] text-cc-muted mt-0.5">{runningSessions.length} running</p>
          </a>

          {/* Agents */}
          <a href="#/agents" className="kpi-card rounded-xl px-4 py-3 block no-underline">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-primary opacity-70">
                <path d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM2 13.149C2 10.22 4.279 8 7.044 8h1.912C11.721 8 14 10.22 14 13.149a.85.85 0 0 1-.851.851H2.851A.85.85 0 0 1 2 13.149Z" />
              </svg>
              <span className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Agents</span>
            </div>
            <p className="text-xl font-bold text-cc-fg">{enabledAgents.length}</p>
            <p className="text-[11px] text-cc-muted mt-0.5">{dashboardAgents.length} total</p>
          </a>

          {/* Gemini */}
          <a href="#/settings#gemini" className="kpi-card rounded-xl px-4 py-3 block no-underline">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-primary opacity-70">
                <path d="M8 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 1ZM3.172 3.172a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06ZM1 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 1 8Zm11.75-.75a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5ZM3.172 12.828a.75.75 0 0 1 0-1.06l1.06-1.06a.75.75 0 1 1 1.06 1.06l-1.06 1.06a.75.75 0 0 1-1.06 0ZM8 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13Zm3.536-1.232a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06Zm1.06-6.536a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
              </svg>
              <span className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Gemini</span>
            </div>
            <p className="text-xl font-bold text-cc-fg">
              {geminiReady === null ? "..." : geminiReady ? "Ready" : "Off"}
            </p>
            <p className="text-[11px] text-cc-muted mt-0.5">Voice assistant</p>
          </a>

          {/* Federation */}
          <a href="#/settings#federation" className="kpi-card rounded-xl px-4 py-3 block no-underline">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-primary opacity-70">
                <path d="M8 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM11.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM8 4.5a.75.75 0 0 1 .75.75v2h2.5a.75.75 0 0 1 0 1.5h-2.5v2a.75.75 0 0 1-1.5 0v-2h-2.5a.75.75 0 0 1 0-1.5h2.5v-2A.75.75 0 0 1 8 4.5Z" />
              </svg>
              <span className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Federation</span>
            </div>
            <p className="text-xl font-bold text-cc-fg">
              {federationNodeCount ? (
                <>{federationNodeCount.connected}<span className="text-sm font-normal text-cc-muted">/{federationNodeCount.total}</span></>
              ) : (
                "0"
              )}
            </p>
            <p className="text-[11px] text-cc-muted mt-0.5">Nodes</p>
          </a>
        </div>

        {/* ── Quick Actions ── */}
        <div className="flex items-center gap-2 mb-8">
          <button
            type="button"
            onClick={handleNewSession}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cc-hover border border-cc-border/50 text-cc-fg hover:bg-cc-hover/80 transition-colors cursor-pointer"
          >
            New Session
          </button>
          <button
            type="button"
            onClick={() => { window.location.hash = "/agents"; }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cc-hover border border-cc-border/50 text-cc-fg hover:bg-cc-hover/80 transition-colors cursor-pointer"
          >
            View Agents
          </button>
          <button
            type="button"
            onClick={() => { window.location.hash = "/settings"; }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cc-hover border border-cc-border/50 text-cc-fg hover:bg-cc-hover/80 transition-colors cursor-pointer"
          >
            Settings
          </button>
        </div>

        {/* ── Gemini Conversations ── */}
        {geminiConversations.length > 0 && (
          <div className="bg-cc-card border border-cc-border rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Gemini History</h3>
              <span className="text-[10px] text-cc-muted px-2 py-0.5 rounded-full bg-cc-hover">{geminiConversations.length}</span>
            </div>
            <div className="space-y-1">
              {geminiConversations.slice(0, 8).map((convo) => (
                <div key={convo.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedConvo(expandedConvo === convo.id ? null : convo.id)}
                    className="card-hover w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-cc-hover/50 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-cc-primary/50 shrink-0">
                      <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z" />
                      <path d="M8 4a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5A.75.75 0 018 4z" />
                    </svg>
                    <span className="text-xs text-cc-fg truncate flex-1">{convo.title}</span>
                    <span className="text-[10px] text-cc-muted shrink-0">{timeAgo(new Date(convo.createdAt).getTime())}</span>
                    {convo.duration && <span className="text-[10px] text-cc-muted shrink-0">{Math.round(convo.duration / 60)}m</span>}
                  </button>
                  {expandedConvo === convo.id && (
                    <div className="ml-8 mr-2 mb-2 mt-1 space-y-1">
                      <div className="max-h-48 overflow-y-auto rounded-lg bg-cc-bg/50 p-2 space-y-1">
                        {convo.messages.map((msg, i) => (
                          <div key={i} className={`text-[11px] ${msg.role === "user" ? "text-cc-fg" : "text-cc-muted"}`}>
                            <span className="font-medium">{msg.role === "user" ? "You" : "Gemini"}:</span>{" "}
                            <span>{msg.text.slice(0, 200)}{msg.text.length > 200 ? "..." : ""}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const msgs = convo.messages.map((m) => ({ role: m.role, text: m.text }));
                          window.dispatchEvent(new CustomEvent("gemini-resume", { detail: { messages: msgs } }));
                          setExpandedConvo(null);
                        }}
                        className="mt-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
                      >
                        Continue conversation
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Active Sessions ── */}
        {runningSessions.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3 border-t border-cc-border/30 pt-4">
              <h2 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Active</h2>
              <span className="text-[10px] text-cc-muted px-1.5 py-0.5 rounded-full bg-cc-hover font-medium">{runningSessions.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {runningSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  sessionName={sessionNames.get(s.id)}
                  onClick={() => handleSelect(s.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Agent Sessions ── */}
        {agentSessions.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3 border-t border-cc-border/30 pt-4">
              <h2 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Agents</h2>
              <span className="text-[10px] text-cc-muted px-1.5 py-0.5 rounded-full bg-cc-hover font-medium">{agentSessions.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agentSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  sessionName={sessionNames.get(s.id)}
                  onClick={() => handleSelect(s.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Scheduled Sessions ── */}
        {cronSessions.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3 border-t border-cc-border/30 pt-4">
              <h2 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Scheduled</h2>
              <span className="text-[10px] text-cc-muted px-1.5 py-0.5 rounded-full bg-cc-hover font-medium">{cronSessions.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cronSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  sessionName={sessionNames.get(s.id)}
                  onClick={() => handleSelect(s.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Stopped Sessions ── */}
        {stoppedSessions.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3 border-t border-cc-border/30 pt-4">
              <h2 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Stopped</h2>
              <span className="text-[10px] text-cc-muted px-1.5 py-0.5 rounded-full bg-cc-hover font-medium">{stoppedSessions.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stoppedSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  sessionName={sessionNames.get(s.id)}
                  onClick={() => handleSelect(s.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state ── */}
        {activeSessions.length === 0 && agentSessions.length === 0 && cronSessions.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-cc-muted mb-4">No sessions yet</p>
            <button
              type="button"
              onClick={handleNewSession}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-cc-primary text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              Start your first session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
