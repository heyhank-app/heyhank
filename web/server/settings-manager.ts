import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

export interface CompanionSettings {
  openrouterApiKey: string;
  openrouterModel: string;
  linearApiKey: string;
  linearAutoTransition: boolean;
  linearAutoTransitionStateId: string;
  linearAutoTransitionStateName: string;
  editorTabEnabled: boolean;
  updatedAt: number;
}

const DEFAULT_PATH = join(homedir(), ".companion", "settings.json");

let loaded = false;
let filePath = DEFAULT_PATH;
let settings: CompanionSettings = {
  openrouterApiKey: "",
  openrouterModel: DEFAULT_OPENROUTER_MODEL,
  linearApiKey: "",
  linearAutoTransition: false,
  linearAutoTransitionStateId: "",
  linearAutoTransitionStateName: "",
  editorTabEnabled: false,
  updatedAt: 0,
};

function normalize(raw: Partial<CompanionSettings> | null | undefined): CompanionSettings {
  return {
    openrouterApiKey: typeof raw?.openrouterApiKey === "string" ? raw.openrouterApiKey : "",
    openrouterModel:
      typeof raw?.openrouterModel === "string" && raw.openrouterModel.trim()
        ? raw.openrouterModel
        : DEFAULT_OPENROUTER_MODEL,
    linearApiKey: typeof raw?.linearApiKey === "string" ? raw.linearApiKey : "",
    linearAutoTransition: typeof raw?.linearAutoTransition === "boolean" ? raw.linearAutoTransition : false,
    linearAutoTransitionStateId: typeof raw?.linearAutoTransitionStateId === "string" ? raw.linearAutoTransitionStateId : "",
    linearAutoTransitionStateName: typeof raw?.linearAutoTransitionStateName === "string" ? raw.linearAutoTransitionStateName : "",
    editorTabEnabled: typeof raw?.editorTabEnabled === "boolean" ? raw.editorTabEnabled : false,
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
  patch: Partial<Pick<CompanionSettings, "openrouterApiKey" | "openrouterModel" | "linearApiKey" | "linearAutoTransition" | "linearAutoTransitionStateId" | "linearAutoTransitionStateName" | "editorTabEnabled">>,
): CompanionSettings {
  ensureLoaded();
  settings = normalize({
    openrouterApiKey: patch.openrouterApiKey ?? settings.openrouterApiKey,
    openrouterModel: patch.openrouterModel ?? settings.openrouterModel,
    linearApiKey: patch.linearApiKey ?? settings.linearApiKey,
    linearAutoTransition: patch.linearAutoTransition ?? settings.linearAutoTransition,
    linearAutoTransitionStateId: patch.linearAutoTransitionStateId ?? settings.linearAutoTransitionStateId,
    linearAutoTransitionStateName: patch.linearAutoTransitionStateName ?? settings.linearAutoTransitionStateName,
    editorTabEnabled: patch.editorTabEnabled ?? settings.editorTabEnabled,
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
