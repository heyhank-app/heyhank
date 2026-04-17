// ─── Claude Auth Monitor ────────────────────────────────────────────────────
// Monitors Claude sessions for auth failures and attempts automatic re-auth.

import { getSettings, updateSettings } from "./settings-manager.js";
import { EventEmitter } from "node:events";

export const authEvents = new EventEmitter();

export type AuthStatus = "ok" | "warning" | "expired" | "unknown";

interface AuthState {
  status: AuthStatus;
  lastCheck: number;
  lastError?: string;
  refreshAttempts: number;
}

let currentState: AuthState = {
  status: "unknown",
  lastCheck: 0,
  refreshAttempts: 0,
};

// Patterns that indicate auth failure in CLI stderr
const AUTH_FAILURE_PATTERNS = [
  /401/i,
  /unauthorized/i,
  /token expired/i,
  /invalid.*bearer.*token/i,
  /authentication.*failed/i,
  /oauth.*error/i,
  /EAUTH/i,
];

/** Check if a stderr line indicates an auth failure */
export function isAuthFailure(line: string): boolean {
  return AUTH_FAILURE_PATTERNS.some(p => p.test(line));
}

/** Called when an auth failure is detected in CLI output */
export function reportAuthFailure(error: string, sessionId?: string): void {
  currentState = {
    status: "expired",
    lastCheck: Date.now(),
    lastError: error,
    refreshAttempts: currentState.refreshAttempts,
  };
  authEvents.emit("auth:failure", { error, sessionId });
  console.log(`[auth-monitor] Auth failure detected: ${error}`);

  // Auto-attempt refresh if we haven't tried too many times
  if (currentState.refreshAttempts < 3) {
    attemptRefresh().catch(() => {});
  }
}

/** Attempt to refresh the OAuth token */
export async function attemptRefresh(): Promise<boolean> {
  currentState.refreshAttempts++;
  console.log(`[auth-monitor] Attempting token refresh (attempt ${currentState.refreshAttempts})`);

  try {
    const settings = getSettings();
    const token = settings.claudeCodeOAuthToken;

    if (!token) {
      console.log("[auth-monitor] No OAuth token configured, cannot refresh");
      currentState.status = "expired";
      authEvents.emit("auth:refresh-failed", { reason: "no_token" });
      return false;
    }

    // Try to validate the current token by making a test request
    const testRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropicApiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
    });

    if (testRes.ok || testRes.status === 400) {
      // Token works (400 = bad request but auth is fine)
      currentState = { status: "ok", lastCheck: Date.now(), refreshAttempts: 0 };
      authEvents.emit("auth:refreshed");
      console.log("[auth-monitor] Token validated successfully");
      return true;
    }

    if (testRes.status === 401) {
      currentState.status = "expired";
      authEvents.emit("auth:refresh-failed", { reason: "token_invalid" });
      console.log("[auth-monitor] Token is invalid (401)");
      return false;
    }

    // Other errors — mark as warning
    currentState.status = "warning";
    authEvents.emit("auth:refresh-failed", { reason: `http_${testRes.status}` });
    return false;
  } catch (err) {
    console.log(`[auth-monitor] Refresh error: ${err instanceof Error ? err.message : err}`);
    currentState.status = "warning";
    authEvents.emit("auth:refresh-failed", { reason: "network_error" });
    return false;
  }
}

/** Get current auth status */
export function getAuthStatus(): AuthState {
  return { ...currentState };
}

/** Mark auth as OK (e.g., after successful session start) */
export function markAuthOk(): void {
  currentState = { status: "ok", lastCheck: Date.now(), refreshAttempts: 0 };
}

/** Reset auth state */
export function resetAuthState(): void {
  currentState = { status: "unknown", lastCheck: 0, refreshAttempts: 0 };
}
