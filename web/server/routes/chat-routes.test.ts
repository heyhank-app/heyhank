import { vi, describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerChatWebhookRoutes, registerChatProtectedRoutes } from "./chat-routes.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a mock ChatBot instance with vi.fn() stubs. */
function createMockChatBot() {
  return {
    webhooks: {} as Record<string, (req: Request, opts?: { waitUntil?: (task: Promise<unknown>) => void }) => Promise<Response>>,
    platforms: [] as string[],
  };
}

// ─── Test setup ─────────────────────────────────────────────────────────────

let app: Hono;
let chatBot: ReturnType<typeof createMockChatBot>;

beforeEach(() => {
  vi.clearAllMocks();
  chatBot = createMockChatBot();

  app = new Hono();
  const api = new Hono();
  // Webhook routes are registered before auth, platform listing after
  registerChatWebhookRoutes(api, chatBot as any);
  registerChatProtectedRoutes(api, chatBot as any);
  app.route("/api", api);
});

// ─── POST /api/chat/webhooks/:platform ──────────────────────────────────────

describe("POST /api/chat/webhooks/:platform", () => {
  it("returns 404 for an unknown platform", async () => {
    // No webhook handlers configured
    chatBot.webhooks = {};

    const res = await app.request("/api/chat/webhooks/slack", { method: "POST" });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Unknown platform");
  });

  it("delegates to the platform webhook handler and returns its response", async () => {
    // Configure a mock handler for the "linear" platform that returns a 200
    const mockHandler = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    chatBot.webhooks = { linear: mockHandler };

    const res = await app.request("/api/chat/webhooks/linear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandler).toHaveBeenCalledTimes(1);

    // The handler should receive a Request object and waitUntil
    const call = mockHandler.mock.calls[0] as unknown as [Request, { waitUntil?: (task: Promise<unknown>) => void }];
    expect(call[0]).toBeInstanceOf(Request);
    expect(typeof call[1]?.waitUntil).toBe("function");
  });

  it("returns 500 when the platform handler throws", async () => {
    // Configure a handler that throws
    chatBot.webhooks = {
      github: vi.fn(async () => { throw new Error("handler exploded"); }),
    };

    const res = await app.request("/api/chat/webhooks/github", { method: "POST" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Internal error");
  });
});

// ─── GET /api/chat/platforms ─────────────────────────────────────────────────

describe("GET /api/chat/platforms", () => {
  it("returns empty list when no platforms are configured", async () => {
    chatBot.platforms = [];

    const res = await app.request("/api/chat/platforms");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toEqual([]);
  });

  it("lists all configured platform names", async () => {
    chatBot.platforms = ["linear", "slack"];

    const res = await app.request("/api/chat/platforms");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toEqual(["linear", "slack"]);
  });
});
