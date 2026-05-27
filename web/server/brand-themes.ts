/**
 * Brand-themes registry. Values mirror the table in
 * /root/.heyhank/shared-context/logos.md (Slide-Themes section).
 *
 * When the compose route is asked to render slides for a Reel/Story whose
 * topic mentions a known tool, the matching theme drives background,
 * headline, accent, body, and badge colors.
 *
 * Slug aliases ("ChatGPT" -> "openai") are handled by resolveBrandSlug().
 */

export interface BrandTheme {
  /** Canonical slug (e.g. "claude", "openai"). */
  slug: string;
  /** Background fill colour for slide canvas (#RRGGBB). */
  bg: string;
  /** Main headline / title colour. */
  headline: string;
  /** Accent line, brand stroke, link colour. */
  accent: string;
  /** Badge / chip background (often equals accent). */
  badgeBg: string;
  /** Text colour on badge. */
  badgeText: string;
  /** Body / supporting copy colour. */
  body: string;
  /** Human-readable notes (debug-only). */
  notes?: string;
}

export const BRAND_THEMES: Record<string, BrandTheme> = {
  claude: {
    slug: "claude",
    bg: "#1A1A1A",
    headline: "#FFFFFF",
    accent: "#D97757",
    badgeBg: "#D97757",
    badgeText: "#FFFFFF",
    body: "#E5E5E5",
    notes: "Anthropic Claude — dark + warm orange",
  },
  openai: {
    slug: "openai",
    bg: "#0D0D0D",
    headline: "#FFFFFF",
    accent: "#10A37F",
    badgeBg: "#10A37F",
    badgeText: "#FFFFFF",
    body: "#E5E5E5",
    notes: "OpenAI / ChatGPT — dark mode, OpenAI green",
  },
  gemini: {
    slug: "gemini",
    bg: "#0B1623",
    headline: "#FFFFFF",
    accent: "#4285F4",
    badgeBg: "#4285F4",
    badgeText: "#FFFFFF",
    body: "#D1D9E6",
    notes: "Google Gemini — navy + Google blue (gradient simplified to single accent)",
  },
  notion: {
    slug: "notion",
    bg: "#FFFFFF",
    headline: "#000000",
    accent: "#000000",
    badgeBg: "#F7F6F3",
    badgeText: "#000000",
    body: "#37352F",
    notes: "Notion — light, minimal",
  },
  linear: {
    slug: "linear",
    bg: "#08090A",
    headline: "#FFFFFF",
    accent: "#5E6AD2",
    badgeBg: "#5E6AD2",
    badgeText: "#FFFFFF",
    body: "#B4BCD0",
    notes: "Linear — near-black + cool purple",
  },
  cursor: {
    slug: "cursor",
    bg: "#000000",
    headline: "#FFFFFF",
    accent: "#FFFFFF",
    badgeBg: "#1A1A1A",
    badgeText: "#FFFFFF",
    body: "#A0A0A0",
    notes: "Cursor — pure-black editor",
  },
  figma: {
    slug: "figma",
    bg: "#1E1E1E",
    headline: "#FFFFFF",
    accent: "#F24E1E",
    badgeBg: "#F24E1E",
    badgeText: "#FFFFFF",
    body: "#CCCCCC",
    notes: "Figma — multi-color brand, orange dominant",
  },
  perplexity: {
    slug: "perplexity",
    bg: "#091717",
    headline: "#FFFFFF",
    accent: "#20808D",
    badgeBg: "#20808D",
    badgeText: "#FFFFFF",
    body: "#A8C8CB",
    notes: "Perplexity — deep teal",
  },
  midjourney: {
    slug: "midjourney",
    bg: "#1A1226",
    headline: "#F5F0E6",
    accent: "#A78BFA",
    badgeBg: "#000000",
    badgeText: "#F5F0E6",
    body: "#D4C9B6",
    notes: "Midjourney — deep purple-black + cream",
  },
  n8n: {
    slug: "n8n",
    bg: "#1A1A1A",
    headline: "#FFFFFF",
    accent: "#EA4B71",
    badgeBg: "#EA4B71",
    badgeText: "#FFFFFF",
    body: "#E5E5E5",
    notes: "n8n — dark + pink-red",
  },
  vercel: {
    slug: "vercel",
    bg: "#000000",
    headline: "#FFFFFF",
    accent: "#FFFFFF",
    badgeBg: "#FFFFFF",
    badgeText: "#000000",
    body: "#A0A0A0",
    notes: "Vercel — ultra-minimal black + white",
  },
  copilot: {
    slug: "copilot",
    bg: "#0078D4",
    headline: "#FFFFFF",
    accent: "#FFFFFF",
    badgeBg: "#FFFFFF",
    badgeText: "#0078D4",
    body: "#D9E5F0",
    notes: "Microsoft Copilot — corporate blue",
  },
  suno: {
    slug: "suno",
    bg: "#0A0A0A",
    headline: "#FFFFFF",
    accent: "#FF6B35",
    badgeBg: "#FF6B35",
    badgeText: "#FFFFFF",
    body: "#D9D9D9",
    notes: "Suno — black + orange",
  },
  runway: {
    slug: "runway",
    bg: "#000000",
    headline: "#FFFFFF",
    accent: "#FFFFFF",
    badgeBg: "#FFFFFF",
    badgeText: "#000000",
    body: "#B0B0B0",
    notes: "Runway — brutalist black + white",
  },
  neutral: {
    slug: "neutral",
    bg: "#1A1A1A",
    headline: "#FFFFFF",
    accent: "#D97757",
    badgeBg: "#D97757",
    badgeText: "#FFFFFF",
    body: "#E5E5E5",
    notes: "Markus default — falls back when topic has no specific brand",
  },
};

