/**
 * Provider-agnostic internal AI caller.
 * Used by auto-namer and ai-validator. Supports any provider from the registry
 * via OpenAI-compatible Chat Completions format, plus Anthropic Messages API.
 */
import { getSettings } from "./settings-manager.js";
import { getProviderConfig, getEnabledProviders } from "./provider-manager.js";
import { getProviderById } from "./provider-registry.js";

interface InternalAiRequest {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface InternalAiResponse {
  text: string;
  ok: boolean;
  error?: string;
}

/** Known provider base URLs for OpenAI-compatible endpoints */
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

/** Default small/fast models per provider (for cheap internal tasks) */
const PROVIDER_INTERNAL_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
  together: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
  openrouter: "meta-llama/llama-3.1-8b-instruct:free",
  xai: "grok-3-mini",
  ollama: "llama3.1",
  qwen: "qwen-turbo",
};

/**
 * Resolve which provider and credentials to use for internal AI calls.
 * Priority: settings.internalAiProvider > first enabled provider > anthropic legacy key
 */
function resolveProvider(): { providerId: string; apiKey: string; baseUrl: string; model: string } | null {
  const settings = getSettings();

  // 1. Check explicit internalAiProvider setting
  const explicitId = settings.internalAiProvider as string | undefined;
  if (explicitId) {
    const result = resolveProviderById(explicitId);
    if (result) return result;
  }

  // 2. Legacy: check anthropicApiKey in settings
  if (settings.anthropicApiKey?.trim()) {
    return {
      providerId: "anthropic",
      apiKey: settings.anthropicApiKey.trim(),
      baseUrl: "https://api.anthropic.com/v1/messages",
      model: settings.anthropicModel?.trim() || "claude-haiku-4-5-20251001",
    };
  }

  // 3. Try first enabled provider
  const enabled = getEnabledProviders();
  for (const cfg of enabled) {
    const result = resolveProviderById(cfg.providerId);
    if (result) return result;
  }

  return null;
}

function resolveProviderById(id: string): { providerId: string; apiKey: string; baseUrl: string; model: string } | null {
  const def = getProviderById(id);
  if (!def) return null;

  const cfg = getProviderConfig(id);
  if (!cfg) return null;

  // Get API key from the first secret envField
  const secretField = def.envFields.find((f) => f.secret && f.required);
  const apiKey = secretField ? (cfg.envValues[secretField.key] || "") : "";

  // Get base URL from non-secret URL field or known defaults
  const urlField = def.envFields.find((f) => f.key.includes("BASE_URL"));
  let baseUrl = urlField ? (cfg.envValues[urlField.key] || "") : "";

  if (!baseUrl) {
    baseUrl = PROVIDER_BASE_URLS[id] || "";
  }

  // Special case: Ollama defaults
  if (id === "ollama" && !baseUrl) {
    baseUrl = "http://localhost:11434/v1";
  }

  const model = cfg.customModel || PROVIDER_INTERNAL_MODELS[id] || def.defaultModel || "";

  if (id === "anthropic" && apiKey) {
    return { providerId: id, apiKey, baseUrl: "https://api.anthropic.com/v1/messages", model };
  }

  if (!baseUrl || (!apiKey && id !== "ollama")) return null;
  return { providerId: id, apiKey, baseUrl, model };
}

/**
 * Call the configured internal AI provider.
 */
export async function callInternalAI(req: InternalAiRequest): Promise<InternalAiResponse> {
  const provider = resolveProvider();
  if (!provider) {
    return { text: "", ok: false, error: "No AI provider configured for internal features" };
  }

  const timeout = req.timeoutMs || 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    if (provider.providerId === "anthropic") {
      return await callAnthropic(provider, req, controller.signal);
    }
    return await callOpenAICompatible(provider, req, controller.signal);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      text: "",
      ok: false,
      error: isAbort ? "AI request timed out" : `AI request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  provider: { apiKey: string; baseUrl: string; model: string },
  req: InternalAiRequest,
  signal: AbortSignal,
): Promise<InternalAiResponse> {
  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: req.maxTokens || 256,
    messages: [{ role: "user", content: req.userPrompt }],
    temperature: req.temperature ?? 0.2,
  };
  if (req.systemPrompt) body.system = req.systemPrompt;

  const res = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    return { text: "", ok: false, error: `Anthropic API error: ${res.status}` };
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.[0]?.type === "text" ? (data.content[0].text ?? "") : "";
  return { text, ok: true };
}

async function callOpenAICompatible(
  provider: { apiKey: string; baseUrl: string; model: string },
  req: InternalAiRequest,
  signal: AbortSignal,
): Promise<InternalAiResponse> {
  const url = provider.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  messages.push({ role: "user", content: req.userPrompt });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: req.maxTokens || 256,
      messages,
      temperature: req.temperature ?? 0.2,
    }),
    signal,
  });

  if (!res.ok) {
    return { text: "", ok: false, error: `AI API error: ${res.status}` };
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, ok: true };
}

/**
 * Check if any AI provider is configured for internal features.
 */
export function hasInternalAI(): boolean {
  return resolveProvider() !== null;
}

/**
 * Get the name of the currently configured internal AI provider.
 */
export function getInternalAIProviderName(): string | null {
  const provider = resolveProvider();
  if (!provider) return null;
  const def = getProviderById(provider.providerId);
  return def?.name ?? provider.providerId;
}
