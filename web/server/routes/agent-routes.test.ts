import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock agent-store module ────────────────────────────────────────────────
// Mocked before imports so every `import` of agent-store gets the mock.
vi.mock("../agent-store.js", () => ({
  listAgents: vi.fn(() => []),
  getAgent: vi.fn(() => null),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(() => false),
  regenerateWebhookSecret: vi.fn(() => null),
}));

import { Hono } from "hono";
import * as agentStore from "../agent-store.js";
import type { AgentConfig } from "../agent-types.js";
import { registerAgentRoutes } from "./agent-routes.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal agent fixture with sensible defaults. Override fields as needed. */
function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "test-agent",
    version: 1,
    name: "Test Agent",
    description: "A test agent",
    backendType: "claude",
    model: "claude-sonnet-4-6",
    permissionMode: "bypassPermissions",
    cwd: "/tmp/test",
    prompt: "Do something useful",
    enabled: true,
    createdAt: 1000,
    updatedAt: 2000,
    totalRuns: 0,
    consecutiveFailures: 0,
    ...overrides,
  };
}

/** Build a mock AgentExecutor with vi.fn() stubs for every method the routes use. */
function createMockExecutor() {
  return {
    getNextRunTime: vi.fn(() => null as Date | null),
    scheduleAgent: vi.fn(),
    stopAgent: vi.fn(),
    executeAgentManually: vi.fn(),
    getExecutions: vi.fn(() => []),
  };
}

// ─── Test setup ─────────────────────────────────────────────────────────────

let app: Hono;
let executor: ReturnType<typeof createMockExecutor>;

beforeEach(() => {
  vi.clearAllMocks();

  executor = createMockExecutor();

  // Create a Hono app and mount agent routes under /api
  app = new Hono();
  const api = new Hono();
  registerAgentRoutes(api, executor as any);
  app.route("/api", api);
});

// ─── GET /api/agents ────────────────────────────────────────────────────────

describe("GET /api/agents", () => {
  it("returns an empty list when no agents exist", async () => {
    vi.mocked(agentStore.listAgents).mockReturnValue([]);

    const res = await app.request("/api/agents");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("returns the list of agents enriched with nextRunAt", async () => {
    const agent = makeAgent();
    vi.mocked(agentStore.listAgents).mockReturnValue([agent]);
    const nextRun = new Date("2026-03-01T00:00:00Z");
    executor.getNextRunTime.mockReturnValue(nextRun);

    const res = await app.request("/api/agents");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe("test-agent");
    // nextRunAt should be the epoch ms of the returned Date
    expect(json[0].nextRunAt).toBe(nextRun.getTime());
  });
});

// ─── POST /api/agents ───────────────────────────────────────────────────────

describe("POST /api/agents", () => {
  it("creates an agent and returns 201", async () => {
    const created = makeAgent({ id: "my-agent", name: "My Agent" });
    vi.mocked(agentStore.createAgent).mockReturnValue(created);

    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Agent", prompt: "Hello" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("my-agent");
    expect(agentStore.createAgent).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the store throws a validation error", async () => {
    // e.g. missing name
    vi.mocked(agentStore.createAgent).mockImplementation(() => {
      throw new Error("Agent name is required");
    });

    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Agent name is required");
  });

  it("schedules the agent when enabled with a schedule trigger", async () => {
    const created = makeAgent({
      enabled: true,
      triggers: {
        schedule: { enabled: true, expression: "*/5 * * * *", recurring: true },
      },
    });
    vi.mocked(agentStore.createAgent).mockReturnValue(created);

    await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Scheduled Agent",
        prompt: "Run periodically",
        triggers: { schedule: { enabled: true, expression: "*/5 * * * *", recurring: true } },
      }),
    });

    expect(executor.scheduleAgent).toHaveBeenCalledWith(created);
  });
});

// ─── GET /api/agents/:id ────────────────────────────────────────────────────

describe("GET /api/agents/:id", () => {
  it("returns the agent when it exists", async () => {
    const agent = makeAgent({ id: "existing" });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/existing");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("existing");
  });

  it("returns 404 when the agent does not exist", async () => {
    vi.mocked(agentStore.getAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent");

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Agent not found");
  });

  it("enriches the agent with nextRunAt from the executor", async () => {
    const agent = makeAgent({ id: "scheduled" });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);
    const nextRun = new Date("2026-06-15T12:00:00Z");
    executor.getNextRunTime.mockReturnValue(nextRun);

    const res = await app.request("/api/agents/scheduled");

    const json = await res.json();
    expect(json.nextRunAt).toBe(nextRun.getTime());
  });
});

