// ─── Style Profiles Storage ──────────────────────────────────────────────────
// File-based CRUD for `StyleProfile`s. Layout:
//   ~/.heyhank/socialview/style-profiles/<platform>-<handle>.json
// Mirrors `library.ts` — flat directory, no DB.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import type { StyleProfile, SocialPlatform } from "./types.js";

const PROFILES_ROOT = join(HEYHANK_HOME, "socialview", "style-profiles");

function ensureDir(): void {
  mkdirSync(PROFILES_ROOT, { recursive: true });
}

/** Filesystem-safe key: <platform>-<handle>. Handle is normalized. */
function profileFilename(platform: SocialPlatform, handle: string): string {
  const safe = handle.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `${platform}-${safe}.json`;
}

function profilePath(platform: SocialPlatform, handle: string): string {
  return join(PROFILES_ROOT, profileFilename(platform, handle));
}

export function saveProfile(profile: StyleProfile): void {
  ensureDir();
  writeFileSync(profilePath(profile.platform, profile.handle), JSON.stringify(profile, null, 2));
}

export function getProfile(platform: SocialPlatform, handle: string): StyleProfile | null {
  const path = profilePath(platform, handle);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StyleProfile;
  } catch {
    return null;
  }
}

export function deleteProfile(platform: SocialPlatform, handle: string): boolean {
  const path = profilePath(platform, handle);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** List all profiles, newest first. */
export function listProfiles(): StyleProfile[] {
  ensureDir();
  const out: StyleProfile[] = [];
  for (const file of readdirSync(PROFILES_ROOT)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(PROFILES_ROOT, file), "utf-8")) as StyleProfile);
    } catch {
      // skip malformed
    }
  }
  out.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  return out;
}
