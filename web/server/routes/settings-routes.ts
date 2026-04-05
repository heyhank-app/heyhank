import type { Hono } from "hono";
import { DEFAULT_ANTHROPIC_MODEL, getSettings, updateSettings, type UpdateChannel } from "../settings-manager.js";
import { linearCache } from "../linear-cache.js";
import { listConnections } from "../linear-connections.js";
import { hasContainerCodexAuth } from "../codex-container-auth.js";
import { hasContainerClaudeAuth } from "../claude-container-auth.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

/** Detect Claude CLI auth method */
function detectClaudeAuthStatus(): { authenticated: boolean; method: string } {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();

  // Check for credentials file (claude login)
  const credFiles = [
    join(home, ".claude", ".credentials.json"),
    join(home, ".claude", "auth.json"),
    join(home, ".claude", ".auth.json"),
    join(home, ".claude", "credentials.json"),
  ];
  if (credFiles.some((p) => existsSync(p))) {
    return { authenticated: true, method: "cli_login" };
  }

  // Check env vars
  if (process.env.ANTHROPIC_API_KEY) return { authenticated: true, method: "env_api_key" };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { authenticated: true, method: "env_oauth" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { authenticated: true, method: "env_auth_token" };

  return { authenticated: false, method: "none" };
}

/** Detect Codex CLI auth method */
function detectCodexAuthStatus(): { authenticated: boolean; method: string } {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();

  // Check for codex auth file
  const codexAuth = join(home, ".codex", "auth.json");
  if (existsSync(codexAuth)) {
    return { authenticated: true, method: "cli_login" };
  }

  // Check env var
  if (process.env.OPENAI_API_KEY) return { authenticated: true, method: "env_api_key" };

  return { authenticated: false, method: "none" };
}

/** Detect Claude CLI version */
function detectClaudeVersion(): string | null {
  try {
    return execSync("claude --version 2>/dev/null", { timeout: 3000 }).toString().trim().split("\n")[0] || null;
  } catch { return null; }
}

/** Detect Codex CLI version */
function detectCodexVersion(): string | null {
  try {
    return execSync("codex --version 2>/dev/null", { timeout: 3000 }).toString().trim().split("\n")[0] || null;
  } catch { return null; }
}

export function registerSettingsRoutes(api: Hono): void {
  api.get("/settings", (c) => {
    const settings = getSettings();
    const connections = listConnections();
    const claudeAuth = detectClaudeAuthStatus();
    const codexAuth = detectCodexAuthStatus();
    return c.json({
      anthropicApiKeyConfigured: !!settings.anthropicApiKey.trim(),
      anthropicModel: settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      claudeCodeOAuthTokenConfigured: !!settings.claudeCodeOAuthToken.trim(),
      openaiApiKeyConfigured: !!settings.openaiApiKey.trim(),
      codexDeviceAuthConfigured: hasContainerCodexAuth(),
      // Enhanced auth detection
      claudeCliAuth: { ...claudeAuth, oauthTokenConfigured: !!settings.claudeCodeOAuthToken.trim(), cliVersion: detectClaudeVersion() },
      codexCliAuth: { ...codexAuth, apiKeyConfigured: !!settings.openaiApiKey.trim(), cliVersion: detectCodexVersion() },
      onboardingCompleted: settings.onboardingCompleted,
      linearApiKeyConfigured: !!settings.linearApiKey.trim() || connections.length > 0,
      linearConnectionCount: connections.length,
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      linearArchiveTransition: settings.linearArchiveTransition,
      linearArchiveTransitionStateName: settings.linearArchiveTransitionStateName,
      linearOAuthConfigured: !!(settings.linearOAuthClientId.trim() && settings.linearOAuthClientSecret.trim() && settings.linearOAuthAccessToken.trim()),
      linearOAuthCredentialsSaved: !!(settings.linearOAuthClientId.trim() && settings.linearOAuthClientSecret.trim()),
      geminiApiKeyConfigured: !!settings.geminiApiKey.trim(),
      geminiVoice: settings.geminiVoice || "Kore",
      assistantName: settings.assistantName || "",
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
      publicUrl: settings.publicUrl,
      updateChannel: settings.updateChannel,
      dockerAutoUpdate: settings.dockerAutoUpdate,
    });
  });

  api.put("/settings", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.anthropicApiKey !== undefined && typeof body.anthropicApiKey !== "string") {
      return c.json({ error: "anthropicApiKey must be a string" }, 400);
    }
    if (body.anthropicModel !== undefined && typeof body.anthropicModel !== "string") {
      return c.json({ error: "anthropicModel must be a string" }, 400);
    }
    if (body.linearApiKey !== undefined && typeof body.linearApiKey !== "string") {
      return c.json({ error: "linearApiKey must be a string" }, 400);
    }
    if (body.linearAutoTransition !== undefined && typeof body.linearAutoTransition !== "boolean") {
      return c.json({ error: "linearAutoTransition must be a boolean" }, 400);
    }
    if (body.linearAutoTransitionStateId !== undefined && typeof body.linearAutoTransitionStateId !== "string") {
      return c.json({ error: "linearAutoTransitionStateId must be a string" }, 400);
    }
    if (body.linearAutoTransitionStateName !== undefined && typeof body.linearAutoTransitionStateName !== "string") {
      return c.json({ error: "linearAutoTransitionStateName must be a string" }, 400);
    }
    if (body.linearArchiveTransition !== undefined && typeof body.linearArchiveTransition !== "boolean") {
      return c.json({ error: "linearArchiveTransition must be a boolean" }, 400);
    }
    if (body.linearArchiveTransitionStateId !== undefined && typeof body.linearArchiveTransitionStateId !== "string") {
      return c.json({ error: "linearArchiveTransitionStateId must be a string" }, 400);
    }
    if (body.linearArchiveTransitionStateName !== undefined && typeof body.linearArchiveTransitionStateName !== "string") {
      return c.json({ error: "linearArchiveTransitionStateName must be a string" }, 400);
    }
    if (body.geminiApiKey !== undefined && typeof body.geminiApiKey !== "string") {
      return c.json({ error: "geminiApiKey must be a string" }, 400);
    }
    if (body.geminiVoice !== undefined && typeof body.geminiVoice !== "string") {
      return c.json({ error: "geminiVoice must be a string" }, 400);
    }
    if (body.editorTabEnabled !== undefined && typeof body.editorTabEnabled !== "boolean") {
      return c.json({ error: "editorTabEnabled must be a boolean" }, 400);
    }
    if (body.aiValidationEnabled !== undefined && typeof body.aiValidationEnabled !== "boolean") {
      return c.json({ error: "aiValidationEnabled must be a boolean" }, 400);
    }
    if (body.aiValidationAutoApprove !== undefined && typeof body.aiValidationAutoApprove !== "boolean") {
      return c.json({ error: "aiValidationAutoApprove must be a boolean" }, 400);
    }
    if (body.aiValidationAutoDeny !== undefined && typeof body.aiValidationAutoDeny !== "boolean") {
      return c.json({ error: "aiValidationAutoDeny must be a boolean" }, 400);
    }
    if (body.publicUrl !== undefined) {
      if (typeof body.publicUrl !== "string") {
        return c.json({ error: "publicUrl must be a string" }, 400);
      }
      const trimmed = body.publicUrl.trim().replace(/\/+$/, "");
      if (trimmed !== "" && !/^https?:\/\/.+/.test(trimmed)) {
        return c.json({ error: "publicUrl must be a valid http/https URL" }, 400);
      }
    }
    if (body.updateChannel !== undefined && body.updateChannel !== "stable" && body.updateChannel !== "prerelease") {
      return c.json({ error: "updateChannel must be 'stable' or 'prerelease'" }, 400);
    }
    if (body.linearOAuthClientId !== undefined && typeof body.linearOAuthClientId !== "string") {
      return c.json({ error: "linearOAuthClientId must be a string" }, 400);
    }
    if (body.linearOAuthClientSecret !== undefined && typeof body.linearOAuthClientSecret !== "string") {
      return c.json({ error: "linearOAuthClientSecret must be a string" }, 400);
    }
    if (body.linearOAuthWebhookSecret !== undefined && typeof body.linearOAuthWebhookSecret !== "string") {
      return c.json({ error: "linearOAuthWebhookSecret must be a string" }, 400);
    }
    if (body.claudeCodeOAuthToken !== undefined && typeof body.claudeCodeOAuthToken !== "string") {
      return c.json({ error: "claudeCodeOAuthToken must be a string" }, 400);
    }
    if (body.openaiApiKey !== undefined && typeof body.openaiApiKey !== "string") {
      return c.json({ error: "openaiApiKey must be a string" }, 400);
    }
    if (body.onboardingCompleted !== undefined && typeof body.onboardingCompleted !== "boolean") {
      return c.json({ error: "onboardingCompleted must be a boolean" }, 400);
    }
    if (body.dockerAutoUpdate !== undefined && typeof body.dockerAutoUpdate !== "boolean") {
      return c.json({ error: "dockerAutoUpdate must be a boolean" }, 400);
    }
    const hasAnyField = body.anthropicApiKey !== undefined || body.anthropicModel !== undefined
      || body.claudeCodeOAuthToken !== undefined || body.openaiApiKey !== undefined
      || body.onboardingCompleted !== undefined
      || body.linearApiKey !== undefined || body.linearAutoTransition !== undefined
      || body.linearAutoTransitionStateId !== undefined || body.linearAutoTransitionStateName !== undefined
      || body.linearArchiveTransition !== undefined || body.linearArchiveTransitionStateId !== undefined
      || body.linearArchiveTransitionStateName !== undefined
      || body.linearOAuthClientId !== undefined || body.linearOAuthClientSecret !== undefined
      || body.linearOAuthWebhookSecret !== undefined
      || body.geminiApiKey !== undefined || body.geminiVoice !== undefined || body.assistantName !== undefined
      || body.editorTabEnabled !== undefined
      || body.aiValidationEnabled !== undefined || body.aiValidationAutoApprove !== undefined
      || body.aiValidationAutoDeny !== undefined
      || body.publicUrl !== undefined
      || body.updateChannel !== undefined
      || body.dockerAutoUpdate !== undefined;
    if (!hasAnyField) {
      return c.json({ error: "At least one settings field is required" }, 400);
    }

    if (typeof body.linearApiKey === "string") {
      linearCache.clear();
    }

    const settings = updateSettings({
      anthropicApiKey:
        typeof body.anthropicApiKey === "string"
          ? body.anthropicApiKey.trim()
          : undefined,
      anthropicModel:
        typeof body.anthropicModel === "string"
          ? (body.anthropicModel.trim() || DEFAULT_ANTHROPIC_MODEL)
          : undefined,
      claudeCodeOAuthToken:
        typeof body.claudeCodeOAuthToken === "string"
          ? body.claudeCodeOAuthToken.trim()
          : undefined,
      openaiApiKey:
        typeof body.openaiApiKey === "string"
          ? body.openaiApiKey.trim()
          : undefined,
      onboardingCompleted:
        typeof body.onboardingCompleted === "boolean"
          ? body.onboardingCompleted
          : undefined,
      linearApiKey:
        typeof body.linearApiKey === "string"
          ? body.linearApiKey.trim()
          : undefined,
      linearAutoTransition:
        typeof body.linearAutoTransition === "boolean"
          ? body.linearAutoTransition
          : undefined,
      linearAutoTransitionStateId:
        typeof body.linearAutoTransitionStateId === "string"
          ? body.linearAutoTransitionStateId.trim()
          : undefined,
      linearAutoTransitionStateName:
        typeof body.linearAutoTransitionStateName === "string"
          ? body.linearAutoTransitionStateName.trim()
          : undefined,
      linearArchiveTransition:
        typeof body.linearArchiveTransition === "boolean"
          ? body.linearArchiveTransition
          : undefined,
      linearArchiveTransitionStateId:
        typeof body.linearArchiveTransitionStateId === "string"
          ? body.linearArchiveTransitionStateId.trim()
          : undefined,
      linearArchiveTransitionStateName:
        typeof body.linearArchiveTransitionStateName === "string"
          ? body.linearArchiveTransitionStateName.trim()
          : undefined,
      linearOAuthClientId:
        typeof body.linearOAuthClientId === "string"
          ? body.linearOAuthClientId.trim()
          : undefined,
      linearOAuthClientSecret:
        typeof body.linearOAuthClientSecret === "string"
          ? body.linearOAuthClientSecret.trim()
          : undefined,
      linearOAuthWebhookSecret:
        typeof body.linearOAuthWebhookSecret === "string"
          ? body.linearOAuthWebhookSecret.trim()
          : undefined,
      geminiApiKey:
        typeof body.geminiApiKey === "string"
          ? body.geminiApiKey.trim()
          : undefined,
      geminiVoice:
        typeof body.geminiVoice === "string"
          ? body.geminiVoice.trim()
          : undefined,
      assistantName:
        typeof body.assistantName === "string"
          ? body.assistantName.trim()
          : undefined,
      editorTabEnabled:
        typeof body.editorTabEnabled === "boolean"
          ? body.editorTabEnabled
          : undefined,
      aiValidationEnabled:
        typeof body.aiValidationEnabled === "boolean"
          ? body.aiValidationEnabled
          : undefined,
      aiValidationAutoApprove:
        typeof body.aiValidationAutoApprove === "boolean"
          ? body.aiValidationAutoApprove
          : undefined,
      aiValidationAutoDeny:
        typeof body.aiValidationAutoDeny === "boolean"
          ? body.aiValidationAutoDeny
          : undefined,
      publicUrl:
        typeof body.publicUrl === "string"
          ? body.publicUrl.trim().replace(/\/+$/, "")
          : undefined,
      updateChannel:
        body.updateChannel === "stable" || body.updateChannel === "prerelease"
          ? (body.updateChannel as UpdateChannel)
          : undefined,
      dockerAutoUpdate:
        typeof body.dockerAutoUpdate === "boolean"
          ? body.dockerAutoUpdate
          : undefined,
    });

    const connectionsAfterUpdate = listConnections();
    const claudeAuthAfter = detectClaudeAuthStatus();
    const codexAuthAfter = detectCodexAuthStatus();
    return c.json({
      anthropicApiKeyConfigured: !!settings.anthropicApiKey.trim(),
      anthropicModel: settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      claudeCodeOAuthTokenConfigured: !!settings.claudeCodeOAuthToken.trim(),
      openaiApiKeyConfigured: !!settings.openaiApiKey.trim(),
      codexDeviceAuthConfigured: hasContainerCodexAuth(),
      claudeCliAuth: { ...claudeAuthAfter, oauthTokenConfigured: !!settings.claudeCodeOAuthToken.trim(), cliVersion: detectClaudeVersion() },
      codexCliAuth: { ...codexAuthAfter, apiKeyConfigured: !!settings.openaiApiKey.trim(), cliVersion: detectCodexVersion() },
      onboardingCompleted: settings.onboardingCompleted,
      linearApiKeyConfigured: !!settings.linearApiKey.trim() || connectionsAfterUpdate.length > 0,
      linearConnectionCount: connectionsAfterUpdate.length,
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      linearArchiveTransition: settings.linearArchiveTransition,
      linearArchiveTransitionStateName: settings.linearArchiveTransitionStateName,
      linearOAuthConfigured: !!(settings.linearOAuthClientId.trim() && settings.linearOAuthClientSecret.trim() && settings.linearOAuthAccessToken.trim()),
      linearOAuthCredentialsSaved: !!(settings.linearOAuthClientId.trim() && settings.linearOAuthClientSecret.trim()),
      geminiApiKeyConfigured: !!settings.geminiApiKey.trim(),
      geminiVoice: settings.geminiVoice || "Kore",
      assistantName: settings.assistantName || "",
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
      publicUrl: settings.publicUrl,
      updateChannel: settings.updateChannel,
      dockerAutoUpdate: settings.dockerAutoUpdate,
    });
  });

  api.post("/settings/anthropic/verify", async (c) => {
    const body = await c.req.json().catch(() => ({} as { apiKey?: string }));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return c.json({ valid: false, error: "API key is required" }, 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });

      if (res.ok) {
        return c.json({ valid: true });
      }
      return c.json({ valid: false, error: `API returned ${res.status}` });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return c.json({ valid: false, error: isAbort ? "Request timed out" : "Request failed" });
    } finally {
      clearTimeout(timer);
    }
  });
}
