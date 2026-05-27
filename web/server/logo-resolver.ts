// Brand-logo resolution with placeholder fallback.
//
// When a Reel slide asks for a brand logo (e.g. "openai") the compositor
// looks here first. If `~/.heyhank/reference-images/logos/<slug>.png`
// exists, that path is returned as-is. If it's missing, this module
// generates a placeholder PNG (brand-accent background + brand-name text)
// and writes it to the same path — so the file appears in the References
// UI immediately, and the user can replace it with the real logo via the
// existing upload UI without touching the compositor.
//
// Result reports `isPlaceholder: true` whenever a fallback was rendered;
// the compose route surfaces these in `result.warnings` so the agent /
// user can act on them.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { getTheme } from "./brand-themes.js";

const LOGOS_DIR = join(HEYHANK_HOME, "reference-images", "logos");
const PLACEHOLDER_SIZE = 225; // matches claude.png so visual layout stays consistent
const PLACEHOLDER_FONT = "/usr/share/fonts/truetype/lato/Lato-Bold.ttf";

/**
 * Brand-slug → primary web domain. Used by `fetchLogoFromWeb()` to look up
 * the official brand icon via Google's favicon service. Slugs not in this
 * table go straight to placeholder generation (or callers can extend the
 * map at runtime — kept here for the common AI tooling vocabulary).
 */
const BRAND_DOMAINS: Record<string, string> = {
  claude: "anthropic.com",
  openai: "openai.com",
  chatgpt: "openai.com",
  gemini: "gemini.google.com",
  notion: "notion.so",
  linear: "linear.app",
  cursor: "cursor.com",
  figma: "figma.com",
  perplexity: "perplexity.ai",
  midjourney: "midjourney.com",
  n8n: "n8n.io",
  vercel: "vercel.com",
  copilot: "github.com",
  suno: "suno.com",
  runway: "runwayml.com",
  zapier: "zapier.com",
  airtable: "airtable.com",
  slack: "slack.com",
  github: "github.com",
  google: "google.com",
  anthropic: "anthropic.com",
  microsoft: "microsoft.com",
  meta: "meta.com",
  x: "x.com",
  twitter: "x.com",
  youtube: "youtube.com",
  tiktok: "tiktok.com",
  instagram: "instagram.com",
  linkedin: "linkedin.com",
  facebook: "facebook.com",
};

/**
 * Try to download the brand's official icon from Google's favicon service
 * (no API key required). Returns the raw image bytes on success, null on
 * any failure (network, 404, redirect-loop, non-PNG payload).
 *
 * Quality note: Google s2 caps at sz=128, which is good enough for an 80px
 * overlay in a 9:16 reel — fine pixel-detail isn't visible at that scale.
 */
async function fetchLogoFromWeb(slug: string): Promise<Buffer | null> {
  const domain = BRAND_DOMAINS[slug];
  if (!domain) return null;
  try {
    const res = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
      { redirect: "follow" },
    );
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // s2 returns ~1-2KB for real logos; if we got the 16x16 placeholder
    // (~200B) the brand isn't actually tracked, prefer a real placeholder.
    if (buf.byteLength < 400) return null;
    return buf;
  } catch {
    return null;
  }
}

export interface LogoResolution {
  /** Brand slug as supplied. */
  slug: string;
  /** Absolute path to a PNG file (either real logo or generated placeholder). */
  path: string;
  /** True when the file at `path` was generated as a placeholder. */
  isPlaceholder: boolean;
}

function slugDisplayName(slug: string): string {
  if (slug === "n8n") return "n8n";
  return slug.toUpperCase();
}

/**
 * Render a placeholder PNG using ffmpeg's lavfi + drawtext filters.
 *
 * Output: brand-accent background, brand name in white-or-badge-text colour,
 * 225x225 — same dimensions as the real claude.png we already have so logo
 * placements look identical when the real file lands later.
 */
function renderPlaceholder(slug: string, outputPath: string): Promise<void> {
  const theme = getTheme(slug);
  const display = slugDisplayName(slug);
  // Heuristic: shrink the font so the brand name actually fits 225px wide.
  const fontSize = display.length <= 4 ? 64 : display.length <= 7 ? 48 : 36;
  const color = theme.accent.replace("#", "0x");
  const textColor = theme.badgeText;

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${color}:s=${PLACEHOLDER_SIZE}x${PLACEHOLDER_SIZE}:d=1`,
      "-vf",
      `drawtext=fontfile=${PLACEHOLDER_FONT}:text='${display}':fontsize=${fontSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=(h-text_h)/2`,
      "-frames:v", "1",
      outputPath,
    ];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: string[] = [];
    p.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const tail = stderr.join("").split("\n").slice(-10).join("\n");
        reject(new Error(`ffmpeg placeholder failed (${code}):\n${tail}`));
      }
    });
  });
}

/**
 * Resolve a brand slug to a logo PNG path.
 *
 * Resolution order:
 * 1. File exists at logos/<slug>.png → return as-is.
 * 2. Try to download official icon via Google s2 favicons (BRAND_DOMAINS map).
 *    On success → save + return, isPlaceholder=false.
 * 3. Render a colored placeholder PNG → save + return, isPlaceholder=true.
 *
 * Always returns a path — never null. The placeholder fallback (step 3)
 * ensures the References UI shows the slot so the user can upload a real
 * logo manually whenever Google s2 didn't find one.
 *
 * Slugs are matched verbatim (no alias resolution here — callers using
 * resolveBrandSlug() from brand-themes.ts should pass the canonical slug).
 * Invalid slugs (paths with `/` or `..` or empty) throw immediately to
 * avoid filesystem escapes.
 */
export async function resolveLogo(slug: string): Promise<LogoResolution> {
  if (!slug || /[/\\]|\.\./.test(slug)) {
    throw new Error(`Invalid logo slug: "${slug}"`);
  }
  mkdirSync(LOGOS_DIR, { recursive: true });
  const path = join(LOGOS_DIR, `${slug}.png`);
  if (existsSync(path)) {
    return { slug, path, isPlaceholder: false };
  }
  // Try web fetch first — official logo beats placeholder for visual quality.
  const webBytes = await fetchLogoFromWeb(slug);
  if (webBytes) {
    writeFileSync(path, webBytes);
    return { slug, path, isPlaceholder: false };
  }
  await renderPlaceholder(slug, path);
  return { slug, path, isPlaceholder: true };
}
