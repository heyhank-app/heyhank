import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Module mocks (before imports) ──────────────────────────────────────────

// Mock the Chat SDK modules — they require external API keys we don't have in tests.
const mockOnNewMention = vi.fn();
const mockOnSubscribedMessage = vi.fn();
const mockChatShutdown = vi.fn();
const mockChatWebhooks = { linear: vi.fn() };

vi.mock("chat", () => ({
  Chat: class MockChat {
    onNewMention = mockOnNewMention;
    onSubscribedMessage = mockOnSubscribedMessage;
    shutdown = mockChatShutdown;
    webhooks = mockChatWebhooks;
  },
  ConsoleLogger: class MockConsoleLogger {
    constructor(_level?: string) {}
  },
}));

vi.mock("@chat-adapter/linear", () => ({
  createLinearAdapter: vi.fn(() => ({ type: "linear-adapter" })),
}));

vi.mock("@chat-adapter/state-memory", () => ({
  createMemoryState: vi.fn(() => ({})),
}));

vi.mock("./agent-store.js", () => ({
  listAgents: vi.fn(() => []),
  getAgent: vi.fn(() => null),
}));

import { ChatBot } from "./chat-bot.js";
import * as agentStore from "./agent-store.js";
import type { AgentConfig } from "./agent-types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "agent-1",
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
    triggers: {
      chat: {
        enabled: true,
        platforms: [{ adapter: "linear", autoSubscribe: true }],
      },
    },
    ...overrides,
  };
}

function createMockExecutor() {
  return {
    executeAgent: vi.fn().mockResolvedValue({ sessionId: "test-session-1" }),
  };
}

function createMockWsBridge() {
  return {
    onAssistantMessageForSession: vi.fn(() => vi.fn()), // returns unsubscribe fn
    onResultForSession: vi.fn(() => vi.fn()),
    injectUserMessage: vi.fn(),
  };
}

function createMockThread(overrides: Partial<{
  id: string;
  state: { sessionId: string; agentId: string } | null;
}> = {}) {
  return {
    id: overrides.id || "linear:issue-123",
    post: vi.fn(),
    startTyping: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
    get state() {
      return Promise.resolve(overrides.state || null);
    },
  };
}

// ─── Environment setup ──────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Set env vars so ChatBot.initialize() enables the Linear adapter
  process.env.LINEAR_API_KEY = "test-api-key";
  process.env.LINEAR_WEBHOOK_SECRET = "test-webhook-secret";
});

