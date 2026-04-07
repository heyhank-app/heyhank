/**
 * REST API routes for provider management
 */
import type { Hono } from "hono";
import { getAllProviders, getProviderById } from "../provider-registry.js";
import {
  listProviderConfigs,
  getProviderConfig,
  upsertProviderConfig,
  deleteProviderConfig,
} from "../provider-manager.js";

export function registerProviderRoutes(app: Hono): void {
  // Static registry — all known providers with their metadata
  app.get("/providers/registry", (c) => {
    return c.json(getAllProviders());
  });

  // User's configured providers — merged with registry metadata, secrets masked
  app.get("/providers", (c) => {
    const registry = getAllProviders();
    const configs = listProviderConfigs();
    const configMap = new Map(configs.map((cfg) => [cfg.providerId, cfg]));

    const merged = registry.map((def) => {
      const cfg = configMap.get(def.id);
      const envConfigured: Record<string, boolean> = {};
      for (const field of def.envFields) {
        envConfigured[field.key] = !!(cfg?.envValues[field.key]);
      }
      return {
        ...def,
        configured: !!cfg,
        enabled: cfg?.enabled ?? false,
        envConfigured,
        customModel: cfg?.customModel ?? undefined,
      };
    });

    return c.json(merged);
  });

  // Single provider detail
  app.get("/providers/:id", (c) => {
    const id = c.req.param("id");
    const def = getProviderById(id);
    if (!def) return c.json({ error: "Unknown provider" }, 404);

    const cfg = getProviderConfig(id);
    const envConfigured: Record<string, boolean> = {};
    // For non-secret fields, also return the actual value
    const envValues: Record<string, string> = {};
    for (const field of def.envFields) {
      envConfigured[field.key] = !!(cfg?.envValues[field.key]);
      if (!field.secret && cfg?.envValues[field.key]) {
        envValues[field.key] = cfg.envValues[field.key];
      }
    }

    return c.json({
      ...def,
      configured: !!cfg,
      enabled: cfg?.enabled ?? false,
      envConfigured,
      envValues,
      customModel: cfg?.customModel ?? undefined,
    });
  });

  // Create or update a provider config
  app.put("/providers/:id", async (c) => {
    const id = c.req.param("id");
    const def = getProviderById(id);
    if (!def) return c.json({ error: "Unknown provider" }, 404);

    const body = await c.req.json();
    const config = upsertProviderConfig(id, {
      enabled: body.enabled,
      envValues: body.envValues,
      customModel: body.customModel,
    });

    // Return masked response
    const envConfigured: Record<string, boolean> = {};
    const envValues: Record<string, string> = {};
    for (const field of def.envFields) {
      envConfigured[field.key] = !!(config.envValues[field.key]);
      if (!field.secret && config.envValues[field.key]) {
        envValues[field.key] = config.envValues[field.key];
      }
    }

    return c.json({
      ...def,
      configured: true,
      enabled: config.enabled,
      envConfigured,
      envValues,
      customModel: config.customModel ?? undefined,
    });
  });

  // Delete a provider config
  app.delete("/providers/:id", (c) => {
    const id = c.req.param("id");
    const deleted = deleteProviderConfig(id);
    return c.json({ ok: deleted });
  });
}
