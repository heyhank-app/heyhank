/**
 * Skill marketplace — discovers and installs Claude Code skills from GitHub
 * repositories that follow the .claude-plugin/marketplace.json convention.
 *
 * Skills are installed into ~/.claude/skills/<slug>/ where the existing
 * skills-routes.ts will pick them up automatically. A .heyhank-meta.json file
 * is written alongside SKILL.md to record the source so the UI can offer
 * "Update" / "Source" / "Uninstall" actions later.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface MarketplaceSource {
  /** Stable identifier used in URLs (e.g. "charlie947-social-media-skills"). */
  id: string;
  /** Display name shown in UI. */
  name: string;
  /** Author / org (display only). */
  owner: string;
  /** GitHub URL for the "Source" link in the UI. */
  url: string;
  /** GitHub owner login used to build raw + API URLs. */
  ghOwner: string;
  /** GitHub repo name. */
  ghRepo: string;
  /** Branch — defaults to "main". */
  branch: string;
  /** Description from marketplace.json (loaded lazily). */
  description?: string;
}

export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  /** Source id this skill belongs to. */
  sourceId: string;
}

interface InstalledSkillMeta {
  sourceId: string;
  slug: string;
  ghOwner: string;
  ghRepo: string;
  branch: string;
  installedAt: string;
  /** Commit SHA of the skill folder at install time, if available. */
  ref?: string;
}

const SKILLS_DIR = join(homedir(), ".claude", "skills");
const META_FILE = ".heyhank-meta.json";

/**
 * Built-in marketplaces shipped with HeyHank. Users can install skills from
 * these immediately without configuring anything.
 */
export const BUILTIN_SOURCES: MarketplaceSource[] = [
  {
    id: "charlie947-social-media-skills",
    name: "Charlie Hills' Social Media Skills",
    owner: "Charlie Hills",
    url: "https://github.com/charlie947/social-media-skills",
    ghOwner: "charlie947",
    ghRepo: "social-media-skills",
    branch: "main",
    description:
      "17 skills covering voice, LinkedIn, Instagram Reels, YouTube thumbnails, analytics, and community.",
  },
];

/** Validates a slug to prevent path traversal. */
export function isValidSlug(slug: string): boolean {
  if (!slug || typeof slug !== "string") return false;
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) return false;
  if (slug.startsWith(".")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(slug);
}

/** Lookup a source by id. Returns undefined when unknown. */
export function getSource(id: string): MarketplaceSource | undefined {
  return BUILTIN_SOURCES.find((s) => s.id === id);
}

/** Parse YAML-ish frontmatter at the top of a SKILL.md. */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split("\n")) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) out.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    const descMatch = line.match(/^description:\s*["']?(.+?)["']?\s*$/);
    if (descMatch) out.description = descMatch[1];
  }
  return out;
}

interface GhContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  sha: string;
}

async function ghContents(
  source: MarketplaceSource,
  path: string,
): Promise<GhContentEntry[]> {
  const url = `https://api.github.com/repos/${source.ghOwner}/${source.ghRepo}/contents/${path}?ref=${source.branch}`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}`);
  }
  const json = (await res.json()) as GhContentEntry[] | GhContentEntry;
  return Array.isArray(json) ? json : [json];
}

/** Fetches the skill list (with metadata) for a marketplace source. */
export async function listSkills(source: MarketplaceSource): Promise<MarketplaceSkill[]> {
  const dirs = (await ghContents(source, "skills")).filter((e) => e.type === "dir");
  const skills: MarketplaceSkill[] = [];
  // Fetch SKILL.md frontmatter for each — keep concurrency modest to be polite.
  const concurrency = 4;
  for (let i = 0; i < dirs.length; i += concurrency) {
    const chunk = dirs.slice(i, i + concurrency);
    const batch = await Promise.all(
      chunk.map(async (d) => {
        const rawUrl = `https://raw.githubusercontent.com/${source.ghOwner}/${source.ghRepo}/${source.branch}/skills/${d.name}/SKILL.md`;
        try {
          const r = await fetch(rawUrl);
          if (!r.ok) return null;
          const text = await r.text();
          const fm = parseFrontmatter(text);
          return {
            slug: d.name,
            name: fm.name ?? d.name,
            description: fm.description ?? "",
            sourceId: source.id,
          } satisfies MarketplaceSkill;
        } catch {
          return null;
        }
      }),
    );
    for (const s of batch) if (s) skills.push(s);
  }
  return skills;
}

/**
 * Recursively downloads a skill folder from GitHub into a target directory.
 * Stays inside `targetRoot` to prevent traversal via crafted filenames.
 */
async function downloadDir(
  source: MarketplaceSource,
  remotePath: string,
  targetRoot: string,
  targetDir: string,
): Promise<void> {
  const safeTarget = resolve(targetDir);
  if (!safeTarget.startsWith(resolve(targetRoot))) {
    throw new Error("Refusing to write outside skill target directory");
  }
  const entries = await ghContents(source, remotePath);
  await mkdir(safeTarget, { recursive: true });
  for (const entry of entries) {
    if (!isValidSlug(entry.name)) {
      throw new Error(`Refusing unsafe filename: ${entry.name}`);
    }
    const childTarget = join(safeTarget, entry.name);
    if (entry.type === "dir") {
      await downloadDir(source, entry.path, targetRoot, childTarget);
    } else if (entry.type === "file" && entry.download_url) {
      const r = await fetch(entry.download_url);
      if (!r.ok) {
        throw new Error(`Download failed (${r.status}): ${entry.download_url}`);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(childTarget, buf);
    }
  }
}

/**
 * Installs a skill into ~/.claude/skills/<slug>/. Atomic: writes to a temp
 * sibling directory first, then renames. Throws on conflict unless `overwrite`.
 */
export async function installSkill(
  source: MarketplaceSource,
  slug: string,
  options: { overwrite?: boolean } = {},
): Promise<{ slug: string; path: string }> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const finalDir = join(SKILLS_DIR, slug);
  if (existsSync(finalDir) && !options.overwrite) {
    throw new Error(`Skill "${slug}" already installed`);
  }
  await mkdir(SKILLS_DIR, { recursive: true });
  const stagingDir = join(SKILLS_DIR, `.${slug}.installing-${Date.now()}`);
  try {
    await downloadDir(source, `skills/${slug}`, stagingDir, stagingDir);
    if (!existsSync(join(stagingDir, "SKILL.md"))) {
      throw new Error(`Source skill missing SKILL.md`);
    }
    const meta: InstalledSkillMeta = {
      sourceId: source.id,
      slug,
      ghOwner: source.ghOwner,
      ghRepo: source.ghRepo,
      branch: source.branch,
      installedAt: new Date().toISOString(),
    };
    await writeFile(join(stagingDir, META_FILE), JSON.stringify(meta, null, 2), "utf-8");
    if (existsSync(finalDir)) {
      await rm(finalDir, { recursive: true, force: true });
    }
    // Cross-platform rename: use Bun.file/native move via fs/promises.rename.
    const { rename } = await import("node:fs/promises");
    await rename(stagingDir, finalDir);
    return { slug, path: finalDir };
  } catch (err) {
    // Best-effort rollback of half-installed staging dir
    if (existsSync(stagingDir)) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

/** Reads installed-skill metadata if present. */
export async function readInstalledMeta(slug: string): Promise<InstalledSkillMeta | null> {
  if (!isValidSlug(slug)) return null;
  const p = join(SKILLS_DIR, slug, META_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf-8")) as InstalledSkillMeta;
  } catch {
    return null;
  }
}