// ─── PUT /api/agents/:id ────────────────────────────────────────────────────

describe("PUT /api/agents/:id", () => {
  it("updates the agent and returns the updated version", async () => {
    const updated = makeAgent({ id: "test-agent", name: "Updated Name" });
    vi.mocked(agentStore.updateAgent).mockReturnValue(updated);

    const res = await app.request("/api/agents/test-agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Updated Name");
    // Should only pass editable fields to updateAgent
    expect(agentStore.updateAgent).toHaveBeenCalledWith(
      "test-agent",
      expect.objectContaining({ name: "Updated Name" }),
    );
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.updateAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(res.status).toBe(404);
  });

  it("strips non-editable fields from the update payload", async () => {
    // Fields like 'id', 'createdAt', 'totalRuns' should NOT be passed through
    const updated = makeAgent();
    vi.mocked(agentStore.updateAgent).mockReturnValue(updated);

    await app.request("/api/agents/test-agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Good Field",
        id: "hacked-id",
        createdAt: 9999,
        totalRuns: 999,
      }),
    });

    const passedUpdates = vi.mocked(agentStore.updateAgent).mock.calls[0][1];
    expect(passedUpdates).toHaveProperty("name", "Good Field");
    // Non-editable fields should be stripped by pickEditable
    expect(passedUpdates).not.toHaveProperty("id");
    expect(passedUpdates).not.toHaveProperty("createdAt");
    expect(passedUpdates).not.toHaveProperty("totalRuns");
  });

  it("reschedules the agent when schedule trigger is enabled", async () => {
    const updated = makeAgent({
      enabled: true,
      triggers: {
        schedule: { enabled: true, expression: "0 * * * *", recurring: true },
      },
    });
    vi.mocked(agentStore.updateAgent).mockReturnValue(updated);

    await app.request("/api/agents/test-agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Agent" }),
    });

    expect(executor.scheduleAgent).toHaveBeenCalledWith(updated);
  });

  it("stops the agent schedule when disabled", async () => {
    const updated = makeAgent({ enabled: false });
    vi.mocked(agentStore.updateAgent).mockReturnValue(updated);

    await app.request("/api/agents/test-agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    expect(executor.stopAgent).toHaveBeenCalledWith(updated.id);
  });
});

// ─── DELETE /api/agents/:id ─────────────────────────────────────────────────

