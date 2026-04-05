import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HeyHankEnv {
  name: string;
  slug: string;
  variables: Record<string, string>;

  createdAt: number;
  updatedAt: number;
}

/** Fields that can be updated via the update API */
export interface EnvUpdateFields {
  name?: string;
  variables?: Record<string, string>;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const ENVS_DIR = join(HEYHANK_HOME, "envs");

function ensureDir(): void {
  mkdirSync(ENVS_DIR, { recursive: true });
}

/** Validate that a slug contains only safe characters (prevents path traversal) */
function validateSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Invalid slug: must contain only lowercase alphanumeric characters and hyphens");
  }
}

function filePath(slug: string): string {
  validateSlug(slug);
  return join(ENVS_DIR, `${slug}.json`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listEnvs(): HeyHankEnv[] {
  ensureDir();
  try {
    const files = readdirSync(ENVS_DIR).filter((f) => f.endsWith(".json"));
    const envs: HeyHankEnv[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(ENVS_DIR, file), "utf-8");
        envs.push(JSON.parse(raw));
      } catch {
        // Skip corrupt files
      }
    }
    envs.sort((a, b) => a.name.localeCompare(b.name));
    return envs;
  } catch {
    return [];
  }
}

export function getEnv(slug: string): HeyHankEnv | null {
  ensureDir();
  try {
    const raw = readFileSync(filePath(slug), "utf-8");
    return JSON.parse(raw) as HeyHankEnv;
  } catch {
    return null;
  }
}

export function createEnv(
  name: string,
  variables: Record<string, string> = {},
): HeyHankEnv {
  if (!name || !name.trim()) throw new Error("Environment name is required");
  const slug = slugify(name.trim());
  if (!slug) throw new Error("Environment name must contain alphanumeric characters");

  ensureDir();
  if (existsSync(filePath(slug))) {
    throw new Error(`An environment with a similar name already exists ("${slug}")`);
  }

  const now = Date.now();
  const env: HeyHankEnv = {
    name: name.trim(),
    slug,
    variables,
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(filePath(slug), JSON.stringify(env, null, 2), "utf-8");
  return env;
}

export function updateEnv(
  slug: string,
  updates: EnvUpdateFields,
): HeyHankEnv | null {
  ensureDir();
  const existing = getEnv(slug);
  if (!existing) return null;

  const newName = updates.name?.trim() || existing.name;
  const newSlug = slugify(newName);
  if (!newSlug) throw new Error("Environment name must contain alphanumeric characters");

  // If name changed, check for slug collision with a different env
  if (newSlug !== slug && existsSync(filePath(newSlug))) {
    throw new Error(`An environment with a similar name already exists ("${newSlug}")`);
  }

  const env: HeyHankEnv = {
    ...existing,
    name: newName,
    slug: newSlug,
    variables: updates.variables ?? existing.variables,
    updatedAt: Date.now(),
  };

  // If slug changed, delete old file
  if (newSlug !== slug) {
    try { unlinkSync(filePath(slug)); } catch { /* ok */ }
  }

  writeFileSync(filePath(newSlug), JSON.stringify(env, null, 2), "utf-8");
  return env;
}

export function deleteEnv(slug: string): boolean {
  ensureDir();
  if (!existsSync(filePath(slug))) return false;
  try {
    unlinkSync(filePath(slug));
    return true;
  } catch {
    return false;
  }
}
