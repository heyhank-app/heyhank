// ─── Internal LLM Provider (provider-agnostic streaming + tool use) ──────────
// Wraps the existing HeyHank provider system but adds:
//  - multi-turn message arrays (system + user/assistant)
//  - streaming via SSE for low latency (Anthropic + OpenAI-compatible)
//  - tool use support (Anthropic Tool Use + OpenAI Function Calling)
//
// Provider resolution:
//   - voicePipeline.llm.provider (explicit, required) → provider-manager.getProviderConfig()
//   - If the chosen provider has no API key / isn't configured → null (call-time error).
//
// Falls back to non-streaming `callInternalAI` if no streaming-capable provider.

import { callInternalAI } from "../../internal-ai.js";
import { getProviderConfig } from "../../provider-manager.js";
import { getProviderById } from "../../provider-registry.js";
import type {
  LLMConfig,
  LLMMessage,
  LLMProvider,
  LLMProviderId,
  LLMStreamCallbacks,
  LLMToolCall,
  LLMToolDef,
  LLMToolResult,
} from "../types.js";

// ─── Provider resolution ─────────────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  huggingface: "https://api-inference.huggingface.co/v1",
  venice: "https://api.venice.ai/api/v1",
  minimax: "https://api.minimax.chat/v1",
  moonshot: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "qwen-alibaba": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  chutes: "https://api.chutes.ai/v1",
  zai: "https://open.bigmodel.cn/api/paas/v4",
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
  together: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
  openrouter: "meta-llama/llama-3.1-8b-instruct:free",
  xai: "grok-3-mini",
  qwen: "qwen-turbo",
};

interface ResolvedProvider {
  /** "anthropic" → Anthropic Messages API; everything else → OpenAI-compatible chat/completions */
  kind: "anthropic" | "openai-compat";
  providerId: string;
  apiKey: string;
  /** For openai-compat: base URL (without trailing slash, no /chat/completions suffix) */
  baseUrl: string;
  model: string;
}

function resolveProvider(providerId: string): ResolvedProvider | null {
  return resolveById(providerId);
}

function resolveById(id: string): ResolvedProvider | null {
  const def = getProviderById(id);
  if (!def) return null;
  const cfg = getProviderConfig(id);
  if (!cfg) return null;

  const secretField = def.envFields.find((f) => f.secret && f.required);
  const apiKey = secretField ? (cfg.envValues[secretField.key] || "") : "";
  if (!apiKey && id !== "ollama") return null;

  const urlField = def.envFields.find((f) => f.key.includes("BASE_URL"));
  let baseUrl = urlField ? (cfg.envValues[urlField.key] || "") : "";
  if (!baseUrl) baseUrl = PROVIDER_BASE_URLS[id] || "";

  const model = cfg.customModel || PROVIDER_DEFAULT_MODELS[id] || def.defaultModel || "";

  if (id === "anthropic") {
    return { kind: "anthropic", providerId: id, apiKey, baseUrl: "https://api.anthropic.com/v1", model };
  }
  if (!baseUrl || !model) return null;
  // Strip trailing slash for consistency
  return { kind: "openai-compat", providerId: id, apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), model };
}

// ─── Anthropic streaming with tool use ───────────────────────────────────────

interface AssistantBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  inputJson?: string;
}