/**
 * Brand-name aliases mapped to canonical theme slugs.
 *
 * Lower-case substring matching: a topic containing any of these tokens picks
 * the corresponding theme. Order in the input list does not matter — the first
 * alias that matches wins.
 */
const ALIASES: Record<string, string> = {
  // claude family
  "claude": "claude",
  "anthropic": "claude",
  "sonnet": "claude",
  "opus": "claude",
  "haiku": "claude",
  // openai family
  "chatgpt": "openai",
  "gpt-4": "openai",
  "gpt-5": "openai",
  "gpt4": "openai",
  "gpt5": "openai",
  "openai": "openai",
  "dall-e": "openai",
  "dalle": "openai",
  // gemini
  "gemini": "gemini",
  "bard": "gemini",
  "google ai": "gemini",
  "google-ai": "gemini",
  // others — single token
  "notion": "notion",
  "linear": "linear",
  "cursor": "cursor",
  "figma": "figma",
  "perplexity": "perplexity",
  "midjourney": "midjourney",
  "mj v": "midjourney",
  "n8n": "n8n",
  "vercel": "vercel",
  "copilot": "copilot",
  "github copilot": "copilot",
  "suno": "suno",
  "runway": "runway",
  "runway ml": "runway",
};

/**
 * Pick the best brand theme for a topic string.
 *
 * Matching is lower-case + substring. Longer aliases win when multiple match
 * (so "github copilot" wins over plain "copilot"). Returns "neutral" if no
 * known brand token appears.
 */
export function resolveBrandSlug(topic: string): string {
  const t = topic.toLowerCase();
  let best = { slug: "neutral", len: 0 };
  for (const [alias, slug] of Object.entries(ALIASES)) {
    if (t.includes(alias) && alias.length > best.len) {
      best = { slug, len: alias.length };
    }
  }
  return best.slug;
}

export function getTheme(slug: string): BrandTheme {
  return BRAND_THEMES[slug] ?? BRAND_THEMES.neutral;
}
