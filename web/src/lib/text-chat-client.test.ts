// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChat } from "./text-chat-client.js";
import type { TextChatEvent, TextChatEventHandler } from "./text-chat-client.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a ReadableStream that emits SSE-formatted chunks */
function createSSEStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

/** Build a mock Response with an SSE body */
function createSSEResponse(
  events: Array<Record<string, unknown>>,
  status = 200,
): Response {
  return new Response(createSSEStream(events), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// ─── Test setup ─────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as any;
  // Ensure localStorage is available for auth header retrieval
  localStorage.removeItem("heyhank_auth_token");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Request format ─────────────────────────────────────────────────────────

describe("streamChat request format", () => {
  it("sends correct request to /api/hank/chat", async () => {
    // Validates that the client sends a POST to the correct endpoint with
    // the expected JSON body including messages, provider, and model.
    mockFetch.mockResolvedValue(createSSEResponse([{ type: "done" }]));

    const handler = vi.fn();
    streamChat(
      [{ role: "user", content: "Hello" }],
      "claude",
      "claude-sonnet-4-20250514",
      handler,
    );

    // Wait for the async IIFE to execute
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/hank/chat");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(body.provider).toBe("claude");
    expect(body.model).toBe("claude-sonnet-4-20250514");
  });

  it("includes auth token when present in localStorage", async () => {
    // Validates that the Authorization header is set from localStorage
    // so authenticated requests reach the backend.
    localStorage.setItem("heyhank_auth_token", "test-jwt-token");
    mockFetch.mockResolvedValue(createSSEResponse([{ type: "done" }]));

    const handler = vi.fn();
    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      handler,
    );

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer test-jwt-token");
  });

  it("passes optional apiKey and baseUrl in the request body", async () => {
    // Validates that custom API key and base URL options are forwarded
    // for providers that need user-supplied credentials.
    mockFetch.mockResolvedValue(createSSEResponse([{ type: "done" }]));

    const handler = vi.fn();
    streamChat(
      [{ role: "user", content: "Hi" }],
      "openai",
      "gpt-4o",
      handler,
      { apiKey: "sk-custom", baseUrl: "https://custom.api.com" },
    );

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.apiKey).toBe("sk-custom");
    expect(body.baseUrl).toBe("https://custom.api.com");
  });
});

// ─── SSE parsing ────────────────────────────────────────────────────────────

