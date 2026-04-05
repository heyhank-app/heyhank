// ─── Shared Context System ───────────────────────────────────────────────────
// Cross-agent knowledge sharing via markdown files
// Ported from AgentManager/src/storage.ts (context portion)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const SHARED_CONTEXT_DIR = join(HEYHANK_HOME, "shared-context");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContextFile {
  filename: string;
  content: string;
  updatedAt: string;
  sizeBytes: number;
}

// ─── Functions ───────────────────────────────────────────────────────────────

function ensureDir(): void {
  mkdirSync(SHARED_CONTEXT_DIR, { recursive: true });
}

/** List all shared context files. */
export function listContextFiles(): ContextFile[] {
  ensureDir();
  try {
    const files = readdirSync(SHARED_CONTEXT_DIR).filter((f) =>
      f.endsWith(".md"),
    );
    return files.map((filename) => {
      const filePath = join(SHARED_CONTEXT_DIR, filename);
      const content = readFileSync(filePath, "utf-8");
      const stats = statSync(filePath);
      return {
        filename,
        content,
        updatedAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
      };
    });
  } catch (err) {
    console.error("[shared-context] Failed to list:", err);
    return [];
  }
}

/** Read a specific context file. */
export function getContextFile(filename: string): ContextFile | null {
  ensureDir();
  const filePath = join(SHARED_CONTEXT_DIR, filename);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const stats = statSync(filePath);
    return {
      filename,
      content,
      updatedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
    };
  } catch {
    return null;
  }
}

/** Write or update a context file. */
export function writeContextFile(filename: string, content: string): ContextFile {
  ensureDir();
  if (!filename.endsWith(".md")) {
    filename = filename + ".md";
  }
  // Sanitize filename
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = join(SHARED_CONTEXT_DIR, filename);
  writeFileSync(filePath, content, "utf-8");
  const stats = statSync(filePath);
  return {
    filename,
    content,
    updatedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
  };
}

/** Delete a context file. */
export function deleteContextFile(filename: string): boolean {
  const filePath = join(SHARED_CONTEXT_DIR, filename);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Create default context files if none exist. */
export function ensureDefaultContextFiles(): void {
  ensureDir();
  const files = readdirSync(SHARED_CONTEXT_DIR).filter((f) =>
    f.endsWith(".md"),
  );
  if (files.length > 0) return;

  writeContextFile(
    "platform-info.md",
    `# Agent Platform Info

## Server
- HeyHank Platform
- 8 Cores, 31 GB RAM
- Node 22, Bun, PM2, Nginx, Redis, PostgreSQL

## Agents
- Coding Agent: Full-stack development
- Monitoring Agent: Server health checks
- Marketing Agent: SEO, Ads, Analytics
- Content Agent: Social media, images, video
- Personal Agent: Email, calendar, reminders
- Agent Max 2.0: Autonomous meta-agent

## Key Directories
- Platform: /opt/agentplatform/
- Agent Configs: ~/.heyhank/agents/
- Shared Context: ~/.heyhank/shared-context/
`,
  );

  writeContextFile(
    "active-projects.md",
    `# Active Projects

Track active projects here. Each agent can read and update this file.

## Projects
<!-- Add projects as they come up -->
`,
  );

  console.log("[shared-context] Created default context files");
}

// Initialize on import
ensureDefaultContextFiles();
