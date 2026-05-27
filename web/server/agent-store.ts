import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HEYHANK_HOME } from "./paths.js";
import { atomicWriteFileSync } from "./fs-utils.js";
import { randomBytes } from "node:crypto";
import type { AgentConfig, AgentConfigCreateInput } from "./agent-types.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const AGENTS_DIR = join(HEYHANK_HOME, "agents");

function ensureDir(): void {
  mkdirSync(AGENTS_DIR, { recursive: true });
}

function filePath(id: string): string {
  return join(AGENTS_DIR, `${id}.json`);
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

function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Strip the legacy `triggers.chat` block from agents loaded from disk.
 * The Chat SDK was removed but agents saved with the old schema may still
 * have chat platform credentials on disk. Stripping on load prevents
 * leaking those secrets via the API.
 */
function stripLegacyChatTrigger(agent: AgentConfig): AgentConfig {
  if (!agent.triggers || !("chat" in agent.triggers)) return agent;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { chat: _chat, ...rest } = agent.triggers as Record<string, unknown>;
  return { ...agent, triggers: rest as AgentConfig["triggers"] };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listAgents(): AgentConfig[] {
  ensureDir();
  try {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".json"));
    const agents: AgentConfig[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(AGENTS_DIR, file), "utf-8");
        agents.push(stripLegacyChatTrigger(JSON.parse(raw)));
      } catch {
        // Skip corrupt files
      }
    }
    agents.sort((a, b) => a.name.localeCompare(b.name));
    return agents;
  } catch {
    return [];
  }
}

export function getAgent(id: string): AgentConfig | null {
  ensureDir();
  try {
    const raw = readFileSync(filePath(id), "utf-8");
    return stripLegacyChatTrigger(JSON.parse(raw) as AgentConfig);
  } catch {
    return null;
  }
}

export function createAgent(data: AgentConfigCreateInput): AgentConfig {
  if (!data.name || !data.name.trim()) throw new Error("Agent name is required");
  if (!data.prompt || !data.prompt.trim()) throw new Error("Agent prompt is required");

  const id = slugify(data.name.trim());
  if (!id) throw new Error("Agent name must contain alphanumeric characters");

  ensureDir();
  if (existsSync(filePath(id))) {
    throw new Error(`An agent with a similar name already exists ("${id}")`);
  }

  // Auto-generate webhook secret if webhook trigger is enabled but has no secret
  const triggers = data.triggers ? { ...data.triggers } : undefined;
  if (triggers?.webhook && !triggers.webhook.secret) {
    triggers.webhook = { ...triggers.webhook, secret: generateWebhookSecret() };
  }

  const now = Date.now();
  const agent: AgentConfig = {
    ...data,
    triggers,
    id,
    name: data.name.trim(),
    prompt: data.prompt.trim(),
    description: data.description?.trim() || "",
    cwd: data.cwd?.trim() || "",
    createdAt: now,
    updatedAt: now,
    totalRuns: 0,
    consecutiveFailures: 0,
  };
  atomicWriteFileSync(filePath(id), JSON.stringify(agent, null, 2));
  return agent;
}

export function updateAgent(
  id: string,
  updates: Partial<AgentConfig>,
): AgentConfig | null {
  ensureDir();
  const existing = getAgent(id);
  if (!existing) return null;

  const newName = updates.name?.trim() || existing.name;
  const newId = slugify(newName);
  if (!newId) throw new Error("Agent name must contain alphanumeric characters");

  // If name changed, check for slug collision with a different agent
  if (newId !== id && existsSync(filePath(newId))) {
    throw new Error(`An agent with a similar name already exists ("${newId}")`);
  }

  const agent: AgentConfig = {
    ...existing,
    ...updates,
    id: newId,
    name: newName,
    updatedAt: Date.now(),
    // Preserve immutable fields
    createdAt: existing.createdAt,
  };

  // If id changed, delete old file
  if (newId !== id) {
    try {
      unlinkSync(filePath(id));
    } catch {
      /* ok */
    }
  }

  atomicWriteFileSync(filePath(newId), JSON.stringify(agent, null, 2));
  return agent;
}

export function deleteAgent(id: string): boolean {
  ensureDir();
  if (!existsSync(filePath(id))) return false;
  try {
    unlinkSync(filePath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed default agents from `web/server/seed-agents/*.json` if they don't yet
 * exist in `~/.heyhank/agents/`. Idempotent — never overwrites a user-edited
 * agent. Called once on server boot.
 */
export function seedDefaultAgents(): number {
  ensureDir();
  const here = dirname(fileURLToPath(import.meta.url));
  const seedDir = join(here, "seed-agents");
  if (!existsSync(seedDir)) return 0;

  let seeded = 0;
  let seedFiles: string[];
  try {
    seedFiles = readdirSync(seedDir).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }

  for (const file of seedFiles) {
    try {
      const raw = readFileSync(join(seedDir, file), "utf-8");
      const parsed = JSON.parse(raw) as AgentConfigCreateInput;
      if (!parsed?.name) continue;
      const id = slugify(parsed.name);
      if (!id) continue;
      if (existsSync(filePath(id))) continue; // user-edited copy wins
      createAgent(parsed);
      seeded += 1;
    } catch (err) {
      console.warn(`[agent-store] Failed to seed agent from ${file}:`, err);
    }
  }
  if (seeded > 0) {
    console.log(`[agent-store] Seeded ${seeded} default agent(s)`);
  }
  return seeded;
}

/** Generate a new webhook secret for an agent */
export function regenerateWebhookSecret(id: string): AgentConfig | null {
  const agent = getAgent(id);
  if (!agent) return null;

  const triggers = agent.triggers || {};
  triggers.webhook = {
    enabled: triggers.webhook?.enabled ?? false,
    secret: generateWebhookSecret(),
  };

  return updateAgent(id, { triggers });
}
