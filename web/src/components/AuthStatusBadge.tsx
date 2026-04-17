// ─── Auth Status Badge ──────────────────────────────────────────────────────
// Shows Claude auth status in TopBar: green (ok), yellow (warning), red (expired)

import { useState, useEffect } from "react";

type AuthStatus = "ok" | "warning" | "expired" | "unknown";

interface AuthState {
  status: AuthStatus;
  lastCheck: number;
  lastError?: string;
  refreshAttempts: number;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("heyhank_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function AuthStatusBadge() {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const check = () => {
      fetch("/api/claude/auth-status", { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(data => setAuthState(data))
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!authState || authState.status === "ok" || authState.status === "unknown") return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/claude/auth-refresh", {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      setAuthState(data);
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const handleOpenTerminal = () => {
    // Navigate to terminal with claude /login pre-filled
    window.location.hash = "#/terminal?cmd=claude+%2Flogin";
  };

  const needsManualLogin = authState.status === "expired" && authState.refreshAttempts >= 3;

  const colors = {
    warning: "bg-yellow-500",
    expired: "bg-red-500",
  };

  const labels = {
    warning: "Auth Warning",
    expired: "Auth Expired",
  };

  if (needsManualLogin) {
    return (
      <button
        type="button"
        onClick={handleOpenTerminal}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
        title="Auto-refresh failed. Click to open terminal and run claude /login"
      >
        <span className="w-2 h-2 rounded-full bg-red-300 animate-pulse" />
        <span>Login Required</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-cc-hover hover:bg-cc-active transition-colors cursor-pointer"
      title={authState.lastError || labels[authState.status] || "Auth issue"}
    >
      <span className={`w-2 h-2 rounded-full ${colors[authState.status] || "bg-cc-muted"} ${refreshing ? "animate-pulse" : ""}`} />
      <span className="text-cc-muted">{refreshing ? "Refreshing..." : labels[authState.status]}</span>
    </button>
  );
}
