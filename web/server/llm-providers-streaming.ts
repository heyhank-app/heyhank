// ─── Streaming LLM Providers with Tool Calling ──────────────────────────────
// Used by Hank-UI chat endpoint for text-based providers (not Gemini Live voice).

export interface ContentPart {
  type: "text" | "image_url" | "document";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
  document?: { url: string; mimeType: string; name?: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** OpenAI-compatible tool name for role: "tool" messages */
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  tool_call_id?: string;
  result?: unknown;
  error?: string;
}

export interface StreamProviderConfig {
  provider: "claude" | "openai" | "ollama" | "openrouter" | "gemini-text";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Extract plain text from ChatMessage content */
function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => p.text || "").join("");
}

/** Extract base64 data and mime type from a data URL */
function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Convert multimodal content to Claude format */
function toClaudeContent(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  const parts: Array<Record<string, unknown>> = [];
  for (const p of content) {
    if (p.type === "text" && p.text) {
      parts.push({ type: "text", text: p.text });
    } else if (p.type === "image_url" && p.image_url?.url) {
      const parsed = parseDataUrl(p.image_url.url);
      if (parsed) {
        parts.push({ type: "image", source: { type: "base64", media_type: parsed.mimeType, data: parsed.data } });
      }
    }
  }
  return parts.length > 0 ? parts : getTextContent(content);
}

/** Convert multimodal content to OpenAI format */
function toOpenAIContent(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  const parts: Array<Record<string, unknown>> = [];
  for (const p of content) {
    if (p.type === "text" && p.text) {
      parts.push({ type: "text", text: p.text });
    } else if (p.type === "image_url" && p.image_url?.url) {
      parts.push({ type: "image_url", image_url: { url: p.image_url.url, detail: p.image_url.detail || "auto" } });
    }
  }
  return parts.length > 0 ? parts : getTextContent(content);
}

/** Convert multimodal content to Gemini format parts */
function toGeminiParts(content: string | ContentPart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  const parts: Array<Record<string, unknown>> = [];
  for (const p of content) {
    if (p.type === "text" && p.text) {
      parts.push({ text: p.text });
    } else if (p.type === "image_url" && p.image_url?.url) {
      const parsed = parseDataUrl(p.image_url.url);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
    }
  }
  return parts.length > 0 ? parts : [{ text: getTextContent(content) }];
}

// ─── Claude (Anthropic API) ─────────────────────────────────────────────────

export async function* streamClaude(
  messages: ChatMessage[],
  tools: any[],  // OpenAI format tools
  config: StreamProviderConfig,
): AsyncGenerator<StreamEvent> {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Anthropic API key required");

  // Convert OpenAI tool format to Claude tool format
  const claudeTools = tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  // Separate system message
  const systemMsg = messages.filter(m => m.role === "system").map(m => getTextContent(m.content)).join("\n");
  const chatMessages = messages.filter(m => m.role !== "system").map(m => {
    if (m.role === "tool") {
      return {
        role: "user" as const,
        content: [{
          type: "tool_result" as const,
          tool_use_id: m.tool_call_id || "",
          content: getTextContent(m.content),
        }],
      };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content: m.tool_calls.map(tc => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })),
      };
    }
    return { role: m.role as "user" | "assistant", content: toClaudeContent(m.content) };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model || "claude-sonnet-4-20250514",
      max_tokens: config.maxTokens || 4096,
      system: systemMsg || undefined,
      messages: chatMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    yield { type: "error", error: `Claude error ${response.status}: ${text}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { yield { type: "error", error: "No response body" }; return; }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentToolUse: { id: string; name: string; argsJson: string } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") { yield { type: "done" }; return; }
      try {
        const event = JSON.parse(data);
        if (event.type === "content_block_start") {
          if (event.content_block?.type === "tool_use") {
            currentToolUse = { id: event.content_block.id, name: event.content_block.name, argsJson: "" };
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") {
            yield { type: "text", content: event.delta.text };
          } else if (event.delta?.type === "input_json_delta" && currentToolUse) {
            currentToolUse.argsJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop" && currentToolUse) {
          try {
            const args = JSON.parse(currentToolUse.argsJson || "{}");
            yield { type: "tool_call", name: currentToolUse.name, args, tool_call_id: currentToolUse.id };
          } catch {
            yield { type: "tool_call", name: currentToolUse.name, args: {}, tool_call_id: currentToolUse.id };
          }
          currentToolUse = null;
        } else if (event.type === "message_stop") {
          yield { type: "done" };
          return;
        }
      } catch { /* skip */ }
    }
  }
  yield { type: "done" };
}

// ─── OpenAI-compatible (OpenAI, OpenRouter, Ollama with /v1/chat/completions) ─

export async function* streamOpenAI(
  messages: ChatMessage[],
  tools: any[],
  config: StreamProviderConfig,
): AsyncGenerator<StreamEvent> {
  let baseUrl: string;
  let headers: Record<string, string> = { "Content-Type": "application/json" };

  switch (config.provider) {
    case "openai":
      baseUrl = config.baseUrl || "https://api.openai.com/v1";
      headers["Authorization"] = `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`;
      break;
    case "openrouter":
      baseUrl = "https://openrouter.ai/api/v1";
      headers["Authorization"] = `Bearer ${config.apiKey || process.env.OPENROUTER_API_KEY}`;
      headers["HTTP-Referer"] = "https://heyhank.ai";
      headers["X-Title"] = "HeyHank";
      break;
    case "ollama":
      baseUrl = (config.baseUrl || "http://localhost:11434") + "/v1";
      break;
    default:
      baseUrl = config.baseUrl || "https://api.openai.com/v1";
      if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // Convert messages to OpenAI format (with multimodal support)
  const isOllama = config.provider === "ollama";
  const openaiMessages = messages.map(m => {
    if (isOllama && typeof m.content !== "string" && Array.isArray(m.content)) {
      // Ollama uses `images` field for base64 images
      const text = getTextContent(m.content);
      const images: string[] = [];
      for (const p of m.content) {
        if (p.type === "image_url" && p.image_url?.url) {
          const parsed = parseDataUrl(p.image_url.url);
          if (parsed) images.push(parsed.data);
        }
      }
      const msg: any = { role: m.role, content: text };
      if (images.length > 0) msg.images = images;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    }
    const msg: any = { role: m.role, content: toOpenAIContent(m.content) };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  const body: any = {
    model: config.model,
    messages: openaiMessages,
    stream: true,
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 4096,
  };
  if (tools.length > 0) body.tools = tools;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    yield { type: "error", error: `${config.provider} error ${response.status}: ${text}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { yield { type: "error", error: "No response body" }; return; }

  const decoder = new TextDecoder();
  let buf = "";
  const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        // Emit any accumulated tool calls
        for (const tc of toolCalls.values()) {
          try {
            const args = JSON.parse(tc.args || "{}");
            yield { type: "tool_call", name: tc.name, args, tool_call_id: tc.id };
          } catch {
            yield { type: "tool_call", name: tc.name, args: {}, tool_call_id: tc.id };
          }
        }
        yield { type: "done" };
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: "text", content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { id: tc.id || `call_${idx}`, name: "", args: "" });
            }
            const entry = toolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }

        // Check finish_reason
        const finishReason = parsed.choices?.[0]?.finish_reason;
        if (finishReason === "tool_calls" || finishReason === "stop") {
          for (const tc of toolCalls.values()) {
            try {
              const args = JSON.parse(tc.args || "{}");
              yield { type: "tool_call", name: tc.name, args, tool_call_id: tc.id };
            } catch {
              yield { type: "tool_call", name: tc.name, args: {}, tool_call_id: tc.id };
            }
          }
          toolCalls.clear();
          if (finishReason === "stop") {
            yield { type: "done" };
            return;
          }
        }
      } catch { /* skip */ }
    }
  }
  yield { type: "done" };
}