describe("streamChat SSE parsing", () => {
  it("parses SSE text events", async () => {
    // Validates that text chunks from the SSE stream are parsed and
    // forwarded to the handler with the correct type and content.
    mockFetch.mockResolvedValue(createSSEResponse([
      { type: "text", content: "Hello " },
      { type: "text", content: "world!" },
      { type: "done" },
    ]));

    const events: TextChatEvent[] = [];
    const handler: TextChatEventHandler = (event) => events.push(event);

    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      handler,
    );

    await vi.waitFor(() => expect(events.some(e => e.type === "done")).toBe(true));

    const textEvents = events.filter(e => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0].content).toBe("Hello ");
    expect(textEvents[1].content).toBe("world!");
  });

  it("parses SSE tool_call events", async () => {
    // Validates that tool_call events from the SSE stream are parsed
    // with name, args, and tool_call_id fields intact.
    mockFetch.mockResolvedValue(createSSEResponse([
      { type: "tool_call", name: "list_todos", args: { filter: "active" }, tool_call_id: "call_0" },
      { type: "done" },
    ]));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "List todos" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.some(e => e.type === "done")).toBe(true));

    const toolEvents = events.filter(e => e.type === "tool_call");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].name).toBe("list_todos");
    expect(toolEvents[0].args).toEqual({ filter: "active" });
    expect(toolEvents[0].tool_call_id).toBe("call_0");
  });

  it("parses SSE tool_result events", async () => {
    // Validates that tool_result events are forwarded to the handler.
    mockFetch.mockResolvedValue(createSSEResponse([
      { type: "tool_result", name: "list_todos", tool_call_id: "call_0", result: { todos: [] } },
      { type: "done" },
    ]));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "List todos" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.some(e => e.type === "done")).toBe(true));

    const resultEvents = events.filter(e => e.type === "tool_result");
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].name).toBe("list_todos");
  });

  it("parses SSE memory_added events", async () => {
    // Validates that memory_added events (auto-detected facts) are forwarded.
    mockFetch.mockResolvedValue(createSSEResponse([
      { type: "memory_added", id: "mem-1", fact: "User likes coffee", category: "preference" },
      { type: "done" },
    ]));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "I love coffee" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.some(e => e.type === "done")).toBe(true));

    const memEvents = events.filter(e => e.type === "memory_added");
    expect(memEvents).toHaveLength(1);
    expect(memEvents[0].fact).toBe("User likes coffee");
    expect(memEvents[0].category).toBe("preference");
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("streamChat error handling", () => {
  it("handles non-200 responses gracefully", async () => {
    // Validates that HTTP errors from the server are converted to
    // error events with the status code and response text.
    mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("500");
    expect(events[0].error).toContain("Internal Server Error");
  });

  it("handles fetch errors gracefully", async () => {
    // Validates that network-level errors (fetch throws) are caught
    // and forwarded as error events to the handler.
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(events[0].type).toBe("error");
    expect(events[0].error).toBe("Network failure");
  });

  it("handles missing response body gracefully", async () => {
    // Validates that a response with no body results in an error event.
    const response = new Response(null, { status: 200 });
    // Force body to null
    Object.defineProperty(response, "body", { value: null });
    mockFetch.mockResolvedValue(response);

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    // Should get either an error event or a done event
    const hasTerminal = events.some(e => e.type === "error" || e.type === "done");
    expect(hasTerminal).toBe(true);
  });

  it("ignores malformed SSE lines without crashing", async () => {
    // Validates that non-JSON SSE data lines are silently skipped
    // and valid events still reach the handler.
    const encoder = new TextEncoder();
    const raw = "data: not json\n\ndata: {\"type\":\"text\",\"content\":\"ok\"}\n\ndata: {\"type\":\"done\"}\n\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(raw));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    const events: TextChatEvent[] = [];
    streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events.some(e => e.type === "done")).toBe(true));

    // The malformed line should be skipped, but the valid text event should arrive
    const textEvents = events.filter(e => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("ok");
  });
});

// ─── AbortController ────────────────────────────────────────────────────────

describe("streamChat cancellation", () => {
  it("returns an AbortController for stream cancellation", () => {
    // Validates that the function immediately returns an AbortController
    // so the caller can cancel the stream at any time.
    mockFetch.mockResolvedValue(createSSEResponse([{ type: "done" }]));

    const controller = streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      vi.fn(),
    );

    expect(controller).toBeInstanceOf(AbortController);
    expect(typeof controller.abort).toBe("function");
  });

  it("passes AbortController signal to fetch", async () => {
    // Validates that the AbortController's signal is wired into the fetch call
    // so aborting actually cancels the network request.
    mockFetch.mockResolvedValue(createSSEResponse([{ type: "done" }]));

    const controller = streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      vi.fn(),
    );

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it("does not call handler with error when aborted", async () => {
    // Validates that aborting the stream does not produce an error event —
    // the AbortError is intentionally suppressed in the catch block.
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>(resolve => { resolveFetch = resolve; });
    mockFetch.mockReturnValue(fetchPromise);

    const events: TextChatEvent[] = [];
    const controller = streamChat(
      [{ role: "user", content: "Hi" }],
      "claude",
      "",
      (event) => events.push(event),
    );

    // Abort before the fetch resolves
    controller.abort();

    // Resolve fetch with an AbortError-like rejection
    mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    // Give the async IIFE time to handle the abort
    await new Promise(resolve => setTimeout(resolve, 50));

    // No error events should have been emitted for abort
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents).toHaveLength(0);
  });
});
