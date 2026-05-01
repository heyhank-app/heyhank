// ─── Skill Discovery ────────────────────────────────────────────────────────
// Lists installed Claude Code skills under ~/.claude/skills/ with their
// metadata (slug, name, description) so HankChat and other layers can route
// requests to a matching skill without spawning a Claude Code session.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface InstalledSkill {
  /** Directory name (and slug Claude Code uses to invoke). */
  slug: string;
  /** Display name from frontmatter (falls back to slug). */
  name: string;
  /** When-to-use description from frontmatter (empty string if missing). */
  description: string;
}

/** Parse the `name:` and `description:` fields from a SKILL.md frontmatter. */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split("\n")) {
    const nameMatch = line.match(/^name:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) out.name = nameMatch[1].trim();
    const descMatch = line.match(/^description:\s*["']?(.+?)["']?\s*$/);
    if (descMatch) out.description = descMatch[1].trim();
  }
  return out;
}

/** Read raw SKILL.md content for a given slug, or null when missing/unreadable. */
export function readSkillContent(slug: string): string | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
  const path = join(homedir(), ".claude", "skills", slug, "SKILL.md");
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Enumerate installed skills with their frontmatter metadata. */
export function listInstalledSkills(): InstalledSkill[] {
  const skillsDir = join(homedir(), ".claude", "skills");
  if (!existsSync(skillsDir)) return [];
  const out: InstalledSkill[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  for (const slug of entries) {
    const content = readSkillContent(slug);
    if (!content) continue;
    const fm = parseFrontmatter(content);
    out.push({
      slug,
      name: fm.name || slug,
      description: fm.description || "",
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}
