// ─── Chat Platform Webhook Routes ───────────────────────────────────────────
// These routes handle incoming webhooks from external platforms (Linear, GitHub,
// Slack, etc.) via the Vercel Chat SDK. Platform adapters handle their own
// signature verification, so webhook routes bypass Companion's auth middleware.
//
// Two route patterns:
// 1. Legacy global:    POST /api/chat/webhooks/:platform       (deprecated, env-var based)
// 2. Agent-scoped:     POST /api/agents/:agentId/chat/webhooks/:platform  (per-agent credentials)

import type { Hono } from "hono";
import type { ChatBot } from "../chat-bot.js";

/**
 * Register the legacy global webhook ingestion route (before auth middleware).
 * Platform adapters validate their own signatures (e.g., Linear HMAC).
 * Deprecated: prefer agent-scoped webhook routes.
 */
export function registerChatWebhookRoutes(api: Hono, chatBot: ChatBot): void {
  api.post("/chat/webhooks/:platform", async (c) => {
    const platform = c.req.param("platform");
    const handler = chatBot.webhooks[platform];

    if (!handler) {
      return c.json({ error: "Unknown platform" }, 404);
    }

    try {
      c.header("X-Deprecated", "Use POST /api/agents/:agentId/chat/webhooks/:platform instead");
      return await handler(c.req.raw, {
        waitUntil: (task: Promise<unknown>) => {
          task.catch((err) => console.error("[chat-routes] Background task error:", err));
        },
      });
    } catch (err) {
      console.error(`[chat-routes] Error handling ${platform} webhook:`, err);
      return c.json({ error: "Internal error processing webhook" }, 500);
    }
  });
}

/**
 * Register agent-scoped webhook routes (before auth middleware).
 * Each agent with chat credentials gets its own webhook endpoint.
 * Platform adapters verify signatures using the per-binding webhook secret.
 */
export function registerAgentChatWebhookRoutes(api: Hono, chatBot: ChatBot): void {
  api.post("/agents/:agentId/chat/webhooks/:platform", async (c) => {
    const agentId = c.req.param("agentId");
    const platform = c.req.param("platform");

    const handler = chatBot.getWebhookHandler(agentId, platform);
    if (!handler) {
      return c.json({ error: "No chat handler configured for this agent/platform" }, 404);
    }

    try {
      return await handler(c.req.raw, {
        waitUntil: (task: Promise<unknown>) => {
          task.catch((err) => console.error(`[chat-routes] Background task error (agent ${agentId}):`, err));
        },
      });
    } catch (err) {
      console.error(`[chat-routes] Error handling ${platform} webhook for agent ${agentId}:`, err);
      return c.json({ error: "Internal error processing webhook" }, 500);
    }
  });
}

/**
 * Register auth-protected chat routes (after auth middleware).
 */
export function registerChatProtectedRoutes(api: Hono, chatBot: ChatBot): void {
  /**
   * GET /chat/platforms
   * Lists configured chat platforms — both legacy global and per-agent.
   */
  api.get("/chat/platforms", (c) => {
    return c.json({
      platforms: chatBot.platforms,
      agentPlatforms: chatBot.listAgentPlatforms(),
    });
  });
}
