// ─── Telephony Store ──────────────────────────────────────────────────────────
// File-based persistence for telephony settings and call history.

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { atomicWriteFileSync } from "../fs-utils.js";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelephonySettings, CallState, TelephonyContact } from "./call-types.js";
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
  atomicWriteFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export function getContacts(): TelephonyContact[] {
  return getSettings().contacts || [];
}

export function addContact(contact: TelephonyContact): void {
  const settings = getSettings();
  if (!settings.contacts) settings.contacts = [];
  settings.contacts.push(contact);
  saveSettings(settings);
}

export function updateContact(id: string, patch: Partial<Omit<TelephonyContact, "id">>): TelephonyContact | null {
  const settings = getSettings();
  if (!settings.contacts) return null;
  const idx = settings.contacts.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  settings.contacts[idx] = { ...settings.contacts[idx], ...patch };
  saveSettings(settings);
  return settings.contacts[idx];
}

export function deleteContact(id: string): boolean {
  const settings = getSettings();
  if (!settings.contacts) return false;
  const before = settings.contacts.length;
  settings.contacts = settings.contacts.filter((c) => c.id !== id);
  if (settings.contacts.length === before) return false;
  saveSettings(settings);
  return true;
}

/** Resolve a contact name (fuzzy) to a phone number */
export function resolveContactByName(nameQuery: string): TelephonyContact | null {
  const contacts = getContacts();
  if (contacts.length === 0) return null;
  const q = nameQuery.toLowerCase().trim();
  // Exact match first
  const exact = contacts.find((c) => c.name.toLowerCase() === q);
  if (exact) return exact;
  // Partial match
  const partial = contacts.find((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
  return partial || null;
}

// ─── Call History ────────────────────────────────────────────────────────────

export function saveCall(call: CallState): void {
  ensureDirs();
  const file = join(CALLS_DIR, `${call.id}.json`);
  atomicWriteFileSync(file, JSON.stringify(call, null, 2));
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
      .filter((f) => f.endsWith(".json"));
    // Parse all calls, sort by startedAt descending (newest first), then apply limit
    const calls = files.map((f) => {
      try {
        return JSON.parse(readFileSync(join(CALLS_DIR, f), "utf-8")) as CallState;
      } catch {
        return null;
      }
    }).filter(Boolean) as CallState[];
    calls.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return calls.slice(0, limit);
  } catch {
    return [];
  }
}
