import type { Hono } from "hono";
import { DEFAULT_OPENROUTER_MODEL, getSettings, updateSettings } from "../settings-manager.js";
import { linearCache } from "../linear-cache.js";

export function registerSettingsRoutes(api: Hono): void {
  api.get("/settings", (c) => {
    const settings = getSettings();
    return c.json({
      openrouterApiKeyConfigured: !!settings.openrouterApiKey.trim(),
      openrouterModel: settings.openrouterModel || DEFAULT_OPENROUTER_MODEL,
      linearApiKeyConfigured: !!settings.linearApiKey.trim(),
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
    });
  });

  api.put("/settings", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.openrouterApiKey !== undefined && typeof body.openrouterApiKey !== "string") {
      return c.json({ error: "openrouterApiKey must be a string" }, 400);
    }
    if (body.openrouterModel !== undefined && typeof body.openrouterModel !== "string") {
      return c.json({ error: "openrouterModel must be a string" }, 400);
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
    const hasAnyField = body.openrouterApiKey !== undefined || body.openrouterModel !== undefined
      || body.linearApiKey !== undefined || body.linearAutoTransition !== undefined
      || body.linearAutoTransitionStateId !== undefined || body.linearAutoTransitionStateName !== undefined
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
      openrouterApiKey:
        typeof body.openrouterApiKey === "string"
          ? body.openrouterApiKey.trim()
          : undefined,
      openrouterModel:
        typeof body.openrouterModel === "string"
          ? (body.openrouterModel.trim() || DEFAULT_OPENROUTER_MODEL)
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
      openrouterApiKeyConfigured: !!settings.openrouterApiKey.trim(),
      openrouterModel: settings.openrouterModel || DEFAULT_OPENROUTER_MODEL,
      linearApiKeyConfigured: !!settings.linearApiKey.trim(),
      linearAutoTransition: settings.linearAutoTransition,
      linearAutoTransitionStateName: settings.linearAutoTransitionStateName,
      editorTabEnabled: settings.editorTabEnabled,
      aiValidationEnabled: settings.aiValidationEnabled,
      aiValidationAutoApprove: settings.aiValidationAutoApprove,
      aiValidationAutoDeny: settings.aiValidationAutoDeny,
    });
  });
}
