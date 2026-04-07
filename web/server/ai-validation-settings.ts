import { getSettings } from "./settings-manager.js";
import { hasInternalAI } from "./internal-ai.js";
import type { SessionState } from "./session-types.js";

export interface EffectiveAiValidationSettings {
  enabled: boolean;
  autoApprove: boolean;
  autoDeny: boolean;
  /** @deprecated Use hasInternalAI() instead. Kept for backward compat in ws-bridge checks. */
  anthropicApiKey: string;
}

/**
 * Resolve effective AI validation settings for a session.
 * Session-level overrides take priority; falls back to global settings.
 */
export function getEffectiveAiValidation(
  sessionState: SessionState,
): EffectiveAiValidationSettings {
  const global = getSettings();
  return {
    enabled:
      sessionState.aiValidationEnabled != null
        ? sessionState.aiValidationEnabled
        : global.aiValidationEnabled,
    autoApprove:
      sessionState.aiValidationAutoApprove != null
        ? sessionState.aiValidationAutoApprove
        : global.aiValidationAutoApprove,
    autoDeny:
      sessionState.aiValidationAutoDeny != null
        ? sessionState.aiValidationAutoDeny
        : global.aiValidationAutoDeny,
    // For backward compat: return a truthy string if any AI provider is available
    anthropicApiKey: hasInternalAI() ? "configured" : "",
  };
}
