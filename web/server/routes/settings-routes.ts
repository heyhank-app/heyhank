import type { Hono } from "hono";
import { DEFAULT_ANTHROPIC_MODEL, getSettings, updateSettings } from "../settings-manager.js";
import { linearCache } from "../linear-cache.js";

export function registerSettingsRoutes(api: Hono): void {
  api.get("/settings", (c) => {
    const settings = getSettings();
    return c.json({
      anthropicApiKeyConfigured: !!settings.anthropicApiKey.trim(),
      anthropicModel: settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      linearApiKeyConfigured: !!settings.linearApiKey.trim(),
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      linearArchiveTransition: settings.linearArchiveTransition,
      linearArchiveTransitionStateName: settings.linearArchiveTransitionStateName,
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
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
    const hasAnyField = body.anthropicApiKey !== undefined || body.anthropicModel !== undefined
      || body.linearApiKey !== undefined || body.linearAutoTransition !== undefined
      || body.linearAutoTransitionStateId !== undefined || body.linearAutoTransitionStateName !== undefined
      || body.linearArchiveTransition !== undefined || body.linearArchiveTransitionStateId !== undefined
      || body.linearArchiveTransitionStateName !== undefined
      || body.editorTabEnabled !== undefined
      || body.aiValidationEnabled !== undefined || body.aiValidationAutoApprove !== undefined
      || body.aiValidationAutoDeny !== undefined;
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
    });

    return c.json({
      anthropicApiKeyConfigured: !!settings.anthropicApiKey.trim(),
      anthropicModel: settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      linearApiKeyConfigured: !!settings.linearApiKey.trim(),
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      linearArchiveTransition: settings.linearArchiveTransition,
      linearArchiveTransitionStateName: settings.linearArchiveTransitionStateName,
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
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
