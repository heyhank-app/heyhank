// ─── Chat Platform Webhook Routes ───────────────────────────────────────────
// These routes handle incoming webhooks from external platforms (Linear, GitHub,
// Slack, etc.) via the Vercel Chat SDK. Platform adapters handle their own
// signature verification, so the webhook route bypasses Companion's auth middleware.

import type { Hono } from "hono";
import type { ChatBot } from "../chat-bot.js";

/**
 * Register only the webhook ingestion route (before auth middleware).
 * Platform adapters validate their own signatures (e.g., Linear HMAC).
 */
export function registerChatWebhookRoutes(api: Hono, chatBot: ChatBot): void {
  api.post("/chat/webhooks/:platform", async (c) => {
    const platform = c.req.param("platform");
    const handler = chatBot.webhooks[platform];

    if (!handler) {
      return c.json({ error: "Unknown platform" }, 404);
    }

    try {
      // Chat SDK handlers expect raw Request and return raw Response.
      // Bun doesn't need waitUntil — all processing is in-process.
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
 * Register auth-protected chat routes (after auth middleware).
 */
export function registerChatProtectedRoutes(api: Hono, chatBot: ChatBot): void {
  /**
   * GET /chat/platforms
   * Lists configured chat platforms (requires Companion auth).
   */
  api.get("/chat/platforms", (c) => {
    return c.json({ platforms: chatBot.platforms });
  });
}