function toAnthropicTools(tools: LLMToolDef[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

async function streamAnthropicOnce(
  messages: LLMMessage[],
  history: Array<{ role: string; content: unknown }>,
  config: LLMConfig | undefined,
  provider: ResolvedProvider,
  onTextDelta: (chunk: string) => void,
): Promise<{ blocks: AssistantBlock[]; stopReason: string | null; ok: boolean; error?: string }> {
  const system = messages.find((m) => m.role === "system")?.content;
  const body: Record<string, unknown> = {
    model: config?.model || provider.model,
    max_tokens: config?.maxTokens ?? 512,
    messages: history,
    temperature: config?.temperature ?? 0.6,
    stream: true,
  };
  if (system) body.system = system;
  const tools = toAnthropicTools(config?.tools);
  if (tools) body.tools = tools;

  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = res.body ? await res.text() : "";
    return { blocks: [], stopReason: null, ok: false, error: `Anthropic stream error ${res.status}: ${errText.slice(0, 200)}` };
  }

  const blocks: AssistantBlock[] = [];
  let stopReason: string | null = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const dataLine = event.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let data: Record<string, unknown>;
        try { data = JSON.parse(jsonStr); } catch { continue; }

        const type = data.type as string | undefined;
        if (type === "content_block_start") {
          const idxNum = data.index as number;
          const cb = data.content_block as { type: string; id?: string; name?: string };
          if (cb.type === "text") blocks[idxNum] = { type: "text", text: "" };
          else if (cb.type === "tool_use") blocks[idxNum] = { type: "tool_use", id: cb.id, name: cb.name, inputJson: "" };
        } else if (type === "content_block_delta") {
          const idxNum = data.index as number;
          const delta = data.delta as { type: string; text?: string; partial_json?: string };
          const block = blocks[idxNum];
          if (!block) continue;
          if (delta.type === "text_delta" && delta.text) {
            block.text = (block.text || "") + delta.text;
            onTextDelta(delta.text);
          } else if (delta.type === "input_json_delta" && delta.partial_json !== undefined) {
            block.inputJson = (block.inputJson || "") + delta.partial_json;
          }
        } else if (type === "message_delta") {
          const delta = data.delta as { stop_reason?: string };
          if (delta.stop_reason) stopReason = delta.stop_reason;
        }
      }
    }
  } catch (e) {
    return { blocks, stopReason, ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return { blocks, stopReason, ok: true };
}

function anthropicBlocksToContent(blocks: AssistantBlock[]): Array<Record<string, unknown>> {
  return blocks
    .filter((b) => b)
    .map((b) => {
      if (b.type === "text") return { type: "text", text: b.text || "" };
      let parsed: Record<string, unknown> = {};
      try { parsed = b.inputJson ? JSON.parse(b.inputJson) : {}; } catch { /* ignore */ }
      return { type: "tool_use", id: b.id, name: b.name, input: parsed };
    });
}

function anthropicExtractToolCalls(blocks: AssistantBlock[]): LLMToolCall[] {
  const calls: LLMToolCall[] = [];
  for (const b of blocks) {
    if (!b || b.type !== "tool_use") continue;
    let args: Record<string, unknown> = {};
    try { args = b.inputJson ? JSON.parse(b.inputJson) : {}; } catch { /* ignore */ }
    calls.push({ id: b.id || "", name: b.name || "", args });
  }
  return calls;
}

async function streamAnthropicWithTools(
  messages: LLMMessage[],
  callbacks: LLMStreamCallbacks,
  config: LLMConfig | undefined,
  provider: ResolvedProvider,
): Promise<{ text: string; ok: boolean; error?: string }> {
  const turns: Array<{ role: string; content: unknown }> = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  let fullText = "";
  const maxIterations = 4;

  for (let iter = 0; iter < maxIterations; iter++) {
    const result = await streamAnthropicOnce(messages, turns, config, provider, (chunk) => {
      fullText += chunk;
      callbacks.onChunk(chunk);
    });
    if (!result.ok) return { text: fullText, ok: false, error: result.error };

    const content = anthropicBlocksToContent(result.blocks);
    if (content.length > 0) turns.push({ role: "assistant", content });

    if (result.stopReason !== "tool_use") return { text: fullText, ok: true };

    const toolCalls = anthropicExtractToolCalls(result.blocks);
    if (toolCalls.length === 0 || !callbacks.onToolCalls) return { text: fullText, ok: true };

    let toolResults: LLMToolResult[] = [];
    try {
      toolResults = await callbacks.onToolCalls(toolCalls);
    } catch (e) {
      console.error("[voice-pipeline] tool handler error:", e);
      toolResults = toolCalls.map((c) => ({ id: c.id, name: c.name, response: { error: e instanceof Error ? e.message : String(e) } }));
    }

    // If the model called `end_call`, stop the loop. The goodbye text has
    // already been spoken in this iteration — another LLM round would just
    // produce a second redundant goodbye that gets TTS'd on top.
    if (toolCalls.some((c) => c.name === "end_call")) {
      return { text: fullText, ok: true };
    }

    turns.push({
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: typeof r.response === "string" ? r.response : JSON.stringify(r.response),
      })),
    });
  }

  console.warn("[voice-pipeline] Anthropic tool loop hit max iterations");
  return { text: fullText, ok: true };
}

// ─── OpenAI-compatible streaming with tool calling ───────────────────────────

interface OpenAIToolCallAccumulator {
  index: number;
  id?: string;
  name?: string;
  argsJson: string;
}

