// ─── Multi-LLM Provider System ───────────────────────────────────────────────
// Unified interface for calling different LLM backends
// Used by agents that don't need the full CLI WebSocket bridge

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCost?: number;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface LLMProviderConfig {
  provider: "ollama" | "openrouter" | "gemini";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── Cost Estimates (USD per 1M tokens) ──────────────────────────────────────

const COST_TABLE: Record<string, { input: number; output: number }> = {
  // OpenRouter pricing (approximate)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-coder": { input: 0.14, output: 0.28 },
  // Ollama is free (local)
  default: { input: 0, output: 0 },
};

function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = COST_TABLE[model] ?? COST_TABLE["default"];
  return (
    (tokensIn / 1_000_000) * pricing.input +
    (tokensOut / 1_000_000) * pricing.output
  );
}

// ─── Ollama Provider ─────────────────────────────────────────────────────────

async function callOllama(
  messages: LLMMessage[],
  config: LLMProviderConfig,
): Promise<LLMResponse> {
  const baseUrl = config.baseUrl || "http://localhost:11434";

  // Warn about insecure remote Ollama URLs
  if (baseUrl.startsWith("http://") && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1") && !baseUrl.includes(".ts.net")) {
    console.warn(`[llm-providers] WARNING: Ollama URL "${baseUrl}" uses HTTP over a potentially public network. Consider using Tailscale (.ts.net) for secure remote access.`);
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: config.temperature ?? 0.7,
        num_predict: config.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    message: { content: string };
    model: string;
    eval_count?: number;
    prompt_eval_count?: number;
  };

  const tokensIn = data.prompt_eval_count ?? 0;
  const tokensOut = data.eval_count ?? 0;

  return {
    content: data.message.content,
    model: data.model,
    provider: "ollama",
    tokensIn,
    tokensOut,
    estimatedCost: 0, // Local = free
  };
}

/** Stream from Ollama. Yields chunks. */
export async function* streamOllama(
  messages: LLMMessage[],
  config: LLMProviderConfig,
): AsyncGenerator<LLMStreamChunk> {
  const baseUrl = config.baseUrl || "http://localhost:11434";

  // Warn about insecure remote Ollama URLs
  if (baseUrl.startsWith("http://") && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1") && !baseUrl.includes(".ts.net")) {
    console.warn(`[llm-providers] WARNING: Ollama URL "${baseUrl}" uses HTTP over a potentially public network. Consider using Tailscale (.ts.net) for secure remote access.`);
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: config.temperature ?? 0.7,
        num_predict: config.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama stream error ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as {
          message?: { content: string };
          done: boolean;
        };
        yield {
          content: data.message?.content || "",
          done: data.done,
        };
      } catch {
        // Skip malformed lines
      }
    }
  }
}

// ─── OpenRouter Provider ─────────────────────────────────────────────────────

async function callOpenRouter(
  messages: LLMMessage[],
  config: LLMProviderConfig,
): Promise<LLMResponse> {
  const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OpenRouter API key required (set OPENROUTER_API_KEY)");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/maxx-agent/platform",
      "X-Title": "Agent Platform",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;

  return {
    content: data.choices[0]?.message?.content || "",
    model: data.model,
    provider: "openrouter",
    tokensIn,
    tokensOut,
    estimatedCost: estimateCost(config.model, tokensIn, tokensOut),
  };
}

// ─── Gemini Provider ─────────────────────────────────────────────────────────

async function callGemini(
  messages: LLMMessage[],
  config: LLMProviderConfig,
): Promise<LLMResponse> {
  const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key required (set GEMINI_API_KEY)");
  }

  const model = config.model || "gemini-2.5-flash";

  // Convert messages to Gemini format
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction }] }
          : undefined,
        generationConfig: {
          temperature: config.temperature ?? 0.7,
          maxOutputTokens: config.maxTokens ?? 4096,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> };
    }>;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
    };
  };

  const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;
  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  return {
    content,
    model,
    provider: "gemini",
    tokensIn,
    tokensOut,
    estimatedCost: estimateCost(model, tokensIn, tokensOut),
  };
}

// ─── Unified Call Function ───────────────────────────────────────────────────

/** Call any LLM provider with a unified interface. */
export async function callLLM(
  messages: LLMMessage[],
  config: LLMProviderConfig,
): Promise<LLMResponse> {
  switch (config.provider) {
    case "ollama":
      return callOllama(messages, config);
    case "openrouter":
      return callOpenRouter(messages, config);
    case "gemini":
      return callGemini(messages, config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/** List available Ollama models. */
export async function listOllamaModels(
  baseUrl = "http://localhost:11434",
): Promise<Array<{ name: string; size: number; modified_at: string }>> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      models: Array<{ name: string; size: number; modified_at: string }>;
    };
    return data.models || [];
  } catch {
    return [];
  }
}

/** Pull an Ollama model (non-blocking). */
export async function pullOllamaModel(
  model: string,
  baseUrl = "http://localhost:11434",
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to pull model ${model}: ${text}`);
  }
}
