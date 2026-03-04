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
});
