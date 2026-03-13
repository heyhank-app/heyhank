import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { COMPANION_HOME } from "./paths.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export type UpdateChannel = "stable" | "prerelease";

export interface CompanionSettings {
  anthropicApiKey: string;
  anthropicModel: string;
  linearApiKey: string;
  linearAutoTransition: boolean;
  linearAutoTransitionStateId: string;
  linearAutoTransitionStateName: string;
  linearArchiveTransition: boolean;
  linearArchiveTransitionStateId: string;
  linearArchiveTransitionStateName: string;
  /** Linear OAuth app client ID (for Agent Interaction SDK) */
  linearOAuthClientId: string;
  /** Linear OAuth app client secret */
  linearOAuthClientSecret: string;
  /** Webhook signing secret for the Linear OAuth app */
  linearOAuthWebhookSecret: string;
  /** OAuth access token (obtained via actor=app install flow) */
  linearOAuthAccessToken: string;
  /** OAuth refresh token (for 24h token rotation) */
  linearOAuthRefreshToken: string;
  editorTabEnabled: boolean;
  aiValidationEnabled: boolean;
  aiValidationAutoApprove: boolean;
  aiValidationAutoDeny: boolean;
  publicUrl: string;
  updateChannel: UpdateChannel;
  dockerAutoUpdate: boolean;
  updatedAt: number;
}

const DEFAULT_PATH = join(COMPANION_HOME, "settings.json");

let loaded = false;
let filePath = DEFAULT_PATH;
let settings: CompanionSettings = {
  anthropicApiKey: "",
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  linearApiKey: "",
  linearAutoTransition: false,
  linearAutoTransitionStateId: "",
  linearAutoTransitionStateName: "",
  linearArchiveTransition: false,
  linearArchiveTransitionStateId: "",
  linearArchiveTransitionStateName: "",
  linearOAuthClientId: "",
  linearOAuthClientSecret: "",
  linearOAuthWebhookSecret: "",
  linearOAuthAccessToken: "",
  linearOAuthRefreshToken: "",
  editorTabEnabled: false,
  aiValidationEnabled: false,
  aiValidationAutoApprove: true,
  aiValidationAutoDeny: false,
  publicUrl: "",
  updateChannel: "stable",
  dockerAutoUpdate: false,
  updatedAt: 0,
};

function normalize(raw: Partial<CompanionSettings> | null | undefined): CompanionSettings {
  return {
    anthropicApiKey: typeof raw?.anthropicApiKey === "string" ? raw.anthropicApiKey : "",
    anthropicModel:
      typeof raw?.anthropicModel === "string" && raw.anthropicModel.trim()
        ? raw.anthropicModel === "claude-sonnet-4.6" ? DEFAULT_ANTHROPIC_MODEL : raw.anthropicModel
        : DEFAULT_ANTHROPIC_MODEL,
    linearApiKey: typeof raw?.linearApiKey === "string" ? raw.linearApiKey : "",
    linearAutoTransition: typeof raw?.linearAutoTransition === "boolean" ? raw.linearAutoTransition : false,
    linearAutoTransitionStateId: typeof raw?.linearAutoTransitionStateId === "string" ? raw.linearAutoTransitionStateId : "",
    linearAutoTransitionStateName: typeof raw?.linearAutoTransitionStateName === "string" ? raw.linearAutoTransitionStateName : "",
    linearArchiveTransition: typeof raw?.linearArchiveTransition === "boolean" ? raw.linearArchiveTransition : false,
    linearArchiveTransitionStateId: typeof raw?.linearArchiveTransitionStateId === "string" ? raw.linearArchiveTransitionStateId : "",
    linearArchiveTransitionStateName: typeof raw?.linearArchiveTransitionStateName === "string" ? raw.linearArchiveTransitionStateName : "",
    linearOAuthClientId: typeof raw?.linearOAuthClientId === "string" ? raw.linearOAuthClientId : "",
    linearOAuthClientSecret: typeof raw?.linearOAuthClientSecret === "string" ? raw.linearOAuthClientSecret : "",
    linearOAuthWebhookSecret: typeof raw?.linearOAuthWebhookSecret === "string" ? raw.linearOAuthWebhookSecret : "",
    linearOAuthAccessToken: typeof raw?.linearOAuthAccessToken === "string" ? raw.linearOAuthAccessToken : "",
    linearOAuthRefreshToken: typeof raw?.linearOAuthRefreshToken === "string" ? raw.linearOAuthRefreshToken : "",
    editorTabEnabled: typeof raw?.editorTabEnabled === "boolean" ? raw.editorTabEnabled : false,
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
      settings = normalize(JSON.parse(raw) as Partial<CompanionSettings>);
    }
  } catch {
    settings = normalize(null);
  }
  loaded = true;
}

function persist(): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
}

export function getSettings(): CompanionSettings {
  ensureLoaded();
  return { ...settings };
}

export function updateSettings(
  patch: Partial<Pick<CompanionSettings, "anthropicApiKey" | "anthropicModel" | "linearApiKey" | "linearAutoTransition" | "linearAutoTransitionStateId" | "linearAutoTransitionStateName" | "linearArchiveTransition" | "linearArchiveTransitionStateId" | "linearArchiveTransitionStateName" | "linearOAuthClientId" | "linearOAuthClientSecret" | "linearOAuthWebhookSecret" | "linearOAuthAccessToken" | "linearOAuthRefreshToken" | "editorTabEnabled" | "aiValidationEnabled" | "aiValidationAutoApprove" | "aiValidationAutoDeny" | "publicUrl" | "updateChannel" | "dockerAutoUpdate">>,
): CompanionSettings {
  ensureLoaded();
  settings = normalize({
    anthropicApiKey: patch.anthropicApiKey ?? settings.anthropicApiKey,
    anthropicModel: patch.anthropicModel ?? settings.anthropicModel,
    linearApiKey: patch.linearApiKey ?? settings.linearApiKey,
    linearAutoTransition: patch.linearAutoTransition ?? settings.linearAutoTransition,
    linearAutoTransitionStateId: patch.linearAutoTransitionStateId ?? settings.linearAutoTransitionStateId,
    linearAutoTransitionStateName: patch.linearAutoTransitionStateName ?? settings.linearAutoTransitionStateName,
    linearArchiveTransition: patch.linearArchiveTransition ?? settings.linearArchiveTransition,
    linearArchiveTransitionStateId: patch.linearArchiveTransitionStateId ?? settings.linearArchiveTransitionStateId,
    linearArchiveTransitionStateName: patch.linearArchiveTransitionStateName ?? settings.linearArchiveTransitionStateName,
    linearOAuthClientId: patch.linearOAuthClientId ?? settings.linearOAuthClientId,
    linearOAuthClientSecret: patch.linearOAuthClientSecret ?? settings.linearOAuthClientSecret,
    linearOAuthWebhookSecret: patch.linearOAuthWebhookSecret ?? settings.linearOAuthWebhookSecret,
    linearOAuthAccessToken: patch.linearOAuthAccessToken ?? settings.linearOAuthAccessToken,
    linearOAuthRefreshToken: patch.linearOAuthRefreshToken ?? settings.linearOAuthRefreshToken,
    editorTabEnabled: patch.editorTabEnabled ?? settings.editorTabEnabled,
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
