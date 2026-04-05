// ─── Kill Switch (6-Layer Safety) ────────────────────────────────────────────
// Ported from AgentManager/src/kill-switch.ts — simplified for HeyHank

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KillSwitchState {
  killed: boolean;
  reason?: string;
  activatedAt?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const KILL_SWITCH_FILE = join(HEYHANK_HOME, "kill-switch.json");

// ─── State ───────────────────────────────────────────────────────────────────

let state: KillSwitchState = { killed: false };

// ─── Core Functions ──────────────────────────────────────────────────────────

/** Fast in-memory check (hot path). */
export function isKilled(): boolean {
  return state.killed;
}

/** Get full kill switch state. */
export function getKillSwitchState(): KillSwitchState {
  return { ...state };
}

/** Activate the kill switch. */
export function activate(reason?: string): KillSwitchState {
  state = {
    killed: true,
    reason: reason || "Manual activation",
    activatedAt: new Date().toISOString(),
  };

  // Persist to disk
  try {
    mkdirSync(dirname(KILL_SWITCH_FILE), { recursive: true });
    writeFileSync(KILL_SWITCH_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("[kill-switch] Failed to persist:", err);
  }

  console.warn(
    `[kill-switch] ⛔ ACTIVATED: ${state.reason} at ${state.activatedAt}`,
  );
  return { ...state };
}

/** Deactivate the kill switch. */
export function deactivate(): KillSwitchState {
  state = { killed: false };

  // Remove persisted file
  try {
    if (existsSync(KILL_SWITCH_FILE)) {
      unlinkSync(KILL_SWITCH_FILE);
    }
  } catch (err) {
    console.error("[kill-switch] Failed to remove persisted file:", err);
  }

  console.log("[kill-switch] ✅ Deactivated");
  return { ...state };
}

/** Load persisted state on startup. */
export function loadPersistedState(): void {
  try {
    if (!existsSync(KILL_SWITCH_FILE)) return;
    const raw = readFileSync(KILL_SWITCH_FILE, "utf-8");
    const persisted = JSON.parse(raw) as KillSwitchState;
    if (persisted.killed) {
      state = persisted;
      console.warn(
        `[kill-switch] ⛔ Restored KILLED state: ${persisted.reason} (since ${persisted.activatedAt})`,
      );
    }
  } catch (err) {
    console.error("[kill-switch] Failed to load persisted state:", err);
  }
}

// Load on import
loadPersistedState();
