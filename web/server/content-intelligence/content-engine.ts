// ─── Content Engine / Ad Creator ────────────────────────────────────────────
// Comprehensive social media content generation system.
// Analyzes websites, creates content strategies, and generates
// platform-optimized content and ad creatives.

import { randomUUID } from "node:crypto";
import { callInternalAI } from "../internal-ai.js";
import { selectForFewShot, getPost as getLibraryPost } from "../socialview/library.js";
import { getProfile as getStyleProfile } from "../socialview/style-profiles.js";
import type { SocialPlatform, StyleProfile } from "../socialview/types.js";
import { SOCIAL_PLATFORMS } from "../socialview/types.js";
import {
  getPlatform,
  buildPlatformSummary,
  ALL_PLATFORMS,
  type PlatformSpec,
} from "./platform-knowledge.js";
import { listHashtagPools } from "../socialmedia/store.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebsiteIntelligence {
  url: string;
  businessType: "ecommerce" | "service" | "saas" | "blog" | "portfolio" | "agency" | "other";
  industry: string;
  companyName: string;
  language: string;
  products: Array<{ name: string; description: string; price?: string; imageUrl?: string }>;
  services: Array<{ name: string; description: string }>;
  usp: string[];
  targetAudience: string;
  tone: string;
  colors: string[];
  fonts: string[];
  logo?: { url: string; alt?: string };
  heroImages: Array<{ url: string; alt?: string }>;
  productImages: Array<{ url: string; alt?: string }>;
  headlines: string[];
  ctas: string[];
  testimonials: string[];
  title: string;
  description: string;
  ogImage?: string;
  crawledPages: string[];
  analyzedAt: string;
}

export interface ContentPillar {
  name: string;
  description: string;
  painPoints: string[];
  contentIdeas: string[];
}

export interface ContentSchedule {
  platform: string;
  postsPerWeek: number;
  bestDays: string[];
  bestHours: string;
  formats: string[];
}

export interface ContentStrategy {
  businessType: string;
  pillars: ContentPillar[];
  schedules: ContentSchedule[];
  tone: string;
  ctas: string[];
  journeyMapping: {
    attract: string[];
    convert: string[];
    close: string[];
  };
}

export type JourneyStage = "attract" | "convert" | "close";
export type CopyFramework = "PAS" | "AIDA" | "BAB" | "StoryBrand";

export interface ContentPiece {
  id: string;
  platform: string;
  type: "social-post" | "blog" | "newsletter" | "ad";
  journeyStage: JourneyStage;
  framework: CopyFramework;
  pillar: string;
  targetPain: string;
  hook: string;
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
  imagePrompt?: string;
  imageUrl?: string;
  scheduledFor?: string;
  status: "draft" | "review" | "approved" | "published";
  /** When set, this piece was remixed from a library post — store the source for attribution + audit. */
  remix?: {
    sourcePostId: string;
    sourcePlatform: string;
    sourceAuthor: string;
    sourceUrl: string;
    /** The "business angle" the user supplied at remix time (free-text). */
    businessAngle?: string;
  };
}

export interface AdCreative {
  id: string;
  platform: string;
  format: string;
  aspectRatio: string;
  resolution: string;
  headline: string;
  body: string;
  cta: string;
  imagePrompt: string;
  brandColors: string[];
  tone: string;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const analysisCache = new Map<string, { data: WebsiteIntelligence; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(url: string): WebsiteIntelligence | null {
  const entry = analysisCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    analysisCache.delete(url);
    return null;
  }
  return entry.data;
}

function setCache(url: string, data: WebsiteIntelligence): void {
  analysisCache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── HTML Parsing Helpers ───────────────────────────────────────────────────

function extractMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const metaRegex = /<meta\s+[^>]*?(?:name|property|http-equiv)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*?)["'][^>]*?\/?>/gi;
  const metaRegex2 = /<meta\s+[^>]*?content\s*=\s*["']([^"']*?)["'][^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    tags[match[1].toLowerCase()] = match[2];
  }
  while ((match = metaRegex2.exec(html)) !== null) {
    tags[match[2].toLowerCase()] = match[1];
  }
  // Title tag
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) tags["title"] = titleMatch[1].trim();
  return tags;
}

function extractImages(html: string, baseUrl: string): Array<{ src: string; alt?: string; width?: number; height?: number }> {
  const images: Array<{ src: string; alt?: string; width?: number; height?: number }> = [];
  const imgRegex = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const src = resolveUrl(match[1], baseUrl);
    if (!src) continue;
    const altMatch = tag.match(/alt\s*=\s*["']([^"']*?)["']/i);
    const widthMatch = tag.match(/width\s*=\s*["']?(\d+)/i);
    const heightMatch = tag.match(/height\s*=\s*["']?(\d+)/i);
    images.push({
      src,
      alt: altMatch?.[1] || undefined,
      width: widthMatch ? parseInt(widthMatch[1], 10) : undefined,
      height: heightMatch ? parseInt(heightMatch[1], 10) : undefined,
    });
  }
  return images;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a\s+[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*?>/gi;
  let match: RegExpExecArray | null;
  const baseHostname = getHostname(baseUrl);
  while ((match = linkRegex.exec(html)) !== null) {
    const href = resolveUrl(match[1], baseUrl);
    if (!href) continue;
    const hrefHostname = getHostname(href);
    if (hrefHostname === baseHostname) {
      links.push(href);
    }
  }
  return [...new Set(links)];
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text) headings.push(text);
  }
  return headings;
}

function extractParagraphs(html: string): string[] {
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text && text.length > 20) paragraphs.push(text);
  }
  return paragraphs;
}

