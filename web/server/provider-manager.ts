/**
 * Provider config storage — persists user's provider credentials to ~/.heyhank/providers.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getProviderById } from "./provider-registry.js";

export interface ProviderConfig {
  providerId: string;
  enabled: boolean;
  envValues: Record<string, string>;
  customModel?: string;
  createdAt: number;
  updatedAt: number;
}

const DATA_DIR = join(homedir(), ".heyhank");
const PROVIDERS_FILE = join(DATA_DIR, "providers.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): ProviderConfig[] {
  if (!existsSync(PROVIDERS_FILE)) return [];
  try {
    const raw = readFileSync(PROVIDERS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(configs: ProviderConfig[]): void {
  ensureDir();
  writeFileSync(PROVIDERS_FILE, JSON.stringify(configs, null, 2), { mode: 0o600 });
}

export function listProviderConfigs(): ProviderConfig[] {
  return readAll();
}

export function getProviderConfig(providerId: string): ProviderConfig | null {
  return readAll().find((c) => c.providerId === providerId) ?? null;
}

export function upsertProviderConfig(
  providerId: string,
  patch: { enabled?: boolean; envValues?: Record<string, string>; customModel?: string },
): ProviderConfig {
  const def = getProviderById(providerId);
  if (!def) throw new Error(`Unknown provider: ${providerId}`);

  const configs = readAll();
  const idx = configs.findIndex((c) => c.providerId === providerId);
  const now = Date.now();

  if (idx >= 0) {
    const existing = configs[idx];
    configs[idx] = {
      ...existing,
      enabled: patch.enabled ?? existing.enabled,
      envValues: patch.envValues ? { ...existing.envValues, ...patch.envValues } : existing.envValues,
      customModel: patch.customModel !== undefined ? patch.customModel : existing.customModel,
      updatedAt: now,
    };
    writeAll(configs);
    return configs[idx];
  }

  const newConfig: ProviderConfig = {
    providerId,
    enabled: patch.enabled ?? true,
    envValues: patch.envValues ?? {},
    customModel: patch.customModel,
    createdAt: now,
    updatedAt: now,
  };
  configs.push(newConfig);
  writeAll(configs);
  return newConfig;
}

export function deleteProviderConfig(providerId: string): boolean {
  const configs = readAll();
  const filtered = configs.filter((c) => c.providerId !== providerId);
  if (filtered.length === configs.length) return false;
  writeAll(filtered);
  return true;
}

export function getProviderEnvVars(providerId: string): Record<string, string> | null {
  const config = getProviderConfig(providerId);
  if (!config || !config.enabled) return null;

  const def = getProviderById(providerId);
  if (!def) return null;

  const env: Record<string, string> = {};
  for (const field of def.envFields) {
    const val = config.envValues[field.key];
    if (val) env[field.key] = val;
  }
  return Object.keys(env).length > 0 ? env : null;
}

export function getEnabledProviders(): ProviderConfig[] {
  return readAll().filter((c) => c.enabled);
}
