import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { AgentConfig, AgentConfigCreateInput, ChatPlatformBinding } from "./agent-types.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const COMPANION_DIR = join(homedir(), ".companion");
const AGENTS_DIR = join(COMPANION_DIR, "agents");

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

// ─── Chat Credential Helpers ────────────────────────────────────────────────

/** Fields in chat platform credentials that are considered secrets */
const CHAT_SECRET_FIELDS = new Set([
  "apiKey", "token", "clientSecret", "privateKey", "accessToken", "webhookSecret",
]);

/** Mask a secret string: show first 4 chars + "****", or just "****" if short */
function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return value.substring(0, 4) + "****";
}

/**
 * Auto-generate webhookSecret for any chat platform binding that has credentials
 * but is missing a webhookSecret.
 */
function ensureChatWebhookSecrets(
  platforms: ChatPlatformBinding[] | undefined,
): ChatPlatformBinding[] | undefined {
  if (!platforms) return platforms;
  return platforms.map((p) => {
    if (p.credentials && !("webhookSecret" in p.credentials && p.credentials.webhookSecret)) {
      return {
        ...p,
        credentials: { ...p.credentials, webhookSecret: generateWebhookSecret() },
      };
    }
    return p;
  });
}

/**
 * Return a copy of the agent with secret credential fields masked.
 * Safe for API responses — prevents leaking raw secrets to the frontend.
 */
export function sanitizeAgentForResponse(agent: AgentConfig): AgentConfig {
  if (!agent.triggers?.chat?.platforms?.length) return agent;

  const sanitizedPlatforms = agent.triggers.chat.platforms.map((p) => {
    if (!p.credentials) return p;
    const sanitized: Record<string, unknown> = { ...p.credentials };
    for (const key of CHAT_SECRET_FIELDS) {
      if (key in sanitized && typeof sanitized[key] === "string" && sanitized[key]) {
        sanitized[key] = maskSecret(sanitized[key] as string);
      }
    }
    return { ...p, credentials: sanitized as typeof p.credentials };
  });

  return {
    ...agent,
    triggers: {
      ...agent.triggers,
      chat: {
        ...agent.triggers.chat,
        platforms: sanitizedPlatforms,
      },
    },
  };
}

/**
 * Return a copy of the agent with credentials stripped entirely from chat platform bindings.
 * Used for agent exports — exports should never contain secrets.
 */
export function stripChatCredentials(agent: AgentConfig): AgentConfig {
  if (!agent.triggers?.chat?.platforms?.length) return agent;

  const strippedPlatforms = agent.triggers.chat.platforms.map(({ credentials, ...rest }) => rest);

  return {
    ...agent,
    triggers: {
      ...agent.triggers,
      chat: {
        ...agent.triggers.chat,
        platforms: strippedPlatforms,
      },
    },
  };
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
        agents.push(JSON.parse(raw));
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
    return JSON.parse(raw) as AgentConfig;
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

  // Auto-generate webhookSecret for chat platform bindings with credentials
  if (triggers?.chat?.platforms) {
    triggers.chat = {
      ...triggers.chat,
      platforms: ensureChatWebhookSecrets(triggers.chat.platforms) || [],
    };
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
  writeFileSync(filePath(id), JSON.stringify(agent, null, 2), "utf-8");
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

  // Auto-generate webhookSecret for new/updated chat platform bindings with credentials
  const mergedUpdates = { ...updates };
  if (mergedUpdates.triggers?.chat?.platforms) {
    // Deep-merge incoming credentials with existing ones so that masked/omitted
    // fields from the frontend don't overwrite stored secrets on the server.
    if (existing.triggers?.chat?.platforms) {
      mergedUpdates.triggers!.chat!.platforms = mergedUpdates.triggers.chat.platforms.map((platform) => {
        const existingPlatform = existing.triggers?.chat?.platforms?.find(
          (ep) => ep.adapter === platform.adapter,
        );
        if (!existingPlatform?.credentials || !platform.credentials) return platform;
        return {
          ...platform,
          credentials: { ...existingPlatform.credentials, ...platform.credentials },
        };
      });
    }
    mergedUpdates.triggers = {
      ...mergedUpdates.triggers,
      chat: {
        ...mergedUpdates.triggers.chat,
        platforms: ensureChatWebhookSecrets(mergedUpdates.triggers.chat.platforms) || [],
      },
    };
  }

  const agent: AgentConfig = {
    ...existing,
    ...mergedUpdates,
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

  writeFileSync(filePath(newId), JSON.stringify(agent, null, 2), "utf-8");
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
