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

/** Agent-specific timeouts (in ms).
 *
 * NOTE: This is currently evaluated against `session.createdAt`, not
 * "last activity". Interactive agents that wait for human input between
 * phases should set a generous ceiling — or `null` to disable the
 * time-based kill entirely (only kill-switch / manual stop applies).
 * TODO: switch to activity-based timeout (reset on user_message / assistant
 * output) so the limit only catches genuinely abandoned/runaway sessions.
 */
const AGENT_TIMEOUTS: Record<string, number | null> = {
  "monitoring-agent": 5 * 60 * 1000,    // 5 min (should be quick)
  "personal-agent": 10 * 60 * 1000,     // 10 min
  "coding-agent": 60 * 60 * 1000,       // 60 min (complex tasks)
  "marketing-agent": 30 * 60 * 1000,    // 30 min
  "content-agent": 30 * 60 * 1000,      // 30 min
  "agent-max": 60 * 60 * 1000,          // 60 min (meta-agent)
  // Interactive director: user iterates on brief between phases, then waits for
  // long-running fal.ai/Veo renders (5-10 min per beat × multiple beats × retries).
  // A single fixed ceiling can't bound that, and the 4h variant killed legit
  // sessions mid-render. Disable until activity-based timeout lands.
  "video-director": null,
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

    const configured = AGENT_TIMEOUTS[agentId];
    if (configured === null) continue; // explicit opt-out (interactive long-running agents)
    const timeout = configured ?? DEFAULT_TIMEOUT_MS;
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

/** Get timeout config for an agent (for API). `null` means timeout is disabled. */
export function getTimeoutConfig(): Record<string, number | null> {
  return { ...AGENT_TIMEOUTS, _default: DEFAULT_TIMEOUT_MS };
}
