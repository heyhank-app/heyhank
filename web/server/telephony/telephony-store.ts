// ─── Telephony Store ──────────────────────────────────────────────────────────
// File-based persistence for telephony settings and call history.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelephonySettings, CallState } from "./call-types.js";
import { DEFAULT_TELEPHONY_SETTINGS } from "./call-types.js";

const BASE_DIR = join(homedir(), ".heyhank", "telephony");
const SETTINGS_FILE = join(BASE_DIR, "settings.json");
const CALLS_DIR = join(BASE_DIR, "calls");

function ensureDirs(): void {
  if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true });
  if (!existsSync(CALLS_DIR)) mkdirSync(CALLS_DIR, { recursive: true });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getSettings(): TelephonySettings {
  ensureDirs();
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_TELEPHONY_SETTINGS };
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_TELEPHONY_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TELEPHONY_SETTINGS };
  }
}

export function saveSettings(settings: TelephonySettings): void {
  ensureDirs();
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

// ─── Call History ────────────────────────────────────────────────────────────

export function saveCall(call: CallState): void {
  ensureDirs();
  const file = join(CALLS_DIR, `${call.id}.json`);
  writeFileSync(file, JSON.stringify(call, null, 2), "utf-8");
}

export function getCall(callId: string): CallState | null {
  const file = join(CALLS_DIR, `${callId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function listCalls(limit = 50): CallState[] {
  ensureDirs();
  try {
    const files = readdirSync(CALLS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);
    return files.map((f) => {
      try {
        return JSON.parse(readFileSync(join(CALLS_DIR, f), "utf-8")) as CallState;
      } catch {
        return null;
      }
    }).filter(Boolean) as CallState[];
  } catch {
    return [];
  }
}