function extractCssColors(html: string): string[] {
  const colors: string[] = [];
  const colorRegex = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  const rgbRegex = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = colorRegex.exec(html)) !== null) {
    colors.push(match[0]);
  }
  while ((match = rgbRegex.exec(html)) !== null) {
    colors.push(match[0]);
  }
  // Deduplicate and take top 10
  return [...new Set(colors)].slice(0, 10);
}

function extractLogoUrl(html: string, images: Array<{ src: string; alt?: string }>): { url: string; alt?: string } | undefined {
  // Look for images with "logo" in src, alt, or class
  const logoRegex = /<img\s+[^>]*?(?:src|alt|class)\s*=\s*["'][^"']*logo[^"']*["'][^>]*?>/gi;
  let match: RegExpExecArray | null;
  while ((match = logoRegex.exec(html)) !== null) {
    const srcMatch = match[0].match(/src\s*=\s*["']([^"']+)["']/i);
    const altMatch = match[0].match(/alt\s*=\s*["']([^"']*?)["']/i);
    if (srcMatch) {
      return { url: srcMatch[1], alt: altMatch?.[1] };
    }
  }
  // Fallback: look in images array
  for (const img of images) {
    if (img.src.toLowerCase().includes("logo") || img.alt?.toLowerCase().includes("logo")) {
      return { url: img.src, alt: img.alt };
    }
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ─── Website Fetching ───────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "HeyHank-ContentEngine/1.0 (https://heyhank.com)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

// ─── Priority pages to crawl ────────────────────────────────────────────────

const PRIORITY_PATHS = ["/about", "/services", "/products", "/pricing", "/contact", "/about-us", "/our-services", "/ueber-uns", "/leistungen", "/produkte", "/kontakt"];

function prioritizeLinks(links: string[], baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, "");
  const prioritized: string[] = [];
  const rest: string[] = [];

  for (const link of links) {
    if (link === baseUrl || link === base || link === base + "/") continue;
    const path = new URL(link).pathname.toLowerCase();
    if (PRIORITY_PATHS.some((p) => path === p || path === p + "/")) {
      prioritized.push(link);
    } else {
      rest.push(link);
    }
  }

  return [...prioritized, ...rest].slice(0, 5);
}

// ─── LLM Analysis ──────────────────────────────────────────────────────────

async function analyzeWithLLM(collectedData: {
  url: string;
  meta: Record<string, string>;
  headings: string[];
  paragraphs: string[];
  images: Array<{ src: string; alt?: string }>;
  colors: string[];
}): Promise<Partial<WebsiteIntelligence>> {
  const prompt = `Analyze this website data and extract business intelligence. Return ONLY valid JSON.

URL: ${collectedData.url}

META TAGS:
${Object.entries(collectedData.meta).map(([k, v]) => `${k}: ${v}`).join("\n")}

HEADINGS:
${collectedData.headings.slice(0, 30).join("\n")}

CONTENT (first paragraphs):
${collectedData.paragraphs.slice(0, 20).join("\n\n")}

IMAGES (${collectedData.images.length} total):
${collectedData.images.slice(0, 15).map((i) => `${i.src} (alt: ${i.alt || "none"})`).join("\n")}

COLORS FOUND: ${collectedData.colors.join(", ")}

Respond with this exact JSON structure (no markdown, no explanation):
{
  "businessType": "ecommerce|service|saas|blog|portfolio|agency|other",
  "industry": "specific industry name",
  "companyName": "company name",
  "language": "detected language code (e.g. en, de, fr)",
  "products": [{"name": "...", "description": "...", "price": "..."}],
  "services": [{"name": "...", "description": "..."}],
  "usp": ["unique selling point 1", "..."],
  "targetAudience": "description of target audience",
  "tone": "brand tone of voice (e.g. professional, friendly, casual, authoritative)",
  "testimonials": ["testimonial quote 1", "..."],
  "ctas": ["call to action text found on site"]
}`;

  const result = await callInternalAI({
    systemPrompt: "You are a business intelligence analyst. Extract structured data from websites. Return ONLY valid JSON, no markdown fences, no explanation.",
    userPrompt: prompt,
    maxTokens: 2048,
    temperature: 0.3,
    timeoutMs: 30_000,
  });

  if (!result.ok || !result.text) {
    console.error("[content-engine] LLM analysis failed:", result.error);
    return {};
  }

  try {
    // Try to extract JSON from the response (handle markdown fences)
    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    return JSON.parse(jsonText) as Partial<WebsiteIntelligence>;
  } catch (e) {
    console.error("[content-engine] Failed to parse LLM response:", e);
    return {};
  }
}

// ─── Main Functions ─────────────────────────────────────────────────────────

/**
 * Analyze a website to extract brand identity, business type, products/services,
 * colors, images, and tone of voice.
 */
export async function analyzeWebsite(url: string): Promise<WebsiteIntelligence> {
  // Check cache first
  const cached = getCached(url);
  if (cached) return cached;

  console.log(`[content-engine] Analyzing website: ${url}`);

  // Normalize URL
  if (!url.startsWith("http")) url = "https://" + url;

  // 1. Fetch main page
  const mainHtml = await fetchPage(url);
  if (!mainHtml) {
    throw new Error(`Could not fetch website: ${url}`);
  }

  // 2. Extract data from main page
  const meta = extractMetaTags(mainHtml);
  const allImages = extractImages(mainHtml, url);
  const links = extractLinks(mainHtml, url);
  const headings = extractHeadings(mainHtml);
  const paragraphs = extractParagraphs(mainHtml);
  const colors = extractCssColors(mainHtml);
  const logo = extractLogoUrl(mainHtml, allImages);

  // 3. Crawl additional pages
  const additionalPages = prioritizeLinks(links, url);
  const crawledPages = [url];
  const additionalHeadings: string[] = [];
  const additionalParagraphs: string[] = [];
  const additionalImages: typeof allImages = [];

  for (const pageUrl of additionalPages) {
    const pageHtml = await fetchPage(pageUrl);
    if (!pageHtml) continue;
    crawledPages.push(pageUrl);
    additionalHeadings.push(...extractHeadings(pageHtml));
    additionalParagraphs.push(...extractParagraphs(pageHtml));
    additionalImages.push(...extractImages(pageHtml, pageUrl));
  }

  const combinedHeadings = [...headings, ...additionalHeadings];
  const combinedParagraphs = [...paragraphs, ...additionalParagraphs];
  const combinedImages = [...allImages, ...additionalImages];

  // 4. Filter images (skip tiny icons <100px)
  const significantImages = combinedImages.filter((img) => {
    if (img.width && img.width < 100) return false;
    if (img.height && img.height < 100) return false;
    const src = img.src.toLowerCase();
    if (src.includes("favicon") || src.includes("icon") || src.endsWith(".ico")) return false;
    if (src.includes("pixel") || src.includes("tracking") || src.includes("analytics")) return false;
    return true;
  });

  // 5. Send to LLM for analysis
  const llmAnalysis = await analyzeWithLLM({
    url,
    meta,
    headings: combinedHeadings,
    paragraphs: combinedParagraphs,
    images: significantImages.slice(0, 20),
    colors,
  });

  // 6. Build the intelligence object
  const intelligence: WebsiteIntelligence = {
    url,
    businessType: llmAnalysis.businessType || "other",
    industry: llmAnalysis.industry || "Unknown",
    companyName: llmAnalysis.companyName || meta["og:site_name"] || meta["title"] || "Unknown",
    language: llmAnalysis.language || "en",
    products: llmAnalysis.products || [],
    services: llmAnalysis.services || [],
    usp: llmAnalysis.usp || [],
    targetAudience: llmAnalysis.targetAudience || "General audience",
    tone: llmAnalysis.tone || "professional",
    colors,
    fonts: [], // Would need CSS parsing for fonts
    logo: logo ? { url: resolveUrl(logo.url, url) || logo.url, alt: logo.alt } : undefined,
    heroImages: significantImages.slice(0, 5).map((i) => ({ url: i.src, alt: i.alt })),
    productImages: significantImages
      .filter((i) => i.alt?.toLowerCase().includes("product") || i.src.toLowerCase().includes("product"))
      .slice(0, 10)
      .map((i) => ({ url: i.src, alt: i.alt })),
    headlines: combinedHeadings.slice(0, 20),
    ctas: llmAnalysis.ctas || [],
    testimonials: llmAnalysis.testimonials || [],
    title: meta["title"] || meta["og:title"] || "",
    description: meta["description"] || meta["og:description"] || "",
    ogImage: meta["og:image"] || undefined,
    crawledPages,
    analyzedAt: new Date().toISOString(),
  };

  // Cache it
  setCache(url, intelligence);

  return intelligence;
}

// ─── Content Strategy ───────────────────────────────────────────────────────

const PILLAR_TEMPLATES: Record<string, ContentPillar[]> = {
  ecommerce: [
    {
      name: "Product Highlights",
      description: "Showcase products, features, and benefits",
      painPoints: ["Can't find quality products", "Unsure about product quality", "Too many choices"],
      contentIdeas: ["Product spotlights", "Feature breakdowns", "Use cases", "Comparison posts"],
    },
    {
      name: "Customer Stories",
      description: "Social proof through customer experiences",
      painPoints: ["Need validation before buying", "Want real reviews", "Risk of bad purchase"],
      contentIdeas: ["Customer testimonials", "Before/after transformations", "User-generated content", "Review roundups"],
    },
    {
      name: "Behind the Scenes",
      description: "Build trust through transparency",
      painPoints: ["Don't trust online brands", "Want to know who makes products"],
      contentIdeas: ["Team introductions", "Production process", "Packaging and shipping", "Company values"],
    },
    {
      name: "Industry Tips",
      description: "Position as helpful expert",
      painPoints: ["Need guidance on product use", "Want to maximize value"],
      contentIdeas: ["How-to guides", "Tips and tricks", "Seasonal guides", "Expert advice"],
    },
  ],
  service: [
    {
      name: "Expertise & Tips",
      description: "Demonstrate authority and provide value",
      painPoints: ["Don't know where to start", "Need expert guidance", "Information overload"],
      contentIdeas: ["Quick tips", "Common mistakes", "Step-by-step guides", "FAQ answers"],
    },
    {
      name: "Case Studies",
      description: "Prove results with real examples",
      painPoints: ["Skeptical about results", "Need proof it works"],
      contentIdeas: ["Client success stories", "Before/after results", "Process breakdowns", "ROI showcases"],
    },
    {
      name: "Behind the Scenes",
      description: "Humanize the brand",
      painPoints: ["Want to know who they're working with", "Need personal connection"],
      contentIdeas: ["Day in the life", "Team spotlights", "Office/workspace tours", "Company culture"],
    },
    {
      name: "Industry Insights",
      description: "Position as thought leader",
      painPoints: ["Need to stay current", "Want informed decisions"],
      contentIdeas: ["Trend analysis", "Industry news commentary", "Data-driven insights", "Predictions"],
    },
  ],
  saas: [
    {
      name: "Feature Highlights",
      description: "Showcase product capabilities",
      painPoints: ["Current tools are inefficient", "Need better solutions", "Too complex"],
      contentIdeas: ["Feature demos", "Tips and shortcuts", "New feature announcements", "Integration showcases"],
    },
    {
      name: "Tutorials",
      description: "Help users get maximum value",
      painPoints: ["Hard to learn new tools", "Underusing the product"],
      contentIdeas: ["Step-by-step tutorials", "Use case walkthroughs", "Power user tips", "Template showcases"],
    },
    {
      name: "Industry Trends",
      description: "Position as forward-thinking leader",
      painPoints: ["Falling behind competitors", "Need to stay current"],
      contentIdeas: ["Market analysis", "Technology trends", "Future predictions", "Data reports"],
    },
    {
      name: "Customer Success",
      description: "Social proof and inspiration",
      painPoints: ["Unsure if the tool will work for them", "Need validation"],
      contentIdeas: ["Success stories", "User interviews", "ROI case studies", "Community highlights"],
    },
  ],
};

/**
 * Create a content strategy based on business analysis and target platforms.
 */
export function createContentStrategy(
  intelligence: WebsiteIntelligence,
  platforms: string[],
): ContentStrategy {
  // 1. Get pillar templates based on business type
  const pillars = PILLAR_TEMPLATES[intelligence.businessType] || PILLAR_TEMPLATES["service"]!;

  // 2. Create posting schedules per platform
  const schedules: ContentSchedule[] = [];
  for (const platformKey of platforms) {
    const spec = getPlatform(platformKey);
    if (!spec) continue;
    schedules.push({
      platform: spec.key,
      postsPerWeek: parsePostsPerWeek(spec.frequency.recommended),
      bestDays: spec.bestTimes.bestDays,
      bestHours: spec.bestTimes.bestHours,
      formats: spec.formats.slice(0, 3).map((f) => f.name),
    });
  }

  // 3. Define journey mapping
  const journeyMapping = {
    attract: [
      "Educational content addressing pain points",
      "Industry insights and trends",
      "Entertaining/engaging content",
      "Shareable infographics and tips",
    ],
    convert: [
      "Case studies and success stories",
      "Product/service comparisons",
      "Free resources (guides, templates)",
      "Webinars and live demos",
    ],
    close: [
      "Testimonials and social proof",
      "Limited-time offers",
      "Free trials and demos",
      "Direct CTAs with clear value proposition",
    ],
  };

  // 4. Generate CTAs based on business type
  const ctas = intelligence.ctas.length > 0
    ? intelligence.ctas
    : generateDefaultCTAs(intelligence.businessType);

  return {
    businessType: intelligence.businessType,
    pillars,
    schedules,
    tone: intelligence.tone,
    ctas,
    journeyMapping,
  };
}

function parsePostsPerWeek(recommended: string): number {
  const match = recommended.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return 3;
  const low = parseInt(match[1], 10);
  const high = match[2] ? parseInt(match[2], 10) : low;
  return Math.round((low + high) / 2);
}

function generateDefaultCTAs(businessType: string): string[] {
  switch (businessType) {
    case "ecommerce":
      return ["Shop Now", "Get Yours Today", "Limited Stock", "Free Shipping"];
    case "service":
      return ["Book a Consultation", "Get Started", "Contact Us", "Learn More"];
    case "saas":
      return ["Start Free Trial", "See Demo", "Sign Up Free", "Try It Now"];
    default:
      return ["Learn More", "Get Started", "Contact Us"];
  }
}

// ─── Hashtag Pool Integration ───────────────────────────────────────────────

/**
 * Build hashtag context from saved pools for the LLM prompt.
 * Matches by industry/language if possible, otherwise uses all pools.
 */
/**
 * Build a few-shot reference block from the SocialView library for the given
 * platform. Only gold-marked posts (highest-engagement, manually approved) are
 * used so the agent learns from curated examples, not noise.
 * Returns "" if platform is not one of the supported social platforms or if
 * the library has no gold posts for it.
 */
function buildFewShotBlock(platform: string): string {
  // Normalize content-engine platform strings to SocialPlatform union.
  const plat = normalizePlatform(platform);
  if (!plat) return "";

  const examples = selectForFewShot(plat, 5);
  if (examples.length === 0) return "";

  const lines: string[] = [
    "",
    `REFERENCE POSTS (top-performing examples from the ${plat} library — study the hook pattern, tone, length, CTA style, and visual direction; do NOT copy verbatim):`,
  ];
  for (const p of examples) {
    lines.push("---");
    if (p.engagementRate !== null) {
      lines.push(`engagement_rate=${p.engagementRate.toFixed(3)} source=${p.source}`);
    } else {
      lines.push(`source=${p.source}`);
    }
    if (p.hook) lines.push(`hook: ${p.hook}`);
    if (p.cta) lines.push(`cta: ${p.cta}`);
    if (p.text) lines.push(`body: ${p.text.slice(0, 500)}`);
    if (p.hashtags.length) lines.push(`hashtags: ${p.hashtags.map((h) => "#" + h).join(" ")}`);
    const visual = p.media.find((m) => m.description)?.description;
    if (visual) lines.push(`visual: ${visual.slice(0, 240)}`);
    if (p.tags.length) lines.push(`tags: ${p.tags.join(", ")}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function normalizePlatform(platform: string): SocialPlatform | null {
  const p = platform.toLowerCase();
  if (p === "x") return "twitter";
  if (SOCIAL_PLATFORMS.includes(p as SocialPlatform)) return p as SocialPlatform;
  return null;
}

/**
 * Render a `StyleProfile` as an instruction block for the generation prompt.
 * Token-efficient: structured rules, not raw post examples (those still come
 * from `buildFewShotBlock`).
 */
function buildStyleProfileBlock(profile: StyleProfile): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `STYLE PROFILE — schreibe im Stil von ${profile.displayName} (@${profile.handle}, ${profile.platform}). ` +
      `Imitiere Stil und Struktur, NICHT Inhalte. Diese Person ist die Vorlage:`,
  );
  lines.push(`- Tonfall: ${profile.toneOfVoice || "nicht spezifiziert"}`);
  lines.push(
    `- Länge: ~${profile.averageWordCount} Wörter (${profile.lengthCategory}). Nicht signifikant abweichen.`,
  );

  if (profile.hookPatterns.length > 0) {
    const top = profile.hookPatterns
      .slice()
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 3)
      .map((h) => `${h.type} (${Math.round(h.frequency * 100)}%)`)
      .join(", ");
    lines.push(`- Bevorzugte Hook-Pattern: ${top}`);
    const exampleHook = profile.hookPatterns[0]?.examples?.[0];
    if (exampleHook) lines.push(`  Beispiel-Hook: "${exampleHook}"`);
  }

  if (profile.ctaPatterns.length > 0) {
    const top = profile.ctaPatterns
      .slice()
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 2)
      .map((c) => `${c.type} (${Math.round(c.frequency * 100)}%)`)
      .join(", ");
    lines.push(`- CTA-Pattern: ${top}`);
  }

  lines.push(
    `- Emoji-Stil: ${profile.emojiStyle}` +
      (profile.emojiList.length > 0 ? ` — typisch: ${profile.emojiList.slice(0, 6).join(" ")}` : ""),
  );
  lines.push(`- Hashtag-Stil: ${profile.hashtagStyle}`);

  if (profile.contentPillars.length > 0) {
    lines.push(`- Themen-Säulen: ${profile.contentPillars.join(", ")}`);
  }

  if (profile.commentEngagementPattern) {
    lines.push(`- Engagement-Trick (Eigenkommentare): ${profile.commentEngagementPattern}`);
  }

  if (profile.rawAnalysis) {
    lines.push(`- Stil-Zusammenfassung: ${profile.rawAnalysis}`);
  }

  return lines.join("\n");
}

async function getHashtagPoolContext(industry: string, language: string): Promise<string> {
  try {
    const pools = listHashtagPools();
    if (pools.length === 0) return "";

    // Try to find matching pool by industry, fall back to all
    const matching = pools.filter(
      (p) =>
        p.industry.toLowerCase() === industry.toLowerCase() ||
        p.language === language
    );
    const selected = matching.length > 0 ? matching : pools;

    const lines: string[] = [
      "HASHTAG POOL (use these curated hashtags, mix popular + medium + niche):",
    ];
    for (const pool of selected) {
      lines.push(`  Business: ${pool.name} (${pool.industry})`);
      if (pool.popular.length > 0) lines.push(`  Popular (high reach): ${pool.popular.join(", ")}`);
      if (pool.medium.length > 0) lines.push(`  Medium (balanced): ${pool.medium.join(", ")}`);
      if (pool.niche.length > 0) lines.push(`  Niche (targeted): ${pool.niche.join(", ")}`);
      if (pool.branded.length > 0) lines.push(`  Branded: ${pool.branded.join(", ")}`);
      if (pool.blocked.length > 0) lines.push(`  NEVER USE: ${pool.blocked.join(", ")}`);
    }
    lines.push("- Pick 1-2 popular + 1-2 medium + 1-2 niche per post. Always include 1 branded if available.");
    lines.push("- You may add 1 situational hashtag that fits the specific post topic.");
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ─── Smart Content Generation ───────────────────────────────────────────────

const COPY_FRAMEWORKS: CopyFramework[] = ["PAS", "AIDA", "BAB", "StoryBrand"];

/**
 * Generate platform-optimized content pieces.
 */
export async function generateSmartContent(opts: {
  intelligence: WebsiteIntelligence;
  strategy: ContentStrategy;
  platform: string;
  journeyStage?: JourneyStage;
  count?: number;
  /**
   * Handle of a SocialView role-model whose `StyleProfile` should drive the
   * voice/structure of the generated posts. Pass e.g. "rene.remsik" to write
   * "im Stil von Rene Remsik". If the profile doesn't exist for the given
   * platform/handle, generation falls back to default few-shot only.
   */
  styleProfileHandle?: string;
}): Promise<ContentPiece[]> {
  const { intelligence, strategy, platform, journeyStage, count = 5, styleProfileHandle } = opts;

  const spec = getPlatform(platform);
  if (!spec) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const platformSummary = buildPlatformSummary(platform);
  const fewShot = buildFewShotBlock(platform);

  // Optional: pull a saved style profile for the requested handle.
  let styleBlock = "";
  if (styleProfileHandle) {
    const plat = normalizePlatform(platform);
    if (plat) {
      const profile = getStyleProfile(plat, styleProfileHandle);
      if (profile) styleBlock = buildStyleProfileBlock(profile);
    }
  }
  const stage = journeyStage || "attract";
  const pillar = strategy.pillars[Math.floor(Math.random() * strategy.pillars.length)]!;
  const painPoint = pillar.painPoints[Math.floor(Math.random() * pillar.painPoints.length)] || "General challenge";

  const prompt = `Generate ${count} social media content pieces for ${spec.name}.

BUSINESS CONTEXT:
- Company: ${intelligence.companyName}
- Industry: ${intelligence.industry}
- Business Type: ${intelligence.businessType}
- Target Audience: ${intelligence.targetAudience}
- USPs: ${intelligence.usp.join(", ")}
- Tone: ${intelligence.tone}
- Language: ${intelligence.language}

CONTENT PILLAR: ${pillar.name} — ${pillar.description}
CUSTOMER PAIN POINT TO ADDRESS: ${painPoint}
JOURNEY STAGE: ${stage} (${stage === "attract" ? "awareness, education" : stage === "convert" ? "consideration, comparison" : "decision, action"})

${platformSummary}

COPYWRITING FRAMEWORKS TO USE (rotate between them):
- PAS: Problem → Agitate → Solution
- AIDA: Attention → Interest → Desire → Action
- BAB: Before → After → Bridge
- StoryBrand: Character has a problem → meets a guide → who gives them a plan → calls them to action → helps them avoid failure → ends in success

REQUIREMENTS:
- Each post must have a strong hook in the first line
- Follow platform best practices for length and format
- Include relevant hashtags (${spec.hashtags.optimal})
- Write in ${intelligence.language === "de" ? "German" : intelligence.language === "fr" ? "French" : "English"}
- Include an image generation prompt for each post
${await getHashtagPoolContext(intelligence.industry, intelligence.language)}
${styleBlock}
${fewShot}

Return ONLY valid JSON array (no markdown, no explanation):
[
  {
    "framework": "PAS|AIDA|BAB|StoryBrand",
    "pillar": "${pillar.name}",
    "targetPain": "the pain point addressed",
    "hook": "the opening hook line",
    "headline": "post headline/title",
    "body": "full post body text",
    "cta": "call to action text",
    "hashtags": ["tag1", "tag2"],
    "imagePrompt": "detailed image generation prompt for this post"
  }
]`;

  const result = await callInternalAI({
    systemPrompt: "You are an expert social media content strategist and copywriter. Generate platform-optimized content. Return ONLY valid JSON arrays, no markdown fences, no explanation.",
    userPrompt: prompt,
    maxTokens: 4096,
    temperature: 0.8,
    timeoutMs: 60_000,
  });

  if (!result.ok || !result.text) {
    console.error("[content-engine] Content generation failed:", result.error);
    throw new Error(`Content generation failed: ${result.error || "Unknown error"}`);
  }

  try {
    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    const rawPieces = JSON.parse(jsonText) as Array<{
      framework?: string;
      pillar?: string;
      targetPain?: string;
      hook?: string;
      headline?: string;
      body?: string;
      cta?: string;
      hashtags?: string[];
      imagePrompt?: string;
    }>;

    return rawPieces.map((raw) => ({
      id: randomUUID(),
      platform,
      type: "social-post" as const,
      journeyStage: stage,
      framework: (COPY_FRAMEWORKS.includes(raw.framework as CopyFramework) ? raw.framework : "PAS") as CopyFramework,
      pillar: raw.pillar || pillar.name,
      targetPain: raw.targetPain || painPoint,
      hook: raw.hook || "",
      headline: raw.headline || "",
      body: raw.body || "",
      cta: raw.cta || "",
      hashtags: raw.hashtags || [],
      imagePrompt: raw.imagePrompt,
      status: "draft" as const,
    }));
  } catch (e) {
    console.error("[content-engine] Failed to parse content response:", e);
    throw new Error("Failed to parse generated content");
  }
}

// ─── Ad Creative Generation ─────────────────────────────────────────────────

/**
 * Generate ad creatives with copy, image prompts, and brand-aligned design specs.
 */
export async function generateAdCreatives(opts: {
  intelligence: WebsiteIntelligence;
  platform: string;
  count?: number;
}): Promise<AdCreative[]> {
  const { intelligence, platform, count = 3 } = opts;

  const spec = getPlatform(platform);
  if (!spec) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const prompt = `Generate ${count} ad creatives for ${spec.name}.

BUSINESS:
- Company: ${intelligence.companyName}
- Industry: ${intelligence.industry}
- USPs: ${intelligence.usp.join(", ")}
- Target Audience: ${intelligence.targetAudience}
- Tone: ${intelligence.tone}
- Brand Colors: ${intelligence.colors.slice(0, 5).join(", ") || "not specified"}
- Language: ${intelligence.language}

AD SPECS FOR ${spec.name.toUpperCase()}:
- Best Format: ${spec.adSpecs.bestFormat}
- Best Aspect Ratio: ${spec.adSpecs.bestAspectRatio}
- Best Resolution: ${spec.adSpecs.bestResolution}
- Headline Length: ${spec.adSpecs.headlineLength}
- Body Length: ${spec.adSpecs.bodyLength}

REQUIREMENTS:
- Create compelling ad copy with clear value propositions
- Headlines should be punchy and within the platform's recommended length
- Include a clear CTA
- Image prompts should incorporate brand colors and style
- Write in ${intelligence.language === "de" ? "German" : intelligence.language === "fr" ? "French" : "English"}

Return ONLY valid JSON array (no markdown, no explanation):
[
  {
    "format": "${spec.adSpecs.bestFormat}",
    "headline": "ad headline",
    "body": "ad body copy",
    "cta": "call to action button text",
    "imagePrompt": "detailed image prompt incorporating brand colors ${intelligence.colors.slice(0, 3).join(", ")} and brand style"
  }
]`;

  const result = await callInternalAI({
    systemPrompt: "You are an expert advertising creative director. Generate high-converting ad creatives. Return ONLY valid JSON arrays, no markdown fences, no explanation.",
    userPrompt: prompt,
    maxTokens: 2048,
    temperature: 0.7,
    timeoutMs: 30_000,
  });

  if (!result.ok || !result.text) {
    console.error("[content-engine] Ad generation failed:", result.error);
    throw new Error(`Ad generation failed: ${result.error || "Unknown error"}`);
  }

  try {
    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    const rawAds = JSON.parse(jsonText) as Array<{
      format?: string;
      headline?: string;
      body?: string;
      cta?: string;
      imagePrompt?: string;
    }>;

    return rawAds.map((raw) => ({
      id: randomUUID(),
      platform,
      format: raw.format || spec.adSpecs.bestFormat,
      aspectRatio: spec.adSpecs.bestAspectRatio,
      resolution: spec.adSpecs.bestResolution,
      headline: raw.headline || "",
      body: raw.body || "",
      cta: raw.cta || "",
      imagePrompt: raw.imagePrompt || "",
      brandColors: intelligence.colors.slice(0, 5),
      tone: intelligence.tone,
    }));
  } catch (e) {
    console.error("[content-engine] Failed to parse ad response:", e);
    throw new Error("Failed to parse generated ad creatives");
  }
}

// ─── Full Content Plan ──────────────────────────────────────────────────────

export interface ContentPlan {
  intelligence: WebsiteIntelligence;
  strategy: ContentStrategy;
  content: Record<string, ContentPiece[]>; // keyed by platform
  ads: Record<string, AdCreative[]>; // keyed by platform
  weeks: number;
  generatedAt: string;
}

/**
 * Generate a complete content plan for multiple weeks across platforms.
 */
export async function generateContentPlan(opts: {
  url: string;
  platforms?: string[];
  weeks?: number;
}): Promise<ContentPlan> {
  const { url, platforms = ["instagram", "linkedin", "facebook"], weeks = 4 } = opts;

  // 1. Analyze website
  const intelligence = await analyzeWebsite(url);

  // 2. Create strategy
  const strategy = createContentStrategy(intelligence, platforms);

  // 3. Generate content for each platform
  const content: Record<string, ContentPiece[]> = {};
  const ads: Record<string, AdCreative[]> = {};
  const stages: JourneyStage[] = ["attract", "convert", "close"];

  for (const platform of platforms) {
    const spec = getPlatform(platform);
    if (!spec) continue;

    const postsPerWeek = parsePostsPerWeek(spec.frequency.recommended);
    const totalPosts = Math.min(postsPerWeek * weeks, 20); // Cap at 20 per platform

    // Generate content across journey stages
    const allPieces: ContentPiece[] = [];
    for (const stage of stages) {
      const stageCount = Math.max(1, Math.round(totalPosts * (stage === "attract" ? 0.5 : stage === "convert" ? 0.3 : 0.2)));
      try {
        const pieces = await generateSmartContent({
          intelligence,
          strategy,
          platform,
          journeyStage: stage,
          count: stageCount,
        });
        allPieces.push(...pieces);
      } catch (e) {
        console.error(`[content-engine] Failed to generate ${stage} content for ${platform}:`, e);
      }
    }
    content[platform] = allPieces;

    // Generate ad creatives
    try {
      ads[platform] = await generateAdCreatives({ intelligence, platform, count: 3 });
    } catch (e) {
      console.error(`[content-engine] Failed to generate ads for ${platform}:`, e);
      ads[platform] = [];
    }
  }

  return {
    intelligence,
    strategy,
    content,
    ads,
    weeks,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Remix from Library ─────────────────────────────────────────────────────
// Takes a single role-model LibraryPost and generates a Markus-Voice variant
// adapted to his business. This is the "klauen + ummodeln" pattern: keep the
// hook structure, beat sequence, and CTA cadence; replace topic/voice/assets
// with Markus's. The viral-short-director skill picks up the resulting
// ContentPiece via the wizard endpoint (Task #5).

export interface RemixOptions {
  /** Library post to use as the source — must already exist in the library. */
  sourcePostId: string;
  /** Source post's platform (used to load the right library subdir). */
  sourcePlatform: SocialPlatform;
  /** Target platform for the remix output — often same as source, can differ for cross-post. */
  targetPlatform: string;
  /** Markus's business context — supplies USPs, audience, tone for the rewrite. */
  intelligence: WebsiteIntelligence;
  /**
   * Free-text hint that tells the model HOW to reframe the source.
   * Example: "frame around voltah2 instead of the original product".
   * Optional — without it the model uses generic business-angle adaptation.
   */
  businessAngle?: string;
}

/**
 * Generate a single ContentPiece that remixes a library post into Markus's
 * voice and business angle. Preserves the source's hook pattern, structure,
 * and CTA cadence but replaces every concrete reference with Markus's context.
 *
 * Throws when the source post isn't in the library (id typo, deleted).
 * Throws on model output that can't be parsed as a ContentPiece — the caller
 * (route) surfaces this as 500 with the raw model output for debugging.
 */
export async function remixPost(opts: RemixOptions): Promise<ContentPiece> {
  const source = getLibraryPost(opts.sourcePlatform, opts.sourcePostId);
  if (!source) {
    throw new Error(`Library post ${opts.sourcePlatform}/${opts.sourcePostId} not found`);
  }

  const spec = getPlatform(opts.targetPlatform);
  if (!spec) throw new Error(`Unknown target platform: ${opts.targetPlatform}`);

  // Pull the source author's style profile if we've analyzed them. That gives
  // the model an explicit voice fingerprint rather than relying on it to
  // generalize from a single post.
  let styleBlock = "";
  const plat = normalizePlatform(opts.sourcePlatform);
  if (plat) {
    const profile = getStyleProfile(plat, source.author.handle);
    if (profile) styleBlock = `\nSOURCE AUTHOR'S VOICE PROFILE (for reference only — do NOT copy it):\n${buildStyleProfileBlock(profile)}`;
  }

  // Build a compact source-post summary. Media descriptions are AI-generated
  // already (vision.ts) — perfect for the model to grasp what the visual conveys.
  const sourceSummary = [
    `Platform: ${source.platform}`,
    `Author: ${source.author.handle}${source.author.displayName ? ` (${source.author.displayName})` : ""}`,
    source.author.followers ? `Followers: ${source.author.followers.toLocaleString()}` : "",
    `Posted: ${source.postedAt ?? "unknown"}`,
    `Engagement: ${source.engagement.likes ?? "?"} likes, ${source.engagement.comments ?? "?"} comments${source.engagement.shares ? `, ${source.engagement.shares} shares` : ""}`,
    `Post type: ${source.postType}`,
    "",
    `HOOK (first line): ${source.hook || "(none captured)"}`,
    `FULL TEXT:`,
    source.text || "(empty)",
    source.cta ? `\nORIGINAL CTA: ${source.cta}` : "",
    source.hashtags.length ? `\nHASHTAGS USED: ${source.hashtags.join(", ")}` : "",
    source.media.length ? `\nVISUAL: ${source.media.map((m) => `[${m.type}] ${m.description}`).join(" | ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are remixing a viral social media post into MARKUS STOEGER'S voice and business angle.

ORIGINAL VIRAL POST (the source — study its structure):
=============================================================
${sourceSummary}
=============================================================

TARGET BUSINESS CONTEXT:
- Company: ${opts.intelligence.companyName}
- Industry: ${opts.intelligence.industry}
- Business Type: ${opts.intelligence.businessType}
- Target Audience: ${opts.intelligence.targetAudience}
- USPs: ${opts.intelligence.usp.join(", ")}
- Tone: ${opts.intelligence.tone}
- Language: ${opts.intelligence.language}
${opts.businessAngle ? `\nBUSINESS ANGLE (how to reframe the source):\n${opts.businessAngle}` : ""}
${styleBlock}

REMIX RULES:
1. PRESERVE the hook structure (pattern, rhythm, length). E.g. if source opens with a number-shock, your hook also opens with a number-shock — but a different number for Markus's context.
2. PRESERVE the beat sequence and CTA cadence. The structural skeleton is what makes the post viral.
3. REPLACE every concrete reference (product, tool, person, dollar amount, claim) with Markus's USPs, business, results.
4. NEVER copy a sentence verbatim. Paraphrase even the strongest lines.
5. Match Markus's tone (${opts.intelligence.tone}) and language (${opts.intelligence.language === "de" ? "German" : opts.intelligence.language === "fr" ? "French" : "English"}).
6. Output ONE post (not a list).
7. Hashtags must be relevant to Markus's industry, not the source's.
8. Image prompt should describe a visual that ALIGNS with the remixed post — referencing Markus's setting/tools/products, not the source's.

Return ONLY a single JSON object (no markdown fences, no explanation):
{
  "framework": "PAS|AIDA|BAB|StoryBrand",
  "pillar": "name of the content pillar this aligns with",
  "targetPain": "the customer pain this addresses",
  "hook": "the opening hook line",
  "headline": "post headline/title",
  "body": "full post body",
  "cta": "call to action",
  "hashtags": ["tag1", "tag2"],
  "imagePrompt": "detailed image prompt for Markus's version"
}`;

  const result = await callInternalAI({
    systemPrompt: "You are an expert social media remix copywriter. You take a viral post's STRUCTURE and adapt it to a different business + voice without copying any text verbatim. Return ONLY valid JSON object, no markdown fences.",
    userPrompt: prompt,
    maxTokens: 2048,
    temperature: 0.75,
  });

  let parsed: any;
  try {
    // Strip optional ```json fences the model sometimes emits despite instructions.
    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Remix model output was not valid JSON: ${result.text.slice(0, 200)}`);
  }

  const piece: ContentPiece = {
    id: randomUUID(),
    platform: opts.targetPlatform,
    type: "social-post",
    journeyStage: "attract",
    framework: (parsed.framework as CopyFramework) || "PAS",
    pillar: parsed.pillar || "Remix",
    targetPain: parsed.targetPain || "",
    hook: parsed.hook || "",
    headline: parsed.headline || "",
    body: parsed.body || "",
    cta: parsed.cta || "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    imagePrompt: parsed.imagePrompt,
    status: "draft",
    remix: {
      sourcePostId: source.id,
      sourcePlatform: source.platform,
      sourceAuthor: source.author.handle,
      sourceUrl: source.url,
      businessAngle: opts.businessAngle,
    },
  };
  return piece;
}
