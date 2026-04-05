// ─── Agent Timeout Management ────────────────────────────────────────────────
// Monitors agent sessions and kills those that exceed time limits

import type { CliLauncher, SdkSessionInfo } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { isKilled } from "./kill-switch.js";
import { notifyAgentAlert } from "./push-notifications.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout per agent session (30 minutes) */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Check interval (every 60 seconds) */
const CHECK_INTERVAL_MS = 60 * 1000;

/** Agent-specific timeouts (in ms) */
const AGENT_TIMEOUTS: Record<string, number> = {
  "monitoring-agent": 5 * 60 * 1000,    // 5 min (should be quick)
  "personal-agent": 10 * 60 * 1000,     // 10 min
  "coding-agent": 60 * 60 * 1000,       // 60 min (complex tasks)
  "marketing-agent": 30 * 60 * 1000,    // 30 min
  "content-agent": 30 * 60 * 1000,      // 30 min
  "agent-max": 60 * 60 * 1000,          // 60 min (meta-agent)
};

// ─── Timeout Manager ─────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startTimeoutMonitor(
  launcher: CliLauncher,
  wsBridge: WsBridge,
): void {
  if (intervalId) return; // Already running

  intervalId = setInterval(() => {
    checkTimeouts(launcher, wsBridge);
  }, CHECK_INTERVAL_MS);

  // Don't keep process alive just for this timer
  if (intervalId && typeof intervalId === "object" && "unref" in intervalId) {
    intervalId.unref();
  }

  console.log("[agent-timeout] Timeout monitor started");
}

export function stopTimeoutMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function checkTimeouts(launcher: CliLauncher, wsBridge: WsBridge): void {
  // If kill switch is active, kill everything
  if (isKilled()) {
    const sessions = launcher.listSessions();
    for (const session of sessions) {
      if (session.state === "running" || session.state === "connected") {
        try {
          launcher.kill(session.sessionId);
          console.log(`[agent-timeout] Kill switch: killed session ${session.sessionId.slice(0, 8)}`);
        } catch {
          // ignore
        }
      }
    }
    return;
  }

  const now = Date.now();
  const sessions = launcher.listSessions();

  for (const session of sessions) {
    if (session.state !== "running" && session.state !== "connected") continue;

    const agentId = (session as SdkSessionInfo & { agentId?: string }).agentId;
    if (!agentId) continue; // Only timeout agent sessions

    const timeout = AGENT_TIMEOUTS[agentId] ?? DEFAULT_TIMEOUT_MS;
    const elapsed = now - session.createdAt;

    if (elapsed > timeout) {
      console.warn(
        `[agent-timeout] Session ${session.sessionId.slice(0, 8)} for agent "${agentId}" ` +
        `exceeded timeout (${Math.round(elapsed / 60000)}m > ${Math.round(timeout / 60000)}m). Killing.`,
      );
      try {
        launcher.kill(session.sessionId);
        notifyAgentAlert(
          agentId,
          `Session timed out after ${Math.round(elapsed / 60000)} minutes`,
          "warning",
        ).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
}

/** Get timeout config for an agent (for API). */
export function getTimeoutConfig(): Record<string, number> {
  return { ...AGENT_TIMEOUTS, _default: DEFAULT_TIMEOUT_MS };
}