describe("DELETE /api/agents/:id", () => {
  it("deletes an existing agent and stops its executor", async () => {
    vi.mocked(agentStore.deleteAgent).mockReturnValue(true);

    const res = await app.request("/api/agents/test-agent", { method: "DELETE" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(executor.stopAgent).toHaveBeenCalledWith("test-agent");
    expect(agentStore.deleteAgent).toHaveBeenCalledWith("test-agent");
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.deleteAgent).mockReturnValue(false);

    const res = await app.request("/api/agents/nonexistent", { method: "DELETE" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Agent not found");
  });
});

// ─── POST /api/agents/:id/toggle ───────────────────────────────────────────

describe("POST /api/agents/:id/toggle", () => {
  it("toggles an enabled agent to disabled", async () => {
    const agent = makeAgent({ id: "my-agent", enabled: true });
    const toggled = makeAgent({ id: "my-agent", enabled: false });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);
    vi.mocked(agentStore.updateAgent).mockReturnValue(toggled);

    const res = await app.request("/api/agents/my-agent/toggle", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(false);
    // Should have called updateAgent with enabled: false (opposite of current)
    expect(agentStore.updateAgent).toHaveBeenCalledWith("my-agent", { enabled: false });
    // When toggled off, should stop the agent
    expect(executor.stopAgent).toHaveBeenCalledWith("my-agent");
  });

  it("toggles a disabled agent to enabled and reschedules if schedule trigger active", async () => {
    const agent = makeAgent({ id: "my-agent", enabled: false });
    const toggled = makeAgent({
      id: "my-agent",
      enabled: true,
      triggers: {
        schedule: { enabled: true, expression: "0 * * * *", recurring: true },
      },
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);
    vi.mocked(agentStore.updateAgent).mockReturnValue(toggled);

    const res = await app.request("/api/agents/my-agent/toggle", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(true);
    expect(executor.scheduleAgent).toHaveBeenCalledWith(toggled);
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.getAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent/toggle", { method: "POST" });

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/agents/:id/run ───────────────────────────────────────────────

describe("POST /api/agents/:id/run", () => {
  it("triggers a manual agent run", async () => {
    const agent = makeAgent({ id: "runner" });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/runner/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.message).toBe("Agent triggered");
    expect(executor.executeAgentManually).toHaveBeenCalledWith("runner", undefined);
  });

  it("passes an input string to the executor when provided", async () => {
    const agent = makeAgent({ id: "runner" });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    await app.request("/api/agents/runner/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "custom input" }),
    });

    expect(executor.executeAgentManually).toHaveBeenCalledWith("runner", "custom input");
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.getAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/agents/import ────────────────────────────────────────────────

describe("POST /api/agents/import", () => {
  it("imports an agent from exported JSON and returns 201 with enabled=false", async () => {
    // Import should always set enabled to false for safety
    const importedAgent = makeAgent({ id: "imported", name: "Imported Agent", enabled: false });
    vi.mocked(agentStore.createAgent).mockReturnValue(importedAgent);

    const res = await app.request("/api/agents/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Imported Agent",
        prompt: "Do stuff",
        backendType: "claude",
        model: "claude-sonnet-4-6",
        permissionMode: "bypassPermissions",
        cwd: "/tmp",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.enabled).toBe(false);
    // createAgent should be called with enabled: false (safety)
    expect(agentStore.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("returns 400 when store throws a validation error", async () => {
    vi.mocked(agentStore.createAgent).mockImplementation(() => {
      throw new Error("Agent name is required");
    });

    const res = await app.request("/api/agents/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Agent name is required");
  });
});

// ─── GET /api/agents/:id/export ─────────────────────────────────────────────

describe("GET /api/agents/:id/export", () => {
  it("exports an agent as JSON without internal tracking fields", async () => {
    const agent = makeAgent({
      id: "exportable",
      name: "Exportable Agent",
      totalRuns: 42,
      consecutiveFailures: 2,
      lastRunAt: 3000,
      lastSessionId: "sess-xyz",
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/exportable/export");

    expect(res.status).toBe(200);
    const json = await res.json();
    // Should include portable config fields
    expect(json.name).toBe("Exportable Agent");
    expect(json.prompt).toBe("Do something useful");
    // Should NOT include internal tracking fields
    expect(json).not.toHaveProperty("id");
    expect(json).not.toHaveProperty("createdAt");
    expect(json).not.toHaveProperty("updatedAt");
    expect(json).not.toHaveProperty("totalRuns");
    expect(json).not.toHaveProperty("consecutiveFailures");
    expect(json).not.toHaveProperty("lastRunAt");
    expect(json).not.toHaveProperty("lastSessionId");
    expect(json).not.toHaveProperty("enabled");
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.getAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent/export");

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/agents/:id/webhook/:secret ───────────────────────────────────

describe("POST /api/agents/:id/webhook/:secret", () => {
  it("triggers the agent via webhook with a valid secret", async () => {
    const agent = makeAgent({
      id: "webhook-agent",
      triggers: {
        webhook: { enabled: true, secret: "valid-secret-123" },
      },
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/webhook-agent/webhook/valid-secret-123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "webhook payload" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.message).toBe("Agent triggered via webhook");
    expect(executor.executeAgentManually).toHaveBeenCalledWith("webhook-agent", "webhook payload");
  });

  it("returns 401 when the webhook secret is invalid", async () => {
    const agent = makeAgent({
      id: "webhook-agent",
      triggers: {
        webhook: { enabled: true, secret: "correct-secret" },
      },
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/webhook-agent/webhook/wrong-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid webhook secret");
    // Should NOT trigger the agent
    expect(executor.executeAgentManually).not.toHaveBeenCalled();
  });

  it("returns 403 when the webhook trigger is disabled", async () => {
    const agent = makeAgent({
      id: "webhook-agent",
      triggers: {
        webhook: { enabled: false, secret: "some-secret" },
      },
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/webhook-agent/webhook/some-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Webhook not enabled for this agent");
    expect(executor.executeAgentManually).not.toHaveBeenCalled();
  });

  it("returns 404 when agent does not exist", async () => {
    vi.mocked(agentStore.getAgent).mockReturnValue(null);

    const res = await app.request("/api/agents/nonexistent/webhook/any-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("accepts plain text body as webhook input", async () => {
    // The webhook endpoint should also accept plain text (non-JSON) as input
    const agent = makeAgent({
      id: "webhook-agent",
      triggers: {
        webhook: { enabled: true, secret: "valid-secret" },
      },
    });
    vi.mocked(agentStore.getAgent).mockReturnValue(agent);

    const res = await app.request("/api/agents/webhook-agent/webhook/valid-secret", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text input",
    });

    expect(res.status).toBe(200);
    expect(executor.executeAgentManually).toHaveBeenCalledWith("webhook-agent", "plain text input");
  });
});