// ─── Gemini Text (non-Live, REST streaming) ─────────────────────────────────

export async function* streamGeminiText(
  messages: ChatMessage[],
  tools: any[],
  config: StreamProviderConfig,
): AsyncGenerator<StreamEvent> {
  const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key required");

  const model = config.model || "gemini-2.5-flash";

  // Convert to Gemini format
  const systemInstruction = messages
    .filter(m => m.role === "system")
    .map(m => getTextContent(m.content))
    .join("\n");

  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => {
      if (m.role === "tool") {
        return {
          role: "function" as const,
          parts: [{
            functionResponse: {
              name: (m as any).name || m.tool_call_id || "unknown",
              response: { result: safeJsonParse(getTextContent(m.content)) },
            },
          }],
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "model" as const,
          parts: m.tool_calls.map(tc => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          })),
        };
      }
      return {
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: toGeminiParts(m.content),
      };
    });

  // Convert OpenAI tools to Gemini format
  const geminiTools = tools.length > 0 ? [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: convertToGeminiSchema(t.function.parameters),
    })),
  }] : undefined;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        tools: geminiTools,
        toolConfig: geminiTools ? { functionCallingConfig: { mode: "AUTO" } } : undefined,
        generationConfig: {
          temperature: config.temperature ?? 0.7,
          maxOutputTokens: config.maxTokens ?? 8192,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    yield { type: "error", error: `Gemini error ${response.status}: ${text}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { yield { type: "error", error: "No response body" }; return; }

  const decoder = new TextDecoder();
  let buf = "";
  let callCounter = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);

        // Check for API-level errors (e.g. safety block, invalid request)
        if (parsed.error) {
          yield { type: "error", error: `Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}` };
          return;
        }

        const candidate = parsed.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const parts = candidate?.content?.parts;

        // Handle finish reasons that indicate the response is done or blocked
        if (finishReason && finishReason !== "STOP") {
          if (finishReason === "MAX_TOKENS") {
            yield { type: "text", content: "\n\n[Antwort wurde wegen Token-Limit abgeschnitten]" };
          } else if (finishReason === "SAFETY") {
            yield { type: "error", error: "Gemini hat die Antwort aus Sicherheitsgründen blockiert." };
            return;
          } else if (finishReason === "RECITATION") {
            yield { type: "error", error: "Gemini hat die Antwort wegen Urheberrechtsbedenken blockiert." };
            return;
          }
        }

        if (!parts || parts.length === 0) continue;
        for (const part of parts) {
          if (part.text) {
            yield { type: "text", content: part.text };
          }
          if (part.functionCall) {
            yield {
              type: "tool_call",
              name: part.functionCall.name,
              args: part.functionCall.args || {},
              tool_call_id: `gemini_call_${callCounter++}`,
            };
          }
        }
      } catch (err) {
        console.error("[Gemini stream] Failed to parse chunk:", err, "raw:", data.substring(0, 200));
      }
    }
  }
  yield { type: "done" };
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

function convertToGeminiSchema(schema: any): any {
  if (!schema) return { type: "OBJECT", properties: {} };
  const result: any = {};
  result.type = (schema.type || "object").toUpperCase();
  if (schema.properties) {
    result.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      result.properties[key] = convertToGeminiSchema(val);
    }
  }
  if (schema.required) result.required = schema.required;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.items) result.items = convertToGeminiSchema(schema.items);
  return result;
}
