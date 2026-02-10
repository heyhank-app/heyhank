import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { connectSession, disconnectSession } from "../ws.js";

export function Sidebar() {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const sessions = useStore((s) => s.sessions);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setCurrentSession = useStore((s) => s.setCurrentSession);
  const darkMode = useStore((s) => s.darkMode);
  const toggleDarkMode = useStore((s) => s.toggleDarkMode);
  const cliConnected = useStore((s) => s.cliConnected);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const removeSession = useStore((s) => s.removeSession);
  const sessionNames = useStore((s) => s.sessionNames);
  const pendingPermissions = useStore((s) => s.pendingPermissions);

  // Poll for SDK sessions on mount
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const list = await api.listSessions();
        if (active) useStore.getState().setSdkSessions(list);
      } catch {
        // server not ready
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  function handleSelectSession(sessionId: string) {
    if (currentSessionId === sessionId) return;
    // Disconnect from old session, connect to new
    if (currentSessionId) {
      disconnectSession(currentSessionId);
    }
    setCurrentSession(sessionId);
    connectSession(sessionId);
    // Close sidebar on mobile
    if (window.innerWidth < 768) {
      useStore.getState().setSidebarOpen(false);
    }
  }

  function handleNewSession() {
    if (currentSessionId) {
      disconnectSession(currentSessionId);
    }
    useStore.getState().newSession();
    if (window.innerWidth < 768) {
      useStore.getState().setSidebarOpen(false);
    }
  }

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  function confirmRename() {
    if (editingSessionId && editingName.trim()) {
      useStore.getState().setSessionName(editingSessionId, editingName.trim());
    }
    setEditingSessionId(null);
    setEditingName("");
  }

  function cancelRename() {
    setEditingSessionId(null);
    setEditingName("");
  }

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      disconnectSession(sessionId);
      await api.deleteSession(sessionId);
    } catch {
      // best-effort
    }
    removeSession(sessionId);
  }, [removeSession]);

  // Combine sessions from WsBridge state + SDK sessions list
  const allSessionIds = new Set<string>();
  for (const id of sessions.keys()) allSessionIds.add(id);
  for (const s of sdkSessions) allSessionIds.add(s.sessionId);

  const sessionList = Array.from(allSessionIds).map((id) => {
    const bridgeState = sessions.get(id);
    const sdkInfo = sdkSessions.find((s) => s.sessionId === id);
    return {
      id,
      model: bridgeState?.model || sdkInfo?.model || "",
      cwd: bridgeState?.cwd || sdkInfo?.cwd || "",
      gitBranch: bridgeState?.git_branch || "",
      linesAdded: bridgeState?.total_lines_added || 0,
      linesRemoved: bridgeState?.total_lines_removed || 0,
      isConnected: cliConnected.get(id) ?? false,
      status: sessionStatus.get(id) ?? null,
      sdkState: sdkInfo?.state ?? null,
      createdAt: sdkInfo?.createdAt ?? 0,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside className="w-[260px] h-full flex flex-col bg-cc-sidebar border-r border-cc-border">
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-cc-primary flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white">
              <path d="M8 9h8M8 13h5M21 12c0 4.97-4.03 9-9 9a8.96 8.96 0 01-4.57-1.24L3 21l1.24-4.43A8.96 8.96 0 013 12c0-4.97 4.03-9 9-9s9 4.03 9 9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-cc-fg tracking-tight">The Vibe Companion</span>
        </div>

        <button
          onClick={handleNewSession}
          className="w-full py-2 px-3 text-sm font-medium rounded-[10px] bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessionList.length === 0 ? (
          <p className="px-3 py-8 text-xs text-cc-muted text-center leading-relaxed">
            No sessions yet.
          </p>
        ) : (
          <div className="space-y-0.5">
            {sessionList.map((s) => {
              const isActive = currentSessionId === s.id;
              const name = sessionNames.get(s.id);
              const shortId = s.id.slice(0, 8);
              const label = name || s.model || shortId;
              const dirName = s.cwd ? s.cwd.split("/").pop() : "";
              const isRunning = s.status === "running";
              const isCompacting = s.status === "compacting";
              const isEditing = editingSessionId === s.id;
              const permCount = pendingPermissions.get(s.id)?.size ?? 0;

              return (
                <div key={s.id} className="relative group">
                  <button
                    onClick={() => handleSelectSession(s.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setEditingSessionId(s.id);
                      setEditingName(label);
                    }}
                    className={`w-full px-3 py-2.5 pr-8 text-left rounded-[10px] transition-all duration-100 cursor-pointer ${
                      isActive
                        ? "bg-cc-active"
                        : "hover:bg-cc-hover"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="relative flex shrink-0">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            permCount > 0
                              ? "bg-cc-warning"
                              : s.sdkState === "exited"
                              ? "bg-cc-muted opacity-40"
                              : s.isConnected
                              ? isRunning
                                ? "bg-cc-success"
                                : isCompacting
                                ? "bg-cc-warning"
                                : "bg-cc-success opacity-60"
                              : "bg-cc-muted opacity-40"
                          }`}
                        />
                        {permCount > 0 && (
                          <span className="absolute inset-0 w-2 h-2 rounded-full bg-cc-warning/40 animate-[pulse-dot_1.5s_ease-in-out_infinite]" />
                        )}
                        {permCount === 0 && isRunning && s.isConnected && (
                          <span className="absolute inset-0 w-2 h-2 rounded-full bg-cc-success/40 animate-[pulse-dot_1.5s_ease-in-out_infinite]" />
                        )}
                      </span>
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              confirmRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                            e.stopPropagation();
                          }}
                          onBlur={confirmRename}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="text-[13px] font-medium flex-1 text-cc-fg bg-transparent border border-cc-border rounded-md px-1 py-0 outline-none focus:border-cc-primary/50 min-w-0"
                        />
                      ) : (
                        <span className="text-[13px] font-medium truncate flex-1 text-cc-fg">
                          {label}
                        </span>
                      )}
                    </div>
                    {dirName && (
                      <p className="text-[11px] text-cc-muted truncate mt-0.5 ml-4">
                        {dirName}
                      </p>
                    )}
                    {s.gitBranch && (
                      <div className="flex items-center gap-1.5 mt-0.5 ml-4 text-[11px] text-cc-muted">
                        <span className="flex items-center gap-1 truncate">
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 opacity-60">
                            <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.116.862a2.25 2.25 0 10-.862.862A4.48 4.48 0 007.25 7.5h-1.5A2.25 2.25 0 003.5 9.75v.318a2.25 2.25 0 101.5 0V9.75a.75.75 0 01.75-.75h1.5a5.98 5.98 0 003.884-1.435A2.25 2.25 0 109.634 3.362zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                          </svg>
                          <span className="truncate">{s.gitBranch}</span>
                        </span>
                        {(s.linesAdded > 0 || s.linesRemoved > 0) && (
                          <span className="flex items-center gap-1 shrink-0">
                            <span className="text-green-500">+{s.linesAdded}</span>
                            <span className="text-red-400">-{s.linesRemoved}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                  {permCount > 0 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-cc-warning text-white text-[10px] font-bold leading-none px-1 group-hover:opacity-0 transition-opacity pointer-events-none">
                      {permCount}
                    </span>
                  )}
                  <button
                    onClick={(e) => handleDeleteSession(e, s.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-cc-border text-cc-muted hover:text-cc-fg transition-all cursor-pointer"
                    title="Delete session"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: dark mode toggle */}
      <div className="p-3 border-t border-cc-border">
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        >
          {darkMode ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
          <span>{darkMode ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>

    </aside>
  );
}
