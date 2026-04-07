/**
 * Static registry of all known Claude Code CLI providers.
 * Pure data — no I/O, no state.
 */

export interface ProviderEnvField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  envFields: ProviderEnvField[];
  defaultModel?: string;
  docsUrl?: string;
  cliProviderFlag: string;
  category: "cloud" | "gateway" | "local" | "custom";
}

const PROVIDER_REGISTRY: ProviderDefinition[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models via Anthropic API",
    cliProviderFlag: "anthropic",
    category: "cloud",
    defaultModel: "claude-sonnet-4-6",
    docsUrl: "https://docs.anthropic.com/",
    envFields: [
      { key: "ANTHROPIC_API_KEY", label: "API Key", required: true, secret: true, placeholder: "sk-ant-..." },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models via OpenAI API",
    cliProviderFlag: "openai",
    category: "cloud",
    defaultModel: "gpt-4o",
    docsUrl: "https://platform.openai.com/docs",
    envFields: [
      { key: "OPENAI_API_KEY", label: "API Key", required: true, secret: true, placeholder: "sk-..." },
    ],
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini models via Google AI",
    cliProviderFlag: "google",
    category: "cloud",
    defaultModel: "gemini-2.5-pro",
    docsUrl: "https://ai.google.dev/docs",
    envFields: [
      { key: "GOOGLE_API_KEY", label: "API Key", required: true, secret: true, placeholder: "AIza..." },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    description: "Mistral & Codestral models",
    cliProviderFlag: "mistral",
    category: "cloud",
    defaultModel: "codestral-latest",
    docsUrl: "https://docs.mistral.ai/",
    envFields: [
      { key: "MISTRAL_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek coding models",
    cliProviderFlag: "deepseek",
    category: "cloud",
    defaultModel: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/docs",
    envFields: [
      { key: "DEEPSEEK_API_KEY", label: "API Key", required: true, secret: true, placeholder: "sk-..." },
    ],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    description: "Grok models via xAI",
    cliProviderFlag: "xai",
    category: "cloud",
    defaultModel: "grok-3",
    docsUrl: "https://docs.x.ai/",
    envFields: [
      { key: "XAI_API_KEY", label: "API Key", required: true, secret: true, placeholder: "xai-..." },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access hundreds of models through one API",
    cliProviderFlag: "openrouter",
    category: "gateway",
    docsUrl: "https://openrouter.ai/docs",
    envFields: [
      { key: "OPENROUTER_API_KEY", label: "API Key", required: true, secret: true, placeholder: "sk-or-..." },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    description: "Open-source models hosted by Together",
    cliProviderFlag: "together",
    category: "cloud",
    docsUrl: "https://docs.together.ai/",
    envFields: [
      { key: "TOGETHER_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Run models locally with Ollama",
    cliProviderFlag: "ollama",
    category: "local",
    defaultModel: "llama3.1",
    docsUrl: "https://ollama.com/",
    envFields: [
      { key: "OLLAMA_BASE_URL", label: "Base URL", required: false, secret: false, placeholder: "http://localhost:11434" },
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Models via Hugging Face Inference API",
    cliProviderFlag: "huggingface",
    category: "cloud",
    docsUrl: "https://huggingface.co/docs/api-inference",
    envFields: [
      { key: "HF_TOKEN", label: "API Token", required: true, secret: true, placeholder: "hf_..." },
    ],
  },
  {
    id: "copilot",
    name: "Copilot",
    description: "GitHub Copilot as provider",
    cliProviderFlag: "copilot",
    category: "cloud",
    docsUrl: "https://docs.github.com/en/copilot",
    envFields: [
      { key: "GITHUB_TOKEN", label: "GitHub Token", required: true, secret: true, placeholder: "ghp_..." },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare AI Gateway",
    description: "Route through Cloudflare AI Gateway",
    cliProviderFlag: "cloudflare",
    category: "gateway",
    docsUrl: "https://developers.cloudflare.com/ai-gateway/",
    envFields: [
      { key: "CLOUDFLARE_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
      { key: "CLOUDFLARE_ACCOUNT_ID", label: "Account ID", required: true, secret: false, placeholder: "..." },
      { key: "CLOUDFLARE_GATEWAY_ID", label: "Gateway ID", required: true, secret: false, placeholder: "..." },
    ],
  },
  {
    id: "litellm",
    name: "LiteLLM",
    description: "Unified proxy for 100+ LLM providers",
    cliProviderFlag: "litellm",
    category: "gateway",
    docsUrl: "https://docs.litellm.ai/",
    envFields: [
      { key: "LITELLM_API_KEY", label: "API Key", required: false, secret: true, placeholder: "sk-..." },
      { key: "LITELLM_BASE_URL", label: "Base URL", required: true, secret: false, placeholder: "http://localhost:4000" },
    ],
  },
  {
    id: "byteplus",
    name: "BytePlus",
    description: "BytePlus ModelArk models",
    cliProviderFlag: "byteplus",
    category: "cloud",
    envFields: [
      { key: "BYTEPLUS_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "chutes",
    name: "Chutes",
    description: "Chutes AI inference platform",
    cliProviderFlag: "chutes",
    category: "cloud",
    envFields: [
      { key: "CHUTES_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "kilo",
    name: "Kilo Gateway",
    description: "Kilo AI Gateway",
    cliProviderFlag: "kilo",
    category: "gateway",
    envFields: [
      { key: "KILO_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
      { key: "KILO_BASE_URL", label: "Base URL", required: false, secret: false, placeholder: "https://api.kilo.ai" },
    ],
  },
  {
    id: "kimi",
    name: "Kimi Code",
    description: "Moonshot AI Kimi coding models",
    cliProviderFlag: "kimi",
    category: "cloud",
    defaultModel: "kimi-k2.5",
    envFields: [
      { key: "MOONSHOT_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax AI models",
    cliProviderFlag: "minimax",
    category: "cloud",
    envFields: [
      { key: "MINIMAX_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    description: "Moonshot AI (Kimi K2.5)",
    cliProviderFlag: "moonshot",
    category: "cloud",
    defaultModel: "kimi-k2.5",
    envFields: [
      { key: "MOONSHOT_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode provider",
    cliProviderFlag: "opencode",
    category: "cloud",
    envFields: [
      { key: "OPENCODE_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "qianfan",
    name: "Qianfan",
    description: "Baidu Qianfan platform",
    cliProviderFlag: "qianfan",
    category: "cloud",
    envFields: [
      { key: "QIANFAN_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "qwen",
    name: "Qwen",
    description: "Qwen models",
    cliProviderFlag: "qwen",
    category: "cloud",
    defaultModel: "qwen-max",
    envFields: [
      { key: "DASHSCOPE_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "qwen-alibaba",
    name: "Qwen (Alibaba Cloud)",
    description: "Qwen via Alibaba Cloud Model Studio",
    cliProviderFlag: "qwen-alibaba",
    category: "cloud",
    envFields: [
      { key: "ALIBABA_CLOUD_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "sglang",
    name: "SGLang",
    description: "SGLang inference server",
    cliProviderFlag: "sglang",
    category: "local",
    envFields: [
      { key: "SGLANG_BASE_URL", label: "Base URL", required: true, secret: false, placeholder: "http://localhost:30000" },
      { key: "SGLANG_API_KEY", label: "API Key", required: false, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "synthetic",
    name: "Synthetic",
    description: "Synthetic AI provider",
    cliProviderFlag: "synthetic",
    category: "cloud",
    envFields: [
      { key: "SYNTHETIC_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "venice",
    name: "Venice AI",
    description: "Venice AI privacy-focused inference",
    cliProviderFlag: "venice",
    category: "cloud",
    docsUrl: "https://docs.venice.ai/",
    envFields: [
      { key: "VENICE_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "vercel",
    name: "Vercel AI Gateway",
    description: "Route through Vercel AI Gateway",
    cliProviderFlag: "vercel",
    category: "gateway",
    docsUrl: "https://vercel.com/docs/ai-gateway",
    envFields: [
      { key: "VERCEL_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "vllm",
    name: "vLLM",
    description: "Self-hosted vLLM inference server",
    cliProviderFlag: "vllm",
    category: "local",
    envFields: [
      { key: "VLLM_BASE_URL", label: "Base URL", required: true, secret: false, placeholder: "http://localhost:8000" },
      { key: "VLLM_API_KEY", label: "API Key", required: false, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "volcano",
    name: "Volcano Engine",
    description: "ByteDance Volcano Engine",
    cliProviderFlag: "volcano",
    category: "cloud",
    envFields: [
      { key: "VOLC_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "xiaomi",
    name: "Xiaomi",
    description: "Xiaomi AI models",
    cliProviderFlag: "xiaomi",
    category: "cloud",
    envFields: [
      { key: "XIAOMI_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "zai",
    name: "Z.AI",
    description: "GLM Coding Plan — Global & CN",
    cliProviderFlag: "zai",
    category: "cloud",
    envFields: [
      { key: "ZAI_API_KEY", label: "API Key", required: true, secret: true, placeholder: "..." },
    ],
  },
  {
    id: "custom",
    name: "Custom Provider",
    description: "Any OpenAI-compatible API endpoint",
    cliProviderFlag: "custom",
    category: "custom",
    envFields: [
      { key: "CUSTOM_API_KEY", label: "API Key", required: false, secret: true, placeholder: "sk-..." },
      { key: "CUSTOM_BASE_URL", label: "Base URL", required: true, secret: false, placeholder: "https://your-api.com/v1" },
      { key: "CUSTOM_MODEL", label: "Model Name", required: false, secret: false, placeholder: "model-name" },
    ],
  },
];

const registryMap = new Map(PROVIDER_REGISTRY.map((p) => [p.id, p]));

export function getProviderById(id: string): ProviderDefinition | undefined {
  return registryMap.get(id);
}

export function getAllProviders(): ProviderDefinition[] {
  return PROVIDER_REGISTRY;
}

export function getProvidersByCategory(category: ProviderDefinition["category"]): ProviderDefinition[] {
  return PROVIDER_REGISTRY.filter((p) => p.category === category);
}
