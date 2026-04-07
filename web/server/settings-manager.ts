import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
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
  /** Gemini Live voice name (e.g. Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr) */
  geminiVoice: string;
  /** Custom name for the voice assistant (e.g. "Jarvis", "Friday") */
  assistantName: string;
  /** User's display name so the assistant knows who it's talking to */
  userName: string;
  editorTabEnabled: boolean;
  /** Provider ID for internal AI features (auto-renaming, AI validation). Empty = auto-detect. */
  internalAiProvider: string;
  aiValidationEnabled: boolean;
  aiValidationAutoApprove: boolean;
  aiValidationAutoDeny: boolean;
  publicUrl: string;
  updateChannel: UpdateChannel;
  dockerAutoUpdate: boolean;
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
  geminiVoice: "Kore",
  assistantName: "",
  userName: "",
  editorTabEnabled: false,
  internalAiProvider: "",
  aiValidationEnabled: false,
  aiValidationAutoApprove: true,
  aiValidationAutoDeny: false,
  publicUrl: "",
  updateChannel: "stable",
  dockerAutoUpdate: false,
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
    geminiVoice: typeof raw?.geminiVoice === "string" && raw.geminiVoice.trim() ? raw.geminiVoice : "Kore",
    assistantName: typeof raw?.assistantName === "string" ? raw.assistantName.trim() : "",
    userName: typeof raw?.userName === "string" ? raw.userName.trim() : "",
    editorTabEnabled: typeof raw?.editorTabEnabled === "boolean" ? raw.editorTabEnabled : false,
    internalAiProvider: typeof raw?.internalAiProvider === "string" ? raw.internalAiProvider.trim() : "",
    aiValidationEnabled: typeof raw?.aiValidationEnabled === "boolean" ? raw.aiValidationEnabled : false,
    aiValidationAutoApprove: typeof raw?.aiValidationAutoApprove === "boolean" ? raw.aiValidationAutoApprove : true,
    aiValidationAutoDeny: typeof raw?.aiValidationAutoDeny === "boolean" ? raw.aiValidationAutoDeny : false,
    publicUrl: typeof raw?.publicUrl === "string" ? raw.publicUrl.trim().replace(/\/+$/, "") : "",
    updateChannel: raw?.updateChannel === "prerelease" ? "prerelease" : "stable",
    dockerAutoUpdate: typeof raw?.dockerAutoUpdate === "boolean" ? raw.dockerAutoUpdate : false,
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
  writeFileSync(filePath, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function getSettings(): HeyHankSettings {
  ensureLoaded();
  return { ...settings };
}

export function updateSettings(
  patch: Partial<Pick<HeyHankSettings, "anthropicApiKey" | "anthropicModel" | "claudeCodeOAuthToken" | "openaiApiKey" | "onboardingCompleted" | "geminiApiKey" | "geminiVoice" | "assistantName" | "userName" | "editorTabEnabled" | "internalAiProvider" | "aiValidationEnabled" | "aiValidationAutoApprove" | "aiValidationAutoDeny" | "publicUrl" | "updateChannel" | "dockerAutoUpdate">>,
): HeyHankSettings {
  ensureLoaded();
  settings = normalize({
    anthropicApiKey: patch.anthropicApiKey ?? settings.anthropicApiKey,
    anthropicModel: patch.anthropicModel ?? settings.anthropicModel,
    claudeCodeOAuthToken: patch.claudeCodeOAuthToken ?? settings.claudeCodeOAuthToken,
    openaiApiKey: patch.openaiApiKey ?? settings.openaiApiKey,
    onboardingCompleted: patch.onboardingCompleted ?? settings.onboardingCompleted,
    geminiApiKey: patch.geminiApiKey ?? settings.geminiApiKey,
    geminiVoice: patch.geminiVoice ?? settings.geminiVoice,
    assistantName: patch.assistantName ?? settings.assistantName,
    userName: patch.userName ?? settings.userName,
    editorTabEnabled: patch.editorTabEnabled ?? settings.editorTabEnabled,
    internalAiProvider: patch.internalAiProvider ?? settings.internalAiProvider,
    aiValidationEnabled: patch.aiValidationEnabled ?? settings.aiValidationEnabled,
    aiValidationAutoApprove: patch.aiValidationAutoApprove ?? settings.aiValidationAutoApprove,
    aiValidationAutoDeny: patch.aiValidationAutoDeny ?? settings.aiValidationAutoDeny,
    publicUrl: patch.publicUrl ?? settings.publicUrl,
    updateChannel: patch.updateChannel ?? settings.updateChannel,
    dockerAutoUpdate: patch.dockerAutoUpdate ?? settings.dockerAutoUpdate,
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
