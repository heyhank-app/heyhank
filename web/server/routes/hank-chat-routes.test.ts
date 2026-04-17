import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock dependencies ──────────────────────────────────────────────────────
// Mocked before imports so every `import` gets the mock version.

vi.mock("../settings-manager.js", () => ({
  getSettings: vi.fn(() => ({
    hankChatProvider: "claude",
    hankChatModel: "",
    assistantName: "Hank",
    userName: "TestUser",
    anthropicApiKey: "sk-test-key",
    openaiApiKey: "",
    geminiApiKey: "",
  })),
}));

vi.mock("../hank-tools.js", () => ({
  buildSystemPrompt: vi.fn(() => "You are a test assistant."),
  getToolDeclarationsOpenAI: vi.fn(() => [
    { type: "function", function: { name: "list_todos", description: "List todos", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "add_todo", description: "Add a todo", parameters: { type: "object", properties: { title: { type: "string" } } } } },
  ]),
  getToolDeclarationsGemini: vi.fn(() => [
    { name: "list_todos", description: "List todos" },
  ]),
}));

vi.mock("../hank-tool-executor.js", () => ({
  executeHankTool: vi.fn(async (name: string, _args: unknown, _auth: string) => ({
    success: true,
    tool: name,
  })),
}));

vi.mock("../agent-store.js", () => ({
  listAgents: vi.fn(() => []),
}));

vi.mock("../assistant-store.js", () => ({
  listNotes: vi.fn(() => []),
}));

vi.mock("../federation/node-manager.js", () => ({
  nodeManager: {
    getRemoteAgents: vi.fn(() => []),
  },
}));

vi.mock("../memory-service.js", () => ({
  getContextForMessage: vi.fn(async () => ""),
  detectMemorableFacts: vi.fn(async () => []),
  addMemory: vi.fn(async () => ({ id: "mem-1" })),
}));

vi.mock("../llm-providers.js", () => ({
  callLLM: vi.fn(async () => ({ content: "[]" })),
}));

// Mock the streaming providers — these are the key functions under test
const mockStreamEvents: Array<import("../llm-providers-streaming.js").StreamEvent> = [];

vi.mock("../llm-providers-streaming.js", () => {
  // Return an async generator that yields whatever mockStreamEvents contains
  async function* mockStream() {
    for (const event of mockStreamEvents) {
      yield event;
    }
  }
  return {
    streamClaude: vi.fn(() => mockStream()),
    streamOpenAI: vi.fn(() => mockStream()),
    streamGeminiText: vi.fn(() => mockStream()),
  };
});

import { Hono } from "hono";
import { registerHankChatRoutes } from "./hank-chat-routes.js";
import { executeHankTool } from "../hank-tool-executor.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse SSE response body into individual events */
async function parseSSEResponse(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data) {
        try {
          events.push(JSON.parse(data));
        } catch { /* skip malformed */ }
      }
    }
  }
  return events;
}

// ─── Test setup ─────────────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock stream events to empty
  mockStreamEvents.length = 0;

  app = new Hono();
  const api = new Hono();
  registerHankChatRoutes(api);
  app.route("/api", api);
});

// ─── GET /api/hank/chat/config ──────────────────────────────────────────────

describe("GET /api/hank/chat/config", () => {
  it("returns provider list and current settings", async () => {
    // Validates that the config endpoint returns the expected shape with providers,
    // current provider, and tool declarations for both OpenAI and Gemini formats.
    const res = await app.request("/api/hank/chat/config");

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.currentProvider).toBe("claude");
    expect(json.currentModel).toBe("");
    expect(Array.isArray(json.providers)).toBe(true);
    const providers = json.providers as Array<{ id: string; name: string }>;
    expect(providers.length).toBe(6);
    // Check that all expected providers are present
    const ids = providers.map(p => p.id);
    expect(ids).toContain("gemini-live");
    expect(ids).toContain("claude");
    expect(ids).toContain("openai");
    expect(ids).toContain("ollama");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("gemini-text");
  });

  it("includes tool declarations in both OpenAI and Gemini formats", async () => {
    // Validates both tool declaration formats are returned so the UI
    // can display tool info regardless of which provider is active.
    const res = await app.request("/api/hank/chat/config");
    const json = await res.json() as Record<string, unknown>;

    expect(Array.isArray(json.toolDeclarationsOpenAI)).toBe(true);
    expect(Array.isArray(json.toolDeclarationsGemini)).toBe(true);
    const openaiTools = json.toolDeclarationsOpenAI as Array<{ type: string; function: { name: string } }>;
    expect(openaiTools.length).toBeGreaterThan(0);
    expect(openaiTools[0].function.name).toBe("list_todos");
  });

  it("returns provider metadata including type and requiresKey", async () => {
    // Validates that each provider entry includes the type (voice/text)
    // and which API key it requires, so the UI can show key status indicators.
    const res = await app.request("/api/hank/chat/config");
    const json = await res.json() as Record<string, unknown>;
    const providers = json.providers as Array<{ id: string; type: string; requiresKey: string | null }>;

    const geminiLive = providers.find(p => p.id === "gemini-live");
    expect(geminiLive?.type).toBe("voice");
    expect(geminiLive?.requiresKey).toBe("geminiApiKey");

    const ollama = providers.find(p => p.id === "ollama");
    expect(ollama?.type).toBe("text");
    expect(ollama?.requiresKey).toBeNull();
  });
});