afterEach(() => {
  // Restore env
  process.env = { ...originalEnv };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ChatBot", () => {
  describe("initialize()", () => {
    it("returns true when LINEAR_API_KEY and LINEAR_WEBHOOK_SECRET are set", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const result = bot.initialize();

      expect(result).toBe(true);
    });

    it("returns false when no platform env vars are set", () => {
      delete process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_WEBHOOK_SECRET;

      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const result = bot.initialize();

      expect(result).toBe(false);
    });

    it("registers onNewMention and onSubscribedMessage handlers", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      bot.initialize();

      expect(mockOnNewMention).toHaveBeenCalledTimes(1);
      expect(mockOnSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("webhooks", () => {
    it("returns empty object when not initialized", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      // Not calling initialize()
      expect(bot.webhooks).toEqual({});
    });

    it("returns webhook handlers when initialized", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      bot.initialize();

      // Our mock Chat SDK returns { linear: vi.fn() } as webhooks
      expect(bot.webhooks).toBeDefined();
      expect(typeof bot.webhooks.linear).toBe("function");
    });
  });

  describe("platforms", () => {
    it("returns list of platform names from webhooks", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      bot.initialize();

      expect(bot.platforms).toContain("linear");
    });
  });

  describe("handleMention (via onNewMention callback)", () => {
    it("finds a matching agent and starts a session", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      // Set up agent store to return a matching agent
      const agent = makeAgent({ id: "agent-linear" });
      vi.mocked(agentStore.listAgents).mockReturnValue([agent]);

      // Get the handler registered with onNewMention
      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-456" });
      const message = { text: "help me with this issue" };

      await mentionHandler(thread, message);

      // Should have called executeAgent with the agent ID and message text
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-linear",
        "help me with this issue",
        { force: true, triggerType: "chat" },
      );

      // Should have stored state and subscribed
      expect(thread.setState).toHaveBeenCalledWith({
        sessionId: "test-session-1",
        agentId: "agent-linear",
      });
      expect(thread.subscribe).toHaveBeenCalled();
    });

    it("posts an error message when no agent matches the platform", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      // No agents configured
      vi.mocked(agentStore.listAgents).mockReturnValue([]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-789" });

      await mentionHandler(thread, { text: "hello" });

      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("No agent is configured"),
      );
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("posts an error when agent execution fails", async () => {
      const executor = createMockExecutor();
      executor.executeAgent.mockResolvedValue(null); // Execution failed
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-111" });

      await mentionHandler(thread, { text: "do something" });

      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start agent session"),
      );
    });

    it("sets up response relay with wsBridge listeners", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-222" });

      await mentionHandler(thread, { text: "test relay" });

      // Should register listeners on the wsBridge for the session
      expect(wsBridge.onAssistantMessageForSession).toHaveBeenCalledWith(
        "test-session-1",
        expect.any(Function),
      );
      expect(wsBridge.onResultForSession).toHaveBeenCalledWith(
        "test-session-1",
        expect.any(Function),
      );
    });

    it("skips globally disabled agents", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      // Agent has chat enabled but is globally disabled
      const agent = makeAgent({ enabled: false });
      vi.mocked(agentStore.listAgents).mockReturnValue([agent]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-disabled" });

      await mentionHandler(thread, { text: "help" });

      // Should not match the disabled agent
      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("No agent is configured"),
      );
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("respects mentionPattern filter", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      // Agent only responds to messages matching "@bot"
      const agent = makeAgent({
        triggers: {
          chat: {
            enabled: true,
            platforms: [{ adapter: "linear", mentionPattern: "@bot", autoSubscribe: true }],
          },
        },
      });
      vi.mocked(agentStore.listAgents).mockReturnValue([agent]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-333" });

      // Message that doesn't match the pattern
      await mentionHandler(thread, { text: "hello world" });

      // Should not have matched
      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("No agent is configured"),
      );

      // Message that matches
      vi.clearAllMocks();
      await mentionHandler(thread, { text: "@bot help me" });
      expect(executor.executeAgent).toHaveBeenCalled();
    });
  });

  describe("handleSubscribedMessage (via onSubscribedMessage callback)", () => {
    it("injects a message into the existing session", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      const subscribedHandler = mockOnSubscribedMessage.mock.calls[0][0];
      const thread = createMockThread({
        id: "linear:issue-444",
        state: { sessionId: "existing-session", agentId: "agent-1" },
      });

      await subscribedHandler(thread, { text: "follow up question" });

      expect(wsBridge.injectUserMessage).toHaveBeenCalledWith(
        "existing-session",
        "follow up question",
      );
      expect(thread.startTyping).toHaveBeenCalled();
    });

    it("re-wires response relay before injecting follow-up message", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      const subscribedHandler = mockOnSubscribedMessage.mock.calls[0][0];
      const thread = createMockThread({
        id: "linear:issue-relay",
        state: { sessionId: "existing-session", agentId: "agent-1" },
      });

      await subscribedHandler(thread, { text: "follow up" });

      // Should re-register listeners on the wsBridge for the session
      // (setupResponseRelay is called before injectUserMessage)
      expect(wsBridge.onAssistantMessageForSession).toHaveBeenCalledWith(
        "existing-session",
        expect.any(Function),
      );
      expect(wsBridge.onResultForSession).toHaveBeenCalledWith(
        "existing-session",
        expect.any(Function),
      );
      expect(wsBridge.injectUserMessage).toHaveBeenCalledWith(
        "existing-session",
        "follow up",
      );
    });

    it("falls back to handleMention when thread has no session state", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      const subscribedHandler = mockOnSubscribedMessage.mock.calls[0][0];
      // Thread with no state — should fall back to handleMention
      const thread = createMockThread({ id: "linear:issue-555", state: null });

      await subscribedHandler(thread, { text: "new topic" });

      // Should have started a new session via executeAgent
      expect(executor.executeAgent).toHaveBeenCalled();
    });
  });

  describe("cleanupSession()", () => {
    it("calls all stored unsubscribers for a session", async () => {
      const executor = createMockExecutor();
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      const wsBridge = createMockWsBridge();
      wsBridge.onAssistantMessageForSession.mockReturnValue(unsub1);
      wsBridge.onResultForSession.mockReturnValue(unsub2);
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      // Trigger a mention to set up response relay
      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-666" });
      await mentionHandler(thread, { text: "test" });

      // Now cleanup the session
      bot.cleanupSession("test-session-1");

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
    });

    it("does nothing for unknown session IDs", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      // Should not throw
      bot.cleanupSession("nonexistent-session");
    });
  });

  describe("shutdown()", () => {
    it("cleans up all sessions and shuts down Chat SDK", async () => {
      const executor = createMockExecutor();
      const unsub = vi.fn();
      const wsBridge = createMockWsBridge();
      wsBridge.onAssistantMessageForSession.mockReturnValue(unsub);
      wsBridge.onResultForSession.mockReturnValue(vi.fn());
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      // Set up a session relay
      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      await mentionHandler(createMockThread({ id: "linear:i-1" }), { text: "t" });

      await bot.shutdown();

      expect(unsub).toHaveBeenCalled();
      expect(mockChatShutdown).toHaveBeenCalled();
    });
  });

  // ─── Per-agent runtime tests ────────────────────────────────────────────────

  describe("per-agent runtime (credentials)", () => {
    /**
     * Helper: creates an agent with per-binding credentials on the linear adapter.
     * These agents should get their own Chat SDK runtime (as opposed to using the
     * legacy global handler that reads from env vars).
     */
    function makeAgentWithCredentials(overrides: Partial<AgentConfig> = {}): AgentConfig {
      return makeAgent({
        id: "agent-creds",
        name: "Agent With Creds",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "test-api-key",
                webhookSecret: "test-webhook-secret",
              },
            }],
          },
        },
        ...overrides,
      });
    }

    it("creates a runtime when agent has chat credentials", () => {
      // When an agent has per-binding credentials, initializeAgentRuntime should
      // create a Chat SDK instance and return true.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      const result = bot.initializeAgentRuntime(agent);

      expect(result).toBe(true);
    });

    it("returns false for agents without credentials", () => {
      // Agents without per-binding credentials should NOT get a per-agent runtime.
      // They rely on the legacy global handler (env-var based) instead.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      // Default makeAgent() has no credentials on its platform binding
      const agent = makeAgent();
      const result = bot.initializeAgentRuntime(agent);

      expect(result).toBe(false);
    });

    it("returns false for disabled agents", () => {
      // Even if the agent has credentials, a disabled agent should not be initialized.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials({ enabled: false });
      const result = bot.initializeAgentRuntime(agent);

      expect(result).toBe(false);
    });

    it("returns false when chat trigger is disabled", () => {
      // Agent has credentials but the chat trigger itself is disabled.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials({
        triggers: {
          chat: {
            enabled: false,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "test-api-key",
                webhookSecret: "test-webhook-secret",
              },
            }],
          },
        },
      });
      const result = bot.initializeAgentRuntime(agent);

      expect(result).toBe(false);
    });

    it("getWebhookHandler returns handler for initialized agent", () => {
      // After initializeAgentRuntime succeeds, getWebhookHandler should return
      // the webhook handler function for the agent's platform.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      const handler = bot.getWebhookHandler("agent-creds", "linear");

      // The mock Chat SDK returns { linear: vi.fn() } as webhooks
      expect(handler).toBeDefined();
      expect(typeof handler).toBe("function");
    });

    it("getWebhookHandler returns null for unknown agent", () => {
      // Querying a webhook handler for a non-existent agent should return null.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const handler = bot.getWebhookHandler("nonexistent-agent", "linear");

      expect(handler).toBeNull();
    });

    it("getWebhookHandler returns null for unknown platform on existing agent", () => {
      // Agent exists but the requested platform is not configured.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      const handler = bot.getWebhookHandler("agent-creds", "slack");

      expect(handler).toBeNull();
    });

    it("listAgentPlatforms returns correct data for initialized agents", () => {
      // listAgentPlatforms should return an entry per agent runtime with the
      // agent's ID, name, and list of platform adapters.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      // getAgent is called by listAgentPlatforms to resolve the human-readable name
      vi.mocked(agentStore.getAgent).mockReturnValue(agent);

      const result = bot.listAgentPlatforms();

      expect(result).toEqual([
        {
          agentId: "agent-creds",
          agentName: "Agent With Creds",
          platforms: ["linear"],
        },
      ]);
    });

    it("listAgentPlatforms falls back to agentId when getAgent returns null", () => {
      // If the agent was deleted from the store but its runtime is still active,
      // listAgentPlatforms should use the agentId as the display name.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      // getAgent returns null — agent has been deleted from store
      vi.mocked(agentStore.getAgent).mockReturnValue(null);

      const result = bot.listAgentPlatforms();

      expect(result).toEqual([
        {
          agentId: "agent-creds",
          agentName: "agent-creds", // falls back to ID
          platforms: ["linear"],
        },
      ]);
    });

    it("listAgentPlatforms returns empty array when no agent runtimes exist", () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const result = bot.listAgentPlatforms();

      expect(result).toEqual([]);
    });

    it("initialize() creates per-agent runtimes from stored agent credentials", () => {
      // When initialize() is called and there are agents with credentials in the store,
      // it should create per-agent runtimes in addition to the legacy global instance.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agentWithCreds = makeAgentWithCredentials();
      vi.mocked(agentStore.listAgents).mockReturnValue([agentWithCreds]);

      const result = bot.initialize();

      expect(result).toBe(true);
      // Should have a webhook handler for the agent's platform
      const handler = bot.getWebhookHandler("agent-creds", "linear");
      expect(handler).toBeDefined();
    });
  });

  describe("reloadAgent()", () => {
    function makeAgentWithCredentials(overrides: Partial<AgentConfig> = {}): AgentConfig {
      return makeAgent({
        id: "agent-reload",
        name: "Agent Reload Test",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "test-api-key",
                webhookSecret: "test-webhook-secret",
              },
            }],
          },
        },
        ...overrides,
      });
    }

    it("shuts down old runtime and creates new one from current config", async () => {
      // reloadAgent should: remove the existing runtime (shutting down its Chat SDK),
      // then re-initialize from the current agent config in the store.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      // First, initialize an agent runtime
      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      // Verify runtime exists before reload
      expect(bot.getWebhookHandler("agent-reload", "linear")).toBeDefined();

      // Mock getAgent to return updated agent config
      const updatedAgent = makeAgentWithCredentials({ name: "Updated Agent" });
      vi.mocked(agentStore.getAgent).mockReturnValue(updatedAgent);

      // The Chat SDK shutdown mock tracks calls — clear to isolate
      mockChatShutdown.mockClear();

      await bot.reloadAgent("agent-reload");

      // The old runtime should have been shut down
      expect(mockChatShutdown).toHaveBeenCalledTimes(1);

      // A new runtime should exist (getWebhookHandler still works)
      expect(bot.getWebhookHandler("agent-reload", "linear")).toBeDefined();
    });

    it("handles non-existent agents gracefully (no runtime to remove)", async () => {
      // Reloading an agent that has no existing runtime should not throw.
      // If getAgent returns a valid config, it should create a new runtime.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials({ id: "agent-new" });
      vi.mocked(agentStore.getAgent).mockReturnValue(agent);

      // Should not throw even though there is no existing runtime for "agent-new"
      await bot.reloadAgent("agent-new");

      // Since getAgent returned a valid agent, a new runtime should be created
      // Note: getWebhookHandler uses the ID passed to reloadAgent, which is "agent-new",
      // but initializeAgentRuntime registers under the agent's own ID ("agent-reload" from helper).
      // We passed id: "agent-new" to the override, but the helper's base uses id: "agent-reload".
      // Actually we passed overrides {id: "agent-new"}, so the agent.id is "agent-new" but
      // reloadAgent was called with "agent-new" and getAgent("agent-new") returned the agent.
      // initializeAgentRuntime registers under agent.id which is "agent-new" due to override.
      expect(bot.getWebhookHandler("agent-new", "linear")).toBeDefined();
    });

    it("does nothing when getAgent returns null (agent deleted)", async () => {
      // If the agent was deleted from the store, reloadAgent should remove the
      // old runtime (if any) but not create a new one.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgentWithCredentials();
      bot.initializeAgentRuntime(agent);

      // Agent has been deleted from the store
      vi.mocked(agentStore.getAgent).mockReturnValue(null);
      mockChatShutdown.mockClear();

      await bot.reloadAgent("agent-reload");

      // Old runtime should be shut down
      expect(mockChatShutdown).toHaveBeenCalledTimes(1);
      // No new runtime should exist
      expect(bot.getWebhookHandler("agent-reload", "linear")).toBeNull();
    });
  });

  describe("removeAgent()", () => {
    it("shuts down and deletes the runtime for an existing agent", async () => {
      // removeAgent should call shutdown on the agent's Chat SDK instance and
      // remove it from the internal runtimes map.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const agent = makeAgent({
        id: "agent-remove",
        name: "Agent To Remove",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "test-api-key",
                webhookSecret: "test-webhook-secret",
              },
            }],
          },
        },
      });
      bot.initializeAgentRuntime(agent);

      // Verify the runtime exists
      expect(bot.getWebhookHandler("agent-remove", "linear")).toBeDefined();

      mockChatShutdown.mockClear();

      await bot.removeAgent("agent-remove");

      // The Chat SDK for this agent should have been shut down
      expect(mockChatShutdown).toHaveBeenCalledTimes(1);
      // The runtime should no longer be accessible
      expect(bot.getWebhookHandler("agent-remove", "linear")).toBeNull();
    });

    it("does nothing for unknown agents (no throw, no shutdown call)", async () => {
      // Removing an agent that was never initialized should be a no-op.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      mockChatShutdown.mockClear();

      // Should not throw
      await bot.removeAgent("nonexistent-agent");

      // Should not have called shutdown on anything
      expect(mockChatShutdown).not.toHaveBeenCalled();
    });
  });

  describe("legacy global handler skips agents with credentials", () => {
    /**
     * The legacy global handler (env-var based) should skip agents that have
     * per-binding credentials, since those agents use agent-scoped webhook handlers
     * instead. This prevents double-handling of messages.
     */
    it("skips agents with per-binding credentials in favor of agent-scoped handlers", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      // Initialize with legacy env vars so we get a global handler
      bot.initialize();

      // Agent store has one agent WITH credentials — the legacy handler should skip it
      const agentWithCreds = makeAgent({
        id: "agent-with-creds",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "cred-api-key",
                webhookSecret: "cred-webhook-secret",
              },
            }],
          },
        },
      });
      vi.mocked(agentStore.listAgents).mockReturnValue([agentWithCreds]);

      // Get the legacy global mention handler
      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-legacy-skip" });

      await mentionHandler(thread, { text: "help me" });

      // The legacy handler should NOT have matched this agent (it has credentials)
      // and should post the "No agent is configured" message instead.
      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("No agent is configured"),
      );
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("matches agents WITHOUT credentials via the legacy global handler", async () => {
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      bot.initialize();

      // Agent WITHOUT credentials — the legacy handler SHOULD match it
      const agentNoCreds = makeAgent({
        id: "agent-no-creds",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{ adapter: "linear", autoSubscribe: true }],
          },
        },
      });
      vi.mocked(agentStore.listAgents).mockReturnValue([agentNoCreds]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-legacy-match" });

      await mentionHandler(thread, { text: "help me" });

      // The legacy handler should have matched and started a session
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-no-creds",
        "help me",
        { force: true, triggerType: "chat" },
      );
    });

    it("skips credentialed agent and matches next non-credentialed agent", async () => {
      // When the agent store has both a credentialed and a non-credentialed agent,
      // the legacy handler should skip the first and match the second.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      bot.initialize();

      const agentWithCreds = makeAgent({
        id: "agent-creds",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "key",
                webhookSecret: "secret",
              },
            }],
          },
        },
      });
      const agentNoCreds = makeAgent({
        id: "agent-legacy",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{ adapter: "linear", autoSubscribe: true }],
          },
        },
      });
      vi.mocked(agentStore.listAgents).mockReturnValue([agentWithCreds, agentNoCreds]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:issue-mixed" });

      await mentionHandler(thread, { text: "hello" });

      // Should match the non-credentialed agent, skipping the credentialed one
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-legacy",
        "hello",
        { force: true, triggerType: "chat" },
      );
    });
  });

  // ─── Agent-scoped handler tests ────────────────────────────────────────────
  // These test the handlers registered by initializeAgentRuntime(), which route
  // mentions and subscribed messages directly to a specific agent (no scanning).

  describe("agent-scoped mention handler", () => {
    /**
     * Helper: initializes a per-agent runtime and returns the agent-scoped
     * mention and subscribed-message handlers registered with the mock Chat SDK.
     * Since each new Chat() instance calls the same mockOnNewMention/mockOnSubscribedMessage,
     * the agent-scoped handlers are always the LAST registered callbacks.
     */
    function setupAgentRuntime(bot: ChatBot, executor: ReturnType<typeof createMockExecutor>, agentOverrides: Partial<AgentConfig> = {}) {
      const agent = makeAgent({
        id: "agent-scoped-1",
        name: "Agent Scoped",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "scoped-api-key",
                webhookSecret: "scoped-webhook-secret",
              },
            }],
          },
        },
        ...agentOverrides,
      });

      // Make the agent discoverable via getAgent (used inside handleAgentMention)
      vi.mocked(agentStore.getAgent).mockReturnValue(agent);

      bot.initializeAgentRuntime(agent);

      // The agent-scoped handlers are the last registered callbacks
      const mentionCalls = mockOnNewMention.mock.calls;
      const subscribedCalls = mockOnSubscribedMessage.mock.calls;
      const mentionHandler = mentionCalls[mentionCalls.length - 1][0];
      const subscribedHandler = subscribedCalls[subscribedCalls.length - 1][0];

      return { agent, mentionHandler, subscribedHandler };
    }

    it("calls thread.subscribe() when autoSubscribe is true (default)", async () => {
      // After a successful agent session start, the thread should be
      // subscribed for follow-up messages when autoSubscribe is true.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const { mentionHandler } = setupAgentRuntime(bot, executor);
      const thread = createMockThread({ id: "linear:scoped-sub" });

      await mentionHandler(thread, { text: "handle this" });

      // autoSubscribe is true on the binding, so subscribe() should be called
      expect(thread.subscribe).toHaveBeenCalled();
      expect(thread.setState).toHaveBeenCalledWith({
        sessionId: "test-session-1",
        agentId: "agent-scoped-1",
      });
    });

    it("posts error to thread when executeAgent throws an exception", async () => {
      // When the agent executor throws (as opposed to returning null),
      // the error should be caught and posted back to the thread.
      const executor = createMockExecutor();
      executor.executeAgent.mockRejectedValue(new Error("Spawn failed"));
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const { mentionHandler } = setupAgentRuntime(bot, executor);
      const thread = createMockThread({ id: "linear:scoped-error" });

      await mentionHandler(thread, { text: "trigger error" });

      // The error should be caught and posted back to the thread
      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("Spawn failed"),
      );
    });

    it("silently ignores messages that don't match mentionPattern", async () => {
      // When an agent has a mentionPattern configured and the message doesn't
      // match it, the handler should return silently without posting or executing.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const { mentionHandler } = setupAgentRuntime(bot, executor, {
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              mentionPattern: "^deploy",
              credentials: {
                apiKey: "scoped-api-key",
                webhookSecret: "scoped-webhook-secret",
              },
            }],
          },
        },
      });
      const thread = createMockThread({ id: "linear:scoped-pattern" });

      await mentionHandler(thread, { text: "hello world" });

      // Should not have started a session or posted anything
      expect(executor.executeAgent).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(thread.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("agent-scoped subscribed message handler", () => {
    function setupAgentRuntime(bot: ChatBot, executor: ReturnType<typeof createMockExecutor>, agentOverrides: Partial<AgentConfig> = {}) {
      const agent = makeAgent({
        id: "agent-scoped-sub",
        name: "Agent Scoped Sub",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              credentials: {
                apiKey: "scoped-api-key",
                webhookSecret: "scoped-webhook-secret",
              },
            }],
          },
        },
        ...agentOverrides,
      });

      vi.mocked(agentStore.getAgent).mockReturnValue(agent);
      bot.initializeAgentRuntime(agent);

      const mentionCalls = mockOnNewMention.mock.calls;
      const subscribedCalls = mockOnSubscribedMessage.mock.calls;
      const mentionHandler = mentionCalls[mentionCalls.length - 1][0];
      const subscribedHandler = subscribedCalls[subscribedCalls.length - 1][0];

      return { agent, mentionHandler, subscribedHandler };
    }

    it("injects user message into existing session when thread has state", async () => {
      // When a subscribed thread already has session state, the handler should
      // inject the follow-up message into the existing session rather than
      // creating a new one.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const { subscribedHandler } = setupAgentRuntime(bot, executor);
      const thread = createMockThread({
        id: "linear:scoped-existing",
        state: { sessionId: "existing-session-42", agentId: "agent-scoped-sub" },
      });

      await subscribedHandler(thread, { text: "follow up question" });

      // Should inject into the existing session, not create a new one
      expect(wsBridge.injectUserMessage).toHaveBeenCalledWith(
        "existing-session-42",
        "follow up question",
      );
      expect(thread.startTyping).toHaveBeenCalledWith("Processing...");
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("falls back to handleAgentMention when thread has no session state", async () => {
      // When a subscribed thread has no session state (e.g., state was lost),
      // the handler should fall back to creating a new session via handleAgentMention.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);

      const { subscribedHandler } = setupAgentRuntime(bot, executor);
      const thread = createMockThread({
        id: "linear:scoped-no-state",
        state: null,
      });

      await subscribedHandler(thread, { text: "new topic" });

      // Should have created a new session via executeAgent (handleAgentMention path)
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-scoped-sub",
        "new topic",
        { force: true, triggerType: "chat" },
      );
    });
  });

  describe("testMentionPattern edge cases", () => {
    it("treats invalid regex as no match (does not throw)", async () => {
      // An agent with a syntactically invalid regex mentionPattern should
      // be treated as a non-match, and the handler should not throw.
      // This covers the catch block in testMentionPattern (line 494-495).
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();
      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      // Agent with invalid regex pattern — unmatched parenthesis
      const agent = makeAgent({
        id: "agent-bad-regex",
        triggers: {
          chat: {
            enabled: true,
            platforms: [{
              adapter: "linear",
              autoSubscribe: true,
              mentionPattern: "(invalid[regex",
            }],
          },
        },
      });
      vi.mocked(agentStore.listAgents).mockReturnValue([agent]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:bad-regex" });

      // This should not throw — the invalid regex is caught and treated as no match
      await mentionHandler(thread, { text: "anything" });

      // The agent should NOT have been matched (invalid regex → false → continue to next agent → no match)
      expect(executor.executeAgent).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(
        expect.stringContaining("No agent is configured"),
      );
    });
  });

  describe("setupResponseRelay message posting", () => {
    it("posts accumulated assistant text to thread when result arrives", async () => {
      // The response relay collects text from assistant messages and posts
      // them to the thread when a result message arrives. This covers the
      // onResultForSession callback (lines 424-434) and the assistant text
      // accumulation in onAssistantMessageForSession (lines 416-421).
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();

      // Capture the callbacks passed to wsBridge so we can invoke them manually
      let assistantCallback: ((msg: any) => void) | null = null;
      let resultCallback: (() => void) | null = null;

      (wsBridge.onAssistantMessageForSession as any).mockImplementation((_sid: string, cb: (msg: any) => void) => {
        assistantCallback = cb;
        return vi.fn(); // unsubscribe
      });
      (wsBridge.onResultForSession as any).mockImplementation((_sid: string, cb: () => void) => {
        resultCallback = cb;
        return vi.fn(); // unsubscribe
      });

      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:relay-test" });

      await mentionHandler(thread, { text: "test relay posting" });

      // Simulate assistant messages arriving via the relay
      expect(assistantCallback).not.toBeNull();
      expect(resultCallback).not.toBeNull();

      // Send an assistant message with text content blocks
      assistantCallback!({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello from the agent!" },
          ],
        },
      });

      // Send another assistant message to test accumulation
      assistantCallback!({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Second chunk." },
          ],
        },
      });

      // Now fire the result callback — this should post accumulated text to the thread
      await resultCallback!();

      // The thread.post should have been called with the accumulated text
      expect(thread.post).toHaveBeenCalledWith("Hello from the agent!\nSecond chunk.");
    });

    it("does not post to thread when no assistant text was accumulated", async () => {
      // When a result arrives but no assistant text was accumulated (e.g., the
      // agent only used tools without producing text), no post should be made.
      const executor = createMockExecutor();
      const wsBridge = createMockWsBridge();

      let resultCallback: (() => void) | null = null;

      (wsBridge.onAssistantMessageForSession as any).mockImplementation((_sid: string, _cb: any) => {
        return vi.fn();
      });
      (wsBridge.onResultForSession as any).mockImplementation((_sid: string, cb: () => void) => {
        resultCallback = cb;
        return vi.fn();
      });

      const bot = new ChatBot(executor as any, wsBridge as any);
      bot.initialize();

      vi.mocked(agentStore.listAgents).mockReturnValue([makeAgent()]);

      const mentionHandler = mockOnNewMention.mock.calls[0][0];
      const thread = createMockThread({ id: "linear:relay-empty" });

      await mentionHandler(thread, { text: "no text" });

      // Fire result without any assistant messages
      await resultCallback!();

      // thread.post should NOT have been called for the relay (only startTyping)
      // Note: thread.post is not called by startAgentSession on the happy path
      expect(thread.post).not.toHaveBeenCalled();
    });
  });
});
