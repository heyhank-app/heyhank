import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export type UpdateChannel = "stable" | "prerelease";

export interface HeyHankSettings {
  anthropicApiKey: string;
  anthropicModel: string;
  /** OAuth token obtained via `claude setup-token` — injected as CLAUDE_CODE_OAUTH_TOKEN */
  claudeCodeOAuthToken: string;
  /** OpenAI API key for Codex — injected as OPENAI_API_KEY */
  openaiApiKey: string;
  /** Whether the onboarding wizard has been completed */
  onboardingCompleted: boolean;
  /** Gemini API key for voice chat */
  geminiApiKey: string;
  /** Apify API token for Instagram scraping (SocialView/Inspiration import) */
  apifyApiKey: string;
  /** Gemini Live voice name (e.g. Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr) */
  geminiVoice: string;
  /** Custom name for the voice assistant (e.g. "Jarvis", "Friday") */
  assistantName: string;
  /** User's display name so the assistant knows who it's talking to */
  userName: string;
  /** Selected chat provider for Hank-UI (default: "gemini-live") */
  hankChatProvider: string;
  /** Selected model for Hank-UI text chat */
  hankChatModel: string;
  /** Whether to show a 3D TalkingHead avatar during Gemini Live sessions */
  hankChatAvatarEnabled: boolean;
  /** URL to a Ready Player Me (or compatible) GLB avatar with ARKit + Oculus visemes */
  hankChatAvatarUrl: string;
  /** @deprecated No longer used — memory is fully local */
  mem0ApiKey: string;
  /** @deprecated No longer used — memory is fully local */
  mem0UserId: string;
  /** Auto-detect and save memories from conversations */
  memoryAutoDetect: boolean;
  editorTabEnabled: boolean;
  /** Provider ID for internal AI features (auto-renaming, AI validation). Empty = auto-detect. */
  internalAiProvider: string;
  aiValidationEnabled: boolean;
  aiValidationAutoApprove: boolean;
  aiValidationAutoDeny: boolean;
  publicUrl: string;
  updateChannel: UpdateChannel;
  dockerAutoUpdate: boolean;
  /** Path to Obsidian vault folder for memory sync (empty = disabled) */
  obsidianVaultPath: string;
  updatedAt: number;
}

const DEFAULT_PATH = join(HEYHANK_HOME, "settings.json");

let loaded = false;
let filePath = DEFAULT_PATH;
let settings: HeyHankSettings = {
  anthropicApiKey: "",
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  claudeCodeOAuthToken: "",
  openaiApiKey: "",
  onboardingCompleted: false,
  geminiApiKey: "",
  apifyApiKey: "",
  geminiVoice: "Kore",
  assistantName: "",
  userName: "",
  hankChatProvider: "gemini-live",
  hankChatModel: "",
  hankChatAvatarEnabled: true,
  // No default URL: models.readyplayer.me was retired (DNS NXDOMAIN),
  // so the user must paste a working GLB URL in Settings.
  hankChatAvatarUrl: "",
  mem0ApiKey: "",
  mem0UserId: "",
  memoryAutoDetect: true,
  editorTabEnabled: false,
  internalAiProvider: "",
  aiValidationEnabled: false,
  aiValidationAutoApprove: true,
  aiValidationAutoDeny: false,
  publicUrl: "",
  updateChannel: "stable",
  dockerAutoUpdate: false,
  obsidianVaultPath: "",
  updatedAt: 0,
};

function normalize(raw: Partial<HeyHankSettings> | null | undefined): HeyHankSettings {
  return {
    anthropicApiKey: typeof raw?.anthropicApiKey === "string" ? raw.anthropicApiKey : "",
    anthropicModel:
      typeof raw?.anthropicModel === "string" && raw.anthropicModel.trim()
        ? raw.anthropicModel === "claude-sonnet-4.6" ? DEFAULT_ANTHROPIC_MODEL : raw.anthropicModel
        : DEFAULT_ANTHROPIC_MODEL,
    claudeCodeOAuthToken: typeof raw?.claudeCodeOAuthToken === "string" ? raw.claudeCodeOAuthToken : "",
    openaiApiKey: typeof raw?.openaiApiKey === "string" ? raw.openaiApiKey : "",
    onboardingCompleted: typeof raw?.onboardingCompleted === "boolean" ? raw.onboardingCompleted : false,
    geminiApiKey: typeof raw?.geminiApiKey === "string" ? raw.geminiApiKey : "",
    apifyApiKey: typeof raw?.apifyApiKey === "string" ? raw.apifyApiKey : "",
    geminiVoice: typeof raw?.geminiVoice === "string" && raw.geminiVoice.trim() ? raw.geminiVoice : "Kore",
    assistantName: typeof raw?.assistantName === "string" ? raw.assistantName.trim() : "",
    userName: typeof raw?.userName === "string" ? raw.userName.trim() : "",
    hankChatProvider: typeof raw?.hankChatProvider === "string" ? raw.hankChatProvider.trim() || "gemini-live" : "gemini-live",
    hankChatModel: typeof raw?.hankChatModel === "string" ? raw.hankChatModel.trim() : "",
    hankChatAvatarEnabled: typeof raw?.hankChatAvatarEnabled === "boolean" ? raw.hankChatAvatarEnabled : true,
    hankChatAvatarUrl:
      typeof raw?.hankChatAvatarUrl === "string"
        ? raw.hankChatAvatarUrl.trim()
        : "",
    mem0ApiKey: typeof raw?.mem0ApiKey === "string" ? raw.mem0ApiKey : "",
    mem0UserId: typeof raw?.mem0UserId === "string" ? raw.mem0UserId.trim() : "",
    memoryAutoDetect: typeof raw?.memoryAutoDetect === "boolean" ? raw.memoryAutoDetect : true,
    editorTabEnabled: typeof raw?.editorTabEnabled === "boolean" ? raw.editorTabEnabled : false,
    internalAiProvider: typeof raw?.internalAiProvider === "string" ? raw.internalAiProvider.trim() : "",
    aiValidationEnabled: typeof raw?.aiValidationEnabled === "boolean" ? raw.aiValidationEnabled : false,
    aiValidationAutoApprove: typeof raw?.aiValidationAutoApprove === "boolean" ? raw.aiValidationAutoApprove : true,
    aiValidationAutoDeny: typeof raw?.aiValidationAutoDeny === "boolean" ? raw.aiValidationAutoDeny : false,
    publicUrl: typeof raw?.publicUrl === "string" ? raw.publicUrl.trim().replace(/\/+$/, "") : "",
    updateChannel: raw?.updateChannel === "prerelease" ? "prerelease" : "stable",
    dockerAutoUpdate: typeof raw?.dockerAutoUpdate === "boolean" ? raw.dockerAutoUpdate : false,
    obsidianVaultPath: typeof raw?.obsidianVaultPath === "string" ? raw.obsidianVaultPath.trim() : "",
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

function ensureLoaded(): void {
  if (loaded) return;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      settings = normalize(JSON.parse(raw) as Partial<HeyHankSettings>);
    }
  } catch {
    settings = normalize(null);
  }
  loaded = true;
}