// ─── POST /api/hank/chat — validation ───────────────────────────────────────

describe("POST /api/hank/chat — validation", () => {
  it("returns 400 when messages array is missing", async () => {
    // Validates that the endpoint rejects requests without a messages field.
    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("messages array required");
  });

  it("returns 400 when messages is not an array", async () => {
    // Validates that a non-array messages field is rejected.
    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: "not an array", provider: "claude" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("messages array required");
  });

  it("returns 400 when body is invalid JSON", async () => {
    // Validates that malformed JSON body results in a 400 because
    // the route catches parse errors and treats the result as empty.
    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("messages array required");
  });
});

// ─── POST /api/hank/chat — SSE streaming ────────────────────────────────────

describe("POST /api/hank/chat — SSE streaming", () => {
  it("streams text events back as SSE", async () => {
    // Validates that text chunks from the LLM provider are forwarded as SSE
    // data frames to the client, followed by a done event.
    mockStreamEvents.push(
      { type: "text", content: "Hello " },
      { type: "text", content: "world!" },
    );

    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        provider: "claude",
      }),
    });

    expect(res.status).toBe(200);
    const events = await parseSSEResponse(res);
    // Should have the text events and a done event
    const textEvents = events.filter(e => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0].content).toBe("Hello ");
    expect(textEvents[1].content).toBe("world!");

    const doneEvents = events.filter(e => e.type === "done");
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("streams error events from the provider", async () => {
    // Validates that LLM errors are forwarded as SSE error events
    // and the stream terminates.
    mockStreamEvents.push(
      { type: "error", error: "Rate limit exceeded" },
    );

    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        provider: "claude",
      }),
    });

    const events = await parseSSEResponse(res);
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe("Rate limit exceeded");
  });
});

// ─── POST /api/hank/chat — tool calls ───────────────────────────────────────

describe("POST /api/hank/chat — tool calls", () => {
  it("executes tool calls and streams tool_call + tool_result events", async () => {
    // Validates the server-side tool loop: when the LLM emits a tool_call event,
    // the server executes it via executeHankTool and sends back a tool_result event,
    // then continues streaming with a second round that produces text.
    mockStreamEvents.push(
      { type: "tool_call", name: "list_todos", args: {}, tool_call_id: "call_0" },
    );

    // After the tool round, the mock will be called again for the second loop iteration.
    // We need the stream function to produce different results on the second call.
    // Since our mock always reads from mockStreamEvents, we handle this by having the
    // executeHankTool mock push new events for the next round.
    vi.mocked(executeHankTool).mockImplementation(async () => {
      // Replace events for the next stream call (second round)
      mockStreamEvents.length = 0;
      mockStreamEvents.push(
        { type: "text", content: "Here are your todos." },
      );
      return { success: true, todos: [] };
    });

    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "List my todos" }],
        provider: "claude",
      }),
    });

    const events = await parseSSEResponse(res);

    // Should have tool_call, tool_result, text, and done events
    const toolCallEvents = events.filter(e => e.type === "tool_call");
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0].name).toBe("list_todos");

    const toolResultEvents = events.filter(e => e.type === "tool_result");
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].name).toBe("list_todos");

    // executeHankTool should have been called with the tool name and args
    expect(executeHankTool).toHaveBeenCalledWith("list_todos", {}, "");
  });

  it("passes the Authorization header to executeHankTool", async () => {
    // Validates that the auth header from the request is forwarded to tool execution
    // so tools can make authenticated internal API calls.
    mockStreamEvents.length = 0;
    mockStreamEvents.push(
      { type: "tool_call", name: "add_todo", args: { title: "Test" }, tool_call_id: "call_1" },
    );

    vi.mocked(executeHankTool).mockImplementation(async () => {
      mockStreamEvents.length = 0;
      mockStreamEvents.push({ type: "text", content: "Done." });
      return { success: true };
    });

    const res = await app.request("/api/hank/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token-123",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Add a todo" }],
        provider: "claude",
      }),
    });

    // Consume the response to ensure all SSE events are processed
    await res.text();

    expect(executeHankTool).toHaveBeenCalledWith(
      "add_todo",
      { title: "Test" },
      "Bearer test-token-123",
    );
  });
});
