// ─── Agent Timeout Management ────────────────────────────────────────────────
// Monitors agent sessions and kills those that exceed time limits

import type { CliLauncher, SdkSessionInfo } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { isKilled } from "./kill-switch.js";
import { notifyAgentAlert } from "./push-notifications.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout per agent session (30 minutes) — hard ceiling against session.createdAt. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Check interval (every 60 seconds) */
const CHECK_INTERVAL_MS = 60 * 1000;

/** Default idle timeout (3 minutes since last messageHistory entry).
 *  Catches agent sessions that completed their turn and now sit idle waiting
 *  for a user-message that will never come (agent-executor injects only the
 *  initial prompt; after the final `result` Claude Code idles indefinitely). */
const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

/** Agent-specific hard ceilings (in ms) — measured against `session.createdAt`.
 *  Use this only as a safety net. The primary kill path is now AGENT_IDLE_TIMEOUTS.
 *  Set `null` to opt out of the hard ceiling (interactive long-running agents).
 */
const AGENT_TIMEOUTS: Record<string, number | null> = {
  "monitoring-agent": 5 * 60 * 1000,    // 5 min (should be quick)
  "personal-agent": 10 * 60 * 1000,     // 10 min
  "coding-agent": 60 * 60 * 1000,       // 60 min (complex tasks)
  "marketing-agent": 30 * 60 * 1000,    // 30 min
  // Image-heavy: 5 stories × 4 frames + 3 carousels × 8 slides ≈ 44 gpt-image-2 renders
  // × ~15s each = ~11 min pure image-gen, plus skill-read, library-fetch, JSON-build,
  // final review. The previous 30-min ceiling killed sessions mid-carousel.
  "content-agent": 90 * 60 * 1000,      // 90 min
  "agent-max": 60 * 60 * 1000,          // 60 min (meta-agent)
  // Interactive director: user iterates on brief between phases, then waits for
  // long-running fal.ai/Veo renders (5-10 min per beat × multiple beats × retries).
  // A single fixed ceiling can't bound that, and the 4h variant killed legit
  // sessions mid-render. Disable; rely on idle-timeout.
  "video-director": null,
};

/** Per-agent idle timeout — measured against last messageHistory entry.
 *  Triggers separately from AGENT_TIMEOUTS. Set `null` to opt out of idle kill. */
const AGENT_IDLE_TIMEOUTS: Record<string, number | null> = {
  // gpt-image-2 calls take ~15s and emit tool-use events that count as activity,
  // so 3 min idle reliably means the agent is done and waiting on phantom user input.
  "content-agent": 3 * 60 * 1000,
  // Coding sessions sometimes pause to think; give them more headroom.
  "coding-agent": 10 * 60 * 1000,
  // Director waits for fal.ai renders (long-running, no activity in between) — opt out.
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

    // ─── Hard ceiling (max runtime since session start) ─────────────────────
    const configuredMax = AGENT_TIMEOUTS[agentId];
    if (configuredMax !== null) {
      const timeout = configuredMax ?? DEFAULT_TIMEOUT_MS;
      const elapsed = now - session.createdAt;
      if (elapsed > timeout) {
        console.warn(
          `[agent-timeout] Session ${session.sessionId.slice(0, 8)} for agent "${agentId}" ` +
          `exceeded max runtime (${Math.round(elapsed / 60000)}m > ${Math.round(timeout / 60000)}m). Killing.`,
        );
        try {
          launcher.kill(session.sessionId);
          notifyAgentAlert(
            agentId,
            `Session timed out after ${Math.round(elapsed / 60000)} minutes (max runtime)`,
            "warning",
          ).catch(() => {});
        } catch {
          // ignore
        }
        continue; // already killed; skip idle check
      }
    }

    // ─── Idle timeout (since last messageHistory entry) ─────────────────────
    const configuredIdle = AGENT_IDLE_TIMEOUTS[agentId];
    if (configuredIdle === null) continue; // explicit opt-out
    const idleTimeout = configuredIdle ?? DEFAULT_IDLE_TIMEOUT_MS;
    const lastActivity = wsBridge.getLastActivityTs(session.sessionId);
    // If no messages yet, fall back to session start (covers very early hangs).
    const referenceTs = lastActivity ?? session.createdAt;
    const idleMs = now - referenceTs;
    // Grace period: only consider idle after at least one minute since start
    // (avoids killing sessions that haven't begun emitting yet).
    if (idleMs > idleTimeout && now - session.createdAt > 60 * 1000) {
      console.warn(
        `[agent-timeout] Session ${session.sessionId.slice(0, 8)} for agent "${agentId}" ` +
        `idle for ${Math.round(idleMs / 60000)}m (limit ${Math.round(idleTimeout / 60000)}m). Killing.`,
      );
      try {
        launcher.kill(session.sessionId);
        notifyAgentAlert(
          agentId,
          `Session idle-killed after ${Math.round(idleMs / 60000)} minutes of inactivity`,
          "warning",
        ).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
}

/** Get timeout config for an agent (for API). `null` means timeout is disabled. */
export function getTimeoutConfig(): {
  maxRuntime: Record<string, number | null>;
  idle: Record<string, number | null>;
} {
  return {
    maxRuntime: { ...AGENT_TIMEOUTS, _default: DEFAULT_TIMEOUT_MS },
    idle: { ...AGENT_IDLE_TIMEOUTS, _default: DEFAULT_IDLE_TIMEOUT_MS },
  };
}
