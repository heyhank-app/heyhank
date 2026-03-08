// Tests for the Linear Agent Session Bridge.
// Covers session creation from AgentSessionEvent, follow-up prompt handling,
// message relay from Companion sessions to Linear activities, and cleanup.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./agent-store.js", () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
}));

vi.mock("./linear-agent.js", () => ({
  postActivity: vi.fn().mockResolvedValue(undefined),
  updateSessionUrls: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./settings-manager.js", () => ({
  getSettings: vi.fn().mockReturnValue({ publicUrl: "" }),
}));

import * as agentStore from "./agent-store.js";
import * as linearAgent from "./linear-agent.js";
import { LinearAgentBridge } from "./linear-agent-bridge.js";
import type { AgentSessionEventPayload } from "./linear-agent.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function createMockAgentExecutor() {
  return {
    executeAgent: vi.fn(),
  } as unknown as import("./agent-executor.js").AgentExecutor;
}

function createMockWsBridge() {
  return {
    onAssistantMessageForSession: vi.fn().mockReturnValue(() => {}),
    onResultForSession: vi.fn().mockReturnValue(() => {}),
    injectUserMessage: vi.fn(),
    getSession: vi.fn().mockReturnValue({ id: "mock-session" }), // session exists by default
  } as unknown as import("./ws-bridge.js").WsBridge;
}

function makeCreatedEvent(overrides: Partial<AgentSessionEventPayload["data"]> = {}): AgentSessionEventPayload {
  return {
    action: "created",
    type: "AgentSessionEvent",
    data: {
      id: "linear-session-1",
      promptContext: "Fix the login bug on issue LIN-42",
      ...overrides,
    },
  };
}

function makePromptedEvent(linearSessionId: string, message: string): AgentSessionEventPayload {
  return {
    action: "prompted",
    type: "AgentSessionEvent",
    data: { id: linearSessionId },
    agentActivity: { body: message },
  };
}