function persist(): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpFile = filePath + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpFile, filePath);
}

export function getSettings(): HeyHankSettings {
  ensureLoaded();
  return { ...settings };
}

export function updateSettings(
  patch: Partial<Pick<HeyHankSettings, "anthropicApiKey" | "anthropicModel" | "claudeCodeOAuthToken" | "openaiApiKey" | "onboardingCompleted" | "geminiApiKey" | "apifyApiKey" | "geminiVoice" | "assistantName" | "userName" | "hankChatProvider" | "hankChatModel" | "hankChatAvatarEnabled" | "hankChatAvatarUrl" | "mem0ApiKey" | "mem0UserId" | "memoryAutoDetect" | "editorTabEnabled" | "internalAiProvider" | "aiValidationEnabled" | "aiValidationAutoApprove" | "aiValidationAutoDeny" | "publicUrl" | "updateChannel" | "dockerAutoUpdate" | "obsidianVaultPath">>,
): HeyHankSettings {
  ensureLoaded();
  settings = normalize({
    anthropicApiKey: patch.anthropicApiKey ?? settings.anthropicApiKey,
    anthropicModel: patch.anthropicModel ?? settings.anthropicModel,
    claudeCodeOAuthToken: patch.claudeCodeOAuthToken ?? settings.claudeCodeOAuthToken,
    openaiApiKey: patch.openaiApiKey ?? settings.openaiApiKey,
    onboardingCompleted: patch.onboardingCompleted ?? settings.onboardingCompleted,
    geminiApiKey: patch.geminiApiKey ?? settings.geminiApiKey,
    apifyApiKey: patch.apifyApiKey ?? settings.apifyApiKey,
    geminiVoice: patch.geminiVoice ?? settings.geminiVoice,
    assistantName: patch.assistantName ?? settings.assistantName,
    userName: patch.userName ?? settings.userName,
    hankChatProvider: patch.hankChatProvider ?? settings.hankChatProvider,
    hankChatModel: patch.hankChatModel ?? settings.hankChatModel,
    hankChatAvatarEnabled: patch.hankChatAvatarEnabled ?? settings.hankChatAvatarEnabled,
    hankChatAvatarUrl: patch.hankChatAvatarUrl ?? settings.hankChatAvatarUrl,
    mem0ApiKey: patch.mem0ApiKey ?? settings.mem0ApiKey,
    mem0UserId: patch.mem0UserId ?? settings.mem0UserId,
    memoryAutoDetect: patch.memoryAutoDetect ?? settings.memoryAutoDetect,
    editorTabEnabled: patch.editorTabEnabled ?? settings.editorTabEnabled,
    internalAiProvider: patch.internalAiProvider ?? settings.internalAiProvider,
    aiValidationEnabled: patch.aiValidationEnabled ?? settings.aiValidationEnabled,
    aiValidationAutoApprove: patch.aiValidationAutoApprove ?? settings.aiValidationAutoApprove,
    aiValidationAutoDeny: patch.aiValidationAutoDeny ?? settings.aiValidationAutoDeny,
    publicUrl: patch.publicUrl ?? settings.publicUrl,
    updateChannel: patch.updateChannel ?? settings.updateChannel,
    dockerAutoUpdate: patch.dockerAutoUpdate ?? settings.dockerAutoUpdate,
    obsidianVaultPath: patch.obsidianVaultPath ?? settings.obsidianVaultPath,
    updatedAt: Date.now(),
  });
  persist();
  return { ...settings };
}

export function _resetForTest(customPath?: string): void {
  loaded = false;
  filePath = customPath || DEFAULT_PATH;
  settings = normalize(null);
}