function toOpenAITools(tools: LLMToolDef[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Convert LLMMessage[] (with optional tool history) to OpenAI messages */
function buildOpenAIMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

interface OpenAIStreamResult {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason: string | null;
  ok: boolean;
  error?: string;
}

async function streamOpenAIOnce(
  history: Array<Record<string, unknown>>,
  config: LLMConfig | undefined,
  provider: ResolvedProvider,
  onTextDelta: (chunk: string) => void,
): Promise<OpenAIStreamResult> {
  const body: Record<string, unknown> = {
    model: config?.model || provider.model,
    max_tokens: config?.maxTokens ?? 512,
    messages: history,
    temperature: config?.temperature ?? 0.6,
    stream: true,
  };
  const tools = toOpenAITools(config?.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = res.body ? await res.text() : "";
    return { text: "", toolCalls: [], finishReason: null, ok: false, error: `${provider.providerId} stream error ${res.status}: ${errText.slice(0, 200)}` };
  }

  let fullText = "";
  let finishReason: string | null = null;
  /** Accumulators keyed by index (OpenAI streams tool_calls in chunks per index) */
  const toolAcc = new Map<number, OpenAIToolCallAccumulator>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let data: Record<string, unknown>;
        try { data = JSON.parse(jsonStr); } catch { continue; }

        const choices = data.choices as Array<{
          delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string | null;
        }> | undefined;
        if (!choices || choices.length === 0) continue;
        const choice = choices[0];
        const delta = choice.delta;

        if (delta?.content) {
          fullText += delta.content;
          onTextDelta(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const acc = toolAcc.get(tc.index) ?? { index: tc.index, argsJson: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.argsJson += tc.function.arguments;
            toolAcc.set(tc.index, acc);
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
  } catch (e) {
    return { text: fullText, toolCalls: [], finishReason, ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Materialize tool calls
  const toolCalls: LLMToolCall[] = [];
  for (const acc of [...toolAcc.values()].sort((a, b) => a.index - b.index)) {
    let args: Record<string, unknown> = {};
    try { args = acc.argsJson ? JSON.parse(acc.argsJson) : {}; } catch { /* keep empty */ }
    toolCalls.push({ id: acc.id || `call_${acc.index}`, name: acc.name || "", args });
  }

  return { text: fullText, toolCalls, finishReason, ok: true };
}

async function streamOpenAIWithTools(
  messages: LLMMessage[],
  callbacks: LLMStreamCallbacks,
  config: LLMConfig | undefined,
  provider: ResolvedProvider,
): Promise<{ text: string; ok: boolean; error?: string }> {
  // OpenAI history is a single flat array (system + user/assistant + tool)
  const history: Array<Record<string, unknown>> = buildOpenAIMessages(messages);

  let fullText = "";
  const maxIterations = 4;

  for (let iter = 0; iter < maxIterations; iter++) {
    const result = await streamOpenAIOnce(history, config, provider, (chunk) => {
      fullText += chunk;
      callbacks.onChunk(chunk);
    });
    if (!result.ok) return { text: fullText, ok: false, error: result.error };

    // Append assistant turn (text + tool_calls) to history
    const assistantMsg: Record<string, unknown> = { role: "assistant", content: result.text || null };
    if (result.toolCalls.length > 0) {
      assistantMsg.tool_calls = result.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }));
    }
    history.push(assistantMsg);

    if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0 || !callbacks.onToolCalls) {
      return { text: fullText, ok: true };
    }

    let toolResults: LLMToolResult[] = [];
    try {
      toolResults = await callbacks.onToolCalls(result.toolCalls);
    } catch (e) {
      console.error("[voice-pipeline] tool handler error:", e);
      toolResults = result.toolCalls.map((c) => ({ id: c.id, name: c.name, response: { error: e instanceof Error ? e.message : String(e) } }));
    }

    // Append tool results (one message per tool_call)
    for (const r of toolResults) {
      history.push({
        role: "tool",
        tool_call_id: r.id,
        content: typeof r.response === "string" ? r.response : JSON.stringify(r.response),
      });
    }

    // If the model called `end_call`, stop the loop (see Anthropic branch above
    // for rationale — avoids a second redundant goodbye).
    if (result.toolCalls.some((c) => c.name === "end_call")) {
      return { text: fullText, ok: true };
    }
  }

  console.warn(`[voice-pipeline] ${provider.providerId} tool loop hit max iterations`);
  return { text: fullText, ok: true };
}

// ─── Public Provider ─────────────────────────────────────────────────────────

export class InternalLLMProvider implements LLMProvider {
  readonly id: LLMProviderId;

  constructor(providerId: LLMProviderId) {
    this.id = providerId;
  }

  async generate(messages: LLMMessage[], config?: LLMConfig): Promise<{ text: string; ok: boolean; error?: string }> {
    // One-shot: prefer streaming (collect into a string) for tool support;
    // fall back to callInternalAI for legacy callers without tools.
    if (config?.tools && config.tools.length > 0) {
      let text = "";
      const r = await this.generateStream(messages, { onChunk: (c) => { text += c; } }, config);
      return { text: text || r.text, ok: r.ok, error: r.error };
    }

    const system = messages.find((m) => m.role === "system")?.content;
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    return await callInternalAI({
      systemPrompt: system,
      userPrompt: turns + "\n\nAssistant:",
      maxTokens: config?.maxTokens ?? 512,
      temperature: config?.temperature ?? 0.6,
      timeoutMs: 30_000,
    });
  }

  async generateStream(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    config?: LLMConfig,
  ): Promise<{ text: string; ok: boolean; error?: string }> {
    const provider = resolveProvider(this.id);
    if (!provider) {
      return {
        text: "",
        ok: false,
        error: `Voice-Pipeline Provider "${this.id}" ist nicht konfiguriert. In Settings → Providers den API-Key hinterlegen und aktivieren — oder in Settings → Telephony → Voice Engine einen anderen Provider wählen.`,
      };
    }

    if (provider.kind === "anthropic") {
      return streamAnthropicWithTools(messages, callbacks, config, provider);
    }
    return streamOpenAIWithTools(messages, callbacks, config, provider);
  }
}