const testAgent = {
  id: "agent-1",
  name: "Linear Bot",
  enabled: true,
  triggers: { linear: { enabled: true } },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LinearAgentBridge", () => {
  let bridge: LinearAgentBridge;
  let executor: ReturnType<typeof createMockAgentExecutor>;
  let wsBridge: ReturnType<typeof createMockWsBridge>;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createMockAgentExecutor();
    wsBridge = createMockWsBridge();
    bridge = new LinearAgentBridge(executor, wsBridge);
  });

  describe("handleEvent — created action", () => {
    it("acknowledges with a thought, launches agent session, and sets up relay", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);

      await bridge.handleEvent(makeCreatedEvent());

      // Should post initial acknowledgement thought
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "thought", body: "Starting Companion session..." }),
      );

      // Should launch agent session with prompt context
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-1",
        "Fix the login bug on issue LIN-42",
        { force: true, triggerType: "linear" },
      );

      // Should set external URLs
      expect(linearAgent.updateSessionUrls).toHaveBeenCalledWith(
        "linear-session-1",
        expect.arrayContaining([
          expect.objectContaining({ label: "Companion Session" }),
        ]),
      );

      // Should set up relay listeners
      expect(wsBridge.onAssistantMessageForSession).toHaveBeenCalledWith(
        "comp-sess-1",
        expect.any(Function),
      );
      expect(wsBridge.onResultForSession).toHaveBeenCalledWith(
        "comp-sess-1",
        expect.any(Function),
      );

      // Should post "session started" thought
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "thought",
          body: expect.stringContaining("Linear Bot"),
        }),
      );
    });

    it("posts error when no agent with Linear trigger is found", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([]);

      await bridge.handleEvent(makeCreatedEvent());

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "error",
          body: expect.stringContaining("No Companion agent"),
        }),
      );
      // Should not attempt to launch session
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("posts error when agent executor returns null (no overlap)", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(agentStore.getAgent).mockReturnValue({ ...testAgent, lastSessionId: undefined } as ReturnType<typeof agentStore.getAgent>);
      vi.mocked(executor.executeAgent).mockResolvedValue(undefined as never);

      await bridge.handleEvent(makeCreatedEvent());

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "error",
          body: expect.stringContaining("Failed to start Companion session"),
        }),
      );
    });

    it("posts 'agent busy' error when executor returns null due to overlap", async () => {
      // Agent is busy with a running session
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(agentStore.getAgent).mockReturnValue({ ...testAgent, lastSessionId: "running-session" } as ReturnType<typeof agentStore.getAgent>);
      vi.mocked(wsBridge.getSession).mockReturnValue({ id: "running-session" } as never);
      vi.mocked(executor.executeAgent).mockResolvedValue(undefined as never);

      await bridge.handleEvent(makeCreatedEvent());

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "error",
          body: expect.stringContaining("currently busy"),
        }),
      );
    });

    it("posts error when agent executor throws", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockRejectedValue(new Error("CLI not found"));

      await bridge.handleEvent(makeCreatedEvent());

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "error",
          body: expect.stringContaining("CLI not found"),
        }),
      );
    });

    it("skips disabled agents when finding Linear agent", async () => {
      const disabledAgent = { ...testAgent, enabled: false };
      vi.mocked(agentStore.listAgents).mockReturnValue([disabledAgent] as ReturnType<typeof agentStore.listAgents>);

      await bridge.handleEvent(makeCreatedEvent());

      // No agent found → error posted
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  describe("handleEvent — prompted action", () => {
    it("injects follow-up message into existing Companion session", async () => {
      // First, create a session to establish the mapping
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());

      vi.clearAllMocks();

      // Now send a follow-up
      await bridge.handleEvent(makePromptedEvent("linear-session-1", "What's the status?"));

      // Should post acknowledgement thought
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "thought", body: "Processing follow-up..." }),
      );

      // Should inject message into the Companion session
      expect(wsBridge.injectUserMessage).toHaveBeenCalledWith("comp-sess-1", "What's the status?");
    });

    it("creates new session with follow-up message when Companion session is dead", async () => {
      // Create a session first
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());
      vi.clearAllMocks();

      // Simulate the session being dead
      vi.mocked(wsBridge.getSession).mockReturnValue(undefined);
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-new" } as never);

      await bridge.handleEvent(makePromptedEvent("linear-session-1", "Follow up?"));

      // Should launch a new session with the follow-up message as prompt context
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-1",
        "Follow up?",
        expect.objectContaining({ triggerType: "linear" }),
      );
      expect(wsBridge.injectUserMessage).not.toHaveBeenCalled();
    });

    it("creates new session with follow-up message when no mapping exists", async () => {
      // Send prompted event without a prior created event — the user's
      // message (agentActivity.body) should be passed as promptContext
      // to the new session so the message is not silently dropped.
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-new" } as never);

      await bridge.handleEvent(makePromptedEvent("unknown-session", "help"));

      // Should fall back to handleCreated with the follow-up message as prompt
      expect(executor.executeAgent).toHaveBeenCalledWith(
        "agent-1",
        "help",
        expect.objectContaining({ triggerType: "linear" }),
      );
    });

    it("ignores prompted events with empty or whitespace-only messages", async () => {
      // Empty agentActivity.body should be silently skipped — no injection, no new session
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());
      vi.clearAllMocks();

      // Send a follow-up with empty body
      await bridge.handleEvent(makePromptedEvent("linear-session-1", ""));
      expect(wsBridge.injectUserMessage).not.toHaveBeenCalled();
      expect(executor.executeAgent).not.toHaveBeenCalled();

      // Send a follow-up with whitespace-only body
      await bridge.handleEvent(makePromptedEvent("linear-session-1", "   "));
      expect(wsBridge.injectUserMessage).not.toHaveBeenCalled();
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });
  });

  describe("relay — assistant message callbacks", () => {
    // These tests exercise the relay callback functions that are registered
    // inside setupRelay. We capture the callbacks via mock spies and invoke
    // them with synthetic BrowserIncomingMessage payloads.

    async function createSessionAndCaptureCallbacks() {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());

      // Capture the callbacks registered by setupRelay
      const assistantCb = vi.mocked(wsBridge.onAssistantMessageForSession).mock.calls[0][1];
      const resultCb = vi.mocked(wsBridge.onResultForSession).mock.calls[0][1];
      vi.clearAllMocks(); // clear previous postActivity calls
      return { assistantCb, resultCb };
    }

    it("relays assistant text content as a response on turn completion", async () => {
      const { assistantCb, resultCb } = await createSessionAndCaptureCallbacks();

      // Simulate an assistant message with text content
      assistantCb({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Here is the fix for the login bug." },
          ],
        },
      } as never);

      // Trigger turn completion — should post the accumulated text as a response
      await resultCb({} as never);

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response", body: "Here is the fix for the login bug." }),
      );
    });

    it("relays tool use as action activities", async () => {
      const { assistantCb } = await createSessionAndCaptureCallbacks();

      // Simulate an assistant message with a tool_use content block
      assistantCb({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file: "login.ts", line: 42 } },
          ],
        },
      } as never);

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({
          type: "action",
          action: "Edit",
        }),
      );
    });

    it("relays all tool_use blocks when assistant calls multiple tools", async () => {
      const { assistantCb } = await createSessionAndCaptureCallbacks();

      // Simulate an assistant message with multiple parallel tool calls
      assistantCb({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file: "a.ts" } },
            { type: "tool_use", name: "Read", input: { file: "b.ts" } },
            { type: "tool_use", name: "Edit", input: { file: "c.ts" } },
          ],
        },
      } as never);

      // All three tool_use blocks should be posted as action activities
      expect(linearAgent.postActivity).toHaveBeenCalledTimes(3);
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "action", action: "Read" }),
      );
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "action", action: "Edit" }),
      );
    });

    it("accumulates text across multiple assistant messages", async () => {
      const { assistantCb, resultCb } = await createSessionAndCaptureCallbacks();

      // Two assistant messages before turn completion
      assistantCb({
        type: "assistant",
        message: { content: [{ type: "text", text: "Line 1" }] },
      } as never);
      assistantCb({
        type: "assistant",
        message: { content: [{ type: "text", text: "Line 2" }] },
      } as never);

      await resultCb({} as never);

      // Should accumulate both into one response
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response", body: "Line 1\nLine 2" }),
      );
    });

    it("does not post empty response when no text was accumulated", async () => {
      const { resultCb } = await createSessionAndCaptureCallbacks();

      // Turn completes with no assistant messages
      await resultCb({} as never);

      // Should not post a response activity
      expect(linearAgent.postActivity).not.toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response" }),
      );
    });

    it("ignores non-assistant messages in text extraction", async () => {
      const { assistantCb, resultCb } = await createSessionAndCaptureCallbacks();

      // A non-assistant message type should be ignored
      assistantCb({ type: "system", message: "hello" } as never);

      await resultCb({} as never);

      // No response should be posted
      expect(linearAgent.postActivity).not.toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response" }),
      );
    });

    it("handles assistant messages without message.content gracefully", async () => {
      const { assistantCb, resultCb } = await createSessionAndCaptureCallbacks();

      // Assistant message with no content array
      assistantCb({ type: "assistant", message: {} } as never);
      assistantCb({ type: "assistant" } as never);

      await resultCb({} as never);

      // No text accumulated → no response
      expect(linearAgent.postActivity).not.toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response" }),
      );
    });

    it("extracts tool use without input gracefully", async () => {
      const { assistantCb } = await createSessionAndCaptureCallbacks();

      assistantCb({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read" }],
        },
      } as never);

      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "action", action: "Read" }),
      );
    });
  });

  describe("multi-turn conversation", () => {
    // Verifies that after the first turn completes, the session mapping
    // and relay stay alive so follow-up prompted events work correctly.

    it("keeps session mapping alive after first turn completes", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());

      // Capture the result callback and trigger turn completion
      const resultCb = vi.mocked(wsBridge.onResultForSession).mock.calls[0][1];
      vi.clearAllMocks();

      await resultCb({} as never);

      // Now send a follow-up — should inject into existing session, NOT create new
      await bridge.handleEvent(makePromptedEvent("linear-session-1", "What about the tests?"));

      expect(wsBridge.injectUserMessage).toHaveBeenCalledWith("comp-sess-1", "What about the tests?");
      // Should NOT launch a new session
      expect(executor.executeAgent).not.toHaveBeenCalled();
    });

    it("re-establishes relay on follow-up so responses are forwarded", async () => {
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);
      await bridge.handleEvent(makeCreatedEvent());

      // First turn: simulate response and turn completion
      const assistantCb1 = vi.mocked(wsBridge.onAssistantMessageForSession).mock.calls[0][1];
      const resultCb1 = vi.mocked(wsBridge.onResultForSession).mock.calls[0][1];
      assistantCb1({ type: "assistant", message: { content: [{ type: "text", text: "First response" }] } } as never);
      await resultCb1({} as never);

      vi.clearAllMocks();

      // Follow-up prompt — should re-establish relay
      await bridge.handleEvent(makePromptedEvent("linear-session-1", "Follow up"));

      // setupRelay should have registered new listeners
      expect(wsBridge.onAssistantMessageForSession).toHaveBeenCalledWith("comp-sess-1", expect.any(Function));
      expect(wsBridge.onResultForSession).toHaveBeenCalledWith("comp-sess-1", expect.any(Function));

      // Simulate second turn response
      const assistantCb2 = vi.mocked(wsBridge.onAssistantMessageForSession).mock.calls[0][1];
      const resultCb2 = vi.mocked(wsBridge.onResultForSession).mock.calls[0][1];
      vi.clearAllMocks();

      assistantCb2({ type: "assistant", message: { content: [{ type: "text", text: "Second response" }] } } as never);
      await resultCb2({} as never);

      // The second response should be forwarded to Linear
      expect(linearAgent.postActivity).toHaveBeenCalledWith(
        "linear-session-1",
        expect.objectContaining({ type: "response", body: "Second response" }),
      );
    });
  });

  describe("shutdown", () => {
    it("cleans up all session mappings and relay listeners", async () => {
      // Create a session
      vi.mocked(agentStore.listAgents).mockReturnValue([testAgent] as ReturnType<typeof agentStore.listAgents>);
      const unsubAssistant = vi.fn();
      const unsubResult = vi.fn();
      vi.mocked(wsBridge.onAssistantMessageForSession).mockReturnValue(unsubAssistant);
      vi.mocked(wsBridge.onResultForSession).mockReturnValue(unsubResult);
      vi.mocked(executor.executeAgent).mockResolvedValue({ sessionId: "comp-sess-1" } as never);

      await bridge.handleEvent(makeCreatedEvent());

      bridge.shutdown();

      // Should call cleanup unsubscribers
      expect(unsubAssistant).toHaveBeenCalled();
      expect(unsubResult).toHaveBeenCalled();
    });
  });
});
