import { installClipboardWriteFallback } from "./clipboard.js";

export type Route =
  | { page: "home" }
  | { page: "session"; sessionId: string }
  | { page: "settings" }
  | { page: "integrations" }
  | { page: "integration-linear" }
  | { page: "prompts" }
  | { page: "terminal" }
  | { page: "environments" }
  | { page: "scheduled" }
  | { page: "agents" }
  | { page: "agent-detail"; agentId: string }
  | { page: "playground" };

const SESSION_PREFIX = "#/session/";
const AGENT_PREFIX = "#/agents/";
let clipboardFallbackInitialized = false;

function ensureClipboardFallbackInstalled(): void {
  if (clipboardFallbackInitialized) return;
  installClipboardWriteFallback();
  clipboardFallbackInitialized = true;
}

/**
 * Parse a window.location.hash string into a typed Route.
 */
export function parseHash(hash: string): Route {
  ensureClipboardFallbackInstalled();

  if (hash === "#/settings") return { page: "settings" };
  if (hash === "#/integrations") return { page: "integrations" };
  if (hash === "#/integrations/linear") return { page: "integration-linear" };
  if (hash === "#/prompts") return { page: "prompts" };
  if (hash === "#/terminal") return { page: "terminal" };
  if (hash === "#/environments") return { page: "environments" };
  // #/scheduled redirects to #/agents (cron absorbed into agents)
  if (hash === "#/scheduled") return { page: "agents" };
  if (hash === "#/agents") return { page: "agents" };
  if (hash === "#/playground") return { page: "playground" };

  if (hash.startsWith(AGENT_PREFIX)) {
    const agentId = hash.slice(AGENT_PREFIX.length);
    if (agentId) return { page: "agent-detail", agentId };
  }

  if (hash.startsWith(SESSION_PREFIX)) {
    const sessionId = hash.slice(SESSION_PREFIX.length);
    if (sessionId) return { page: "session", sessionId };
  }

  return { page: "home" };
}

/**
 * Build a hash string for a given session ID.
 */
export function sessionHash(sessionId: string): string {
  return `#/session/${sessionId}`;
}

/**
 * Navigate to a session by updating the URL hash.
 * When replace=true, uses replaceState to avoid creating a history entry.
 */
export function navigateToSession(sessionId: string, replace = false): void {
  ensureClipboardFallbackInstalled();

  const newHash = sessionHash(sessionId);
  if (replace) {
    history.replaceState(null, "", newHash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = `/session/${sessionId}`;
  }
}

/**
 * Navigate to the home page (no session selected) by clearing the hash.
 * When replace=true, uses replaceState to avoid creating a history entry.
 */
export function navigateHome(replace = false): void {
  ensureClipboardFallbackInstalled();

  if (replace) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = "";
  }
}
