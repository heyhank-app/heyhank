// Shared IG wizard generation logic — used by both the HTTP route
// (web/server/routes/ig-wizard-routes.ts) AND the MCP server
// (web/server/mcp/ig-wizard-mcp-server.ts). Keep the system prompt, parsing,
// and result shape in one place so the two surfaces never drift.

import { callInternalAI, hasInternalAI } from "./internal-ai.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A complete lead package = the comment-trigger CTA, the extracted ALL-CAPS
 * keyword, and the DM body that gets sent when the keyword is matched. These
 * three fields are generated together so the DM template actually fulfills
 * the resource that the CTA promised. Used to one-click create an Auto-DM
 * rule in the UI without the user having to invent a coherent template.
 */
export interface LeadPackage {
  /** The full CTA line for the caption (e.g. "Comment AUTOMATE for my AI workflow ⚡") */
  cta: string;
  /** The ALL-CAPS trigger word the commenter must use (e.g. "AUTOMATE") */
  trigger: string;
  /** The DM body that gets sent in response (e.g. "Here's the AI workflow I promised...") */
  dmTemplate: string;
}

export interface IgWizardCtas {
  engagement: string[];
  leads: LeadPackage[];
  growth: string[];
}

export interface IgWizardResult {
  hooks: string[];
  ctas: IgWizardCtas;
  niche: string;
  language: string;
  model: string;
}

export type IgWizardLanguage = "en" | "de";

// ─── Caption Composer types ────────────────────────────────────────────────────

/**
 * A complete, ready-to-post Instagram caption assembled from a topic (+ an
 * optional pre-picked hook / CTA). The four parts are returned separately so
 * the UI can show structure, plus a pre-joined `caption` string for one-click
 * copy-paste.
 */
export type IgStyleId = "cozy" | "business" | "pointing" | "bold" | "screen";

export interface CaptionResult {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  /** hook + body + cta + hashtags, joined and ready to paste. */
  caption: string;
  /** AI-suggested image style for this post (overridable in the UI). */
  style: IgStyleId;
  language: string;
  model: string;
}

export function normalizeStyleId(raw: unknown): IgStyleId {
  return raw === "business" || raw === "pointing" || raw === "bold" || raw === "screen" ? raw : "cozy";
}

export interface CaptionGenerateOk {
  ok: true;
  result: CaptionResult;
}
export interface CaptionGenerateErr {
  ok: false;
  error: string;
  status: 400 | 502 | 503;
}

// ─── 30-Day Plan types ──────────────────────────────────────────────────────────

export type PlanCtaType = "lead" | "engagement" | "growth";

/** One day's post idea — a light brief. Expand into a full caption via the composer. */
export interface PlanBrief {
  day: number;
  /** The specific lens/concept for this day, one concrete sentence. */
  angle: string;
  /** A scroll-stopping hook line for this post. */
  hook: string;
  /** Which CTA category fits this post. */
  ctaType: PlanCtaType;
}

export interface PlanResult {
  topic: string;
  language: string;
  briefs: PlanBrief[];
  model: string;
}

export interface PlanGenerateOk {
  ok: true;
  result: PlanResult;
}
export interface PlanGenerateErr {
  ok: false;
  error: string;
  status: 400 | 502 | 503;
}

export interface IgWizardGenerateResult {
  ok: true;
  result: IgWizardResult;
}
export interface IgWizardErrorResult {
  ok: false;
  error: string;
  /** HTTP-equivalent status: 503 (no provider), 502 (AI failure), 400 (bad input). */
  status: 400 | 502 | 503;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

// Replicates the implicit prompt the reference tools (hooksgenerator.ai +
// ctagenerator.ai) use, reverse-engineered from observed outputs: 20 viral
// hooks with varied frames (curiosity, pain, list, contrarian, social-proof),
// plus 30 CTAs split into three categories. The "Leads" CTAs are the
// comment-keyword/DM-trigger format that maps 1:1 to HeyHank Auto-DM rules.
const SYSTEM_PROMPT = `You are a social-media copywriter specializing in Instagram Reels and photo posts that drive measurable conversions.

Generate two outputs for the given niche:

(A) 20 viral hook ideas designed to stop the scroll in the first 1-3 seconds. Mix these frames evenly:
  - Step-by-step ("Here's your step-by-step plan to ...")
  - Secret/Insider ("Secret tool for ...", "What nobody tells you about ...")
  - Social proof / Client result ("My client X did Y in Z time")
  - Listicle ("TOP-X ways to ...", "5 things I wish I knew about ...")
  - Expose-mistake ("Exposing the #1 mistake ...", "Stop doing X if you want Y")
  - How-to ("How to ... without ...")
  - Hack / Tip ("Simple hack to ...", "This is how ...")
  - Question / Pain ("Do you struggle to ...?", "Are you tired of ...?")
  - Reminder / Urgency ("This is a reminder to ...", "Never do X if ...")
  - Contrarian ("Everyone is wrong about ...", "Stop following ...")

(B) 30 CTAs split into three categories:
  - "engagement" (exactly 10) — drive likes/saves/shares/tags (e.g. "Double tap if ...", "Save this if ...", "Tag a friend who ...")
  - "leads" (exactly 10) — comment-triggered DM funnels. Each is a COMPLETE PACKAGE of three fields:
      * "cta": the caption line the audience reads (e.g. "Comment AUTOMATE for my free AI workflow template ⚡")
      * "trigger": the single ALL-CAPS keyword the commenter must use (e.g. "AUTOMATE"). MUST appear inside the cta string. 2-15 letters. No spaces.
      * "dmTemplate": the DM body the bot replies with. MUST actually deliver what the cta promised — if the cta says "free guide", the dmTemplate hands over the guide link (use placeholder like "[YOUR-LINK-HERE]" if you don't know the real URL). Personal, 1-3 sentences, opens with a warm hook ("Here's what you asked for!", "Thanks for commenting!"), then the resource, then optionally one soft follow-up CTA. Never include the trigger keyword in the DM body (that's already what they typed).
      All 10 lead packages must have UNIQUE triggers — no two CTAs can use the same keyword (they'd collide as Auto-DM rules).
  - "growth" (exactly 10) — follow drivers (e.g. "Follow me for daily ...", "Hit follow if you want ...")

Rules:
  - Keep hooks under 90 characters each.
  - Keep engagement/growth CTAs under 100 characters each.
  - Keep lead.cta under 100 characters, lead.dmTemplate under 280 characters.
  - Use 1 emoji max per item, placed for emphasis, not decoration.
  - Match the language requested ("en" or "de"). For "de" write fluent native German — do not translate literally.
  - Never use "as an AI", "I am unable", or refuse. If the niche is empty, generate generic creator-business content.

Return ONLY valid JSON in this exact shape, with no markdown fences or commentary:
{
  "hooks": ["...", "...", ... 20 items total],
  "ctas": {
    "engagement": ["...", ... 10 items],
    "leads": [
      { "cta": "Comment AUTOMATE for ...", "trigger": "AUTOMATE", "dmTemplate": "Here's the AI workflow ..." },
      ... 10 items total
    ],
    "growth": ["...", ... 10 items]
  }
}`;

function buildUserPrompt(niche: string, language: IgWizardLanguage): string {
  return `Niche: ${niche || "AI productivity for solo creators"}
Language: ${language}`;
}

// ─── JSON parsing (defensive) ────────────────────────────────────────────────

interface ParsedJson {
  hooks?: unknown;
  ctas?: { engagement?: unknown; leads?: unknown; growth?: unknown };
}

function extractJsonBlock(raw: string): string {
  // Models occasionally still wrap output in ```json ... ``` despite instructions.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) return fence[1].trim();
  // Or grab the first balanced { ... } in case there's leading commentary.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

/**
 * Coerce a raw lead entry into a LeadPackage. Accepts both the new object
 * shape (preferred — model returned the rich {cta, trigger, dmTemplate})
 * AND the legacy string shape, in which case we backfill trigger by extracting
 * the first ALL-CAPS word and leave dmTemplate empty. The UI uses
 * `dmTemplate.length === 0` to flag "fill this in before creating a rule".
 */
function normalizeLead(raw: unknown): LeadPackage | null {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { cta: raw.trim(), trigger: extractFirstAllCapsWord(raw) ?? "", dmTemplate: "" };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const cta = typeof o.cta === "string" ? o.cta.trim() : "";
    if (!cta) return null;
    const trigger = typeof o.trigger === "string" ? o.trigger.trim().toUpperCase() : extractFirstAllCapsWord(cta) ?? "";
    const dmTemplate = typeof o.dmTemplate === "string" ? o.dmTemplate.trim() : "";
    return { cta, trigger, dmTemplate };
  }
  return null;
}

function extractFirstAllCapsWord(s: string): string | null {
  const m = s.match(/\b([A-Z]{2,20})\b/);
  return m ? m[1] : null;
}

function parseAndNormalize(raw: string): { hooks: string[]; ctas: IgWizardCtas } | null {
  const block = extractJsonBlock(raw);
  let parsed: ParsedJson;
  try {
    parsed = JSON.parse(block) as ParsedJson;
  } catch {
    return null;
  }
  const hooks = Array.isArray(parsed.hooks)
    ? parsed.hooks.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const ctasRaw = parsed.ctas ?? {};
  const ctas: IgWizardCtas = {
    engagement: Array.isArray(ctasRaw.engagement)
      ? ctasRaw.engagement.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
      : [],
    leads: Array.isArray(ctasRaw.leads)
      ? (ctasRaw.leads.map(normalizeLead).filter((x): x is LeadPackage => x !== null))
      : [],
    growth: Array.isArray(ctasRaw.growth)
      ? ctasRaw.growth.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
      : [],
  };
  if (hooks.length === 0 && ctas.engagement.length === 0 && ctas.leads.length === 0 && ctas.growth.length === 0) {
    return null;
  }
  return { hooks, ctas };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function normalizeLanguage(raw: unknown): IgWizardLanguage {
  return typeof raw === "string" && raw.toLowerCase() === "de" ? "de" : "en";
}

export function normalizeNiche(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 200) : "";
}

/**
 * Generate hooks + CTAs for an IG niche. Returns a discriminated union so the
 * caller can match on ok/error and forward the right status code or MCP error.
 */
export async function generateIgWizard(
  niche: string,
  language: IgWizardLanguage,
): Promise<IgWizardGenerateResult | IgWizardErrorResult> {
  if (!hasInternalAI()) {
    return {
      ok: false,
      status: 503,
      error: "No internal AI provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings.",
    };
  }

  const ai = await callInternalAI({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(niche, language),
    maxTokens: 4000,
    temperature: 0.85,
    timeoutMs: 60_000,
  });

  if (!ai.ok) {
    return { ok: false, status: 502, error: ai.error || "AI call failed" };
  }

  const parsed = parseAndNormalize(ai.text);
  if (!parsed) {
    return {
      ok: false,
      status: 502,
      error: "AI returned invalid JSON. Try again — the model occasionally adds prose around the JSON block.",
    };
  }

  return {
    ok: true,
    result: {
      hooks: parsed.hooks,
      ctas: parsed.ctas,
      niche: niche || "(empty)",
      language,
      model: "internal-ai",
    },
  };
}

// ─── Caption Composer ──────────────────────────────────────────────────────────

const CAPTION_SYSTEM_PROMPT = `You are a social-media copywriter who writes complete, ready-to-post Instagram captions that build an email list — not one-shot reach.

Write ONE caption for the given topic with these parts:
  - "hook": one scroll-stopping opening line (under 90 chars). If the user supplied a hook, use it VERBATIM as the hook.
  - "body": 2-4 short lines of concrete, specific value. Each line is its own short paragraph. No fluff, no filler, no hype. Give real substance a reader can act on.
  - "cta": one clear call-to-action that drives a comment-triggered DM funnel. If the user supplied a CTA, use it VERBATIM. Otherwise write a "Comment KEYWORD for X" style line with one ALL-CAPS trigger word.
  - "hashtags": 8-12 relevant hashtags as an array of strings WITHOUT the # symbol, mixing broad + niche tags.
  - "style": the best image style for this post — one of: "cozy" (warm builder-at-work, for build stories / how-I-did-it), "business" (clean studio authority, for news / opinions / credibility), "pointing" (expressive, points at the headline, for hooks / reveals / curiosity), "bold" (huge typography, for contrarian hot-takes / quotes), "screen" (beside a UI screen, for tool reviews / demos). Choose the one that matches THIS post's angle.

Voice rules (critical):
  - Confident but never arrogant. NEVER write self-congratulatory proof sentences like "My proof: X" or "I'm living proof". Show, don't boast.
  - Specific over generic. Concrete numbers, tools, steps — not vague promises.
  - 1 emoji max per line, used for emphasis, not decoration.
  - Match the requested language ("en" or "de"). For "de" write fluent native German, not a literal translation.
  - Never use "as an AI", never refuse.

Return ONLY valid JSON in this exact shape, no markdown fences, no commentary:
{ "hook": "...", "body": "line one\\n\\nline two", "cta": "Comment WORD for ...", "hashtags": ["tag1", "tag2", ...], "style": "cozy" }`;

function buildCaptionUserPrompt(input: {
  topic: string;
  language: IgWizardLanguage;
  hook?: string;
  cta?: string;
  grounding?: string;
}): string {
  const lines = [
    `Topic: ${input.topic || "AI tools for solo creators"}`,
    `Language: ${input.language}`,
  ];
  if (input.hook && input.hook.trim()) lines.push(`Use this exact hook: ${input.hook.trim()}`);
  if (input.cta && input.cta.trim()) lines.push(`Use this exact CTA: ${input.cta.trim()}`);
  if (input.grounding && input.grounding.trim()) {
    lines.push(
      "",
      "RESEARCH BRIEF — ground the body in these real, current specifics. Weave in at",
      "least one concrete fact, number, or recent development below instead of writing",
      "generic advice. Do NOT invent facts beyond this brief:",
      input.grounding.trim(),
    );
  }
  return lines.join("\n");
}

interface ParsedCaption {
  hook?: unknown;
  body?: unknown;
  cta?: unknown;
  hashtags?: unknown;
  style?: unknown;
}

/** Normalise hashtags: strip leading #, drop blanks, dedupe, cap at 15. */
export function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const clean = t.trim().replace(/^#+/, "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 15) break;
  }
  return out;
}

/** Join the structured parts into a copy-paste-ready caption string. */
export function assembleCaption(parts: { hook: string; body: string; cta: string; hashtags: string[] }): string {
  const blocks: string[] = [];
  if (parts.hook.trim()) blocks.push(parts.hook.trim());
  if (parts.body.trim()) blocks.push(parts.body.trim());
  if (parts.cta.trim()) blocks.push(parts.cta.trim());
  if (parts.hashtags.length) blocks.push(parts.hashtags.map((h) => `#${h}`).join(" "));
  return blocks.join("\n\n");
}

function parseCaption(raw: string): { hook: string; body: string; cta: string; hashtags: string[]; style: IgStyleId } | null {
  const block = extractJsonBlock(raw);
  let parsed: ParsedCaption;
  try {
    parsed = JSON.parse(block) as ParsedCaption;
  } catch {
    return null;
  }
  const hook = typeof parsed.hook === "string" ? parsed.hook.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  const cta = typeof parsed.cta === "string" ? parsed.cta.trim() : "";
  const hashtags = normalizeHashtags(parsed.hashtags);
  const style = normalizeStyleId(parsed.style);
  // Need at least a hook or body to be a usable caption.
  if (!hook && !body) return null;
  return { hook, body, cta, hashtags, style };
}

export function normalizeTopic(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 300) : "";
}

export function normalizeOptionalLine(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().slice(0, 300);
  return t.length > 0 ? t : undefined;
}

/**
 * Generate a complete, ready-to-post caption for a topic. Optionally anchored
 * to a pre-picked hook + CTA (e.g. the user's choices from the wizard's hook /
 * lead lists) so the caption stays consistent with the funnel they're building.
 */
export async function generateCaption(input: {
  topic: string;
  language: IgWizardLanguage;
  hook?: string;
  cta?: string;
  /** Optional research-brief grounding text (see research.ts) for a specific, non-generic body. */
  grounding?: string;
}): Promise<CaptionGenerateOk | CaptionGenerateErr> {
  if (!hasInternalAI()) {
    return {
      ok: false,
      status: 503,
      error: "No internal AI provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings.",
    };
  }

  const ai = await callInternalAI({
    systemPrompt: CAPTION_SYSTEM_PROMPT,
    userPrompt: buildCaptionUserPrompt(input),
    maxTokens: 1500,
    temperature: 0.8,
    timeoutMs: 60_000,
  });

  if (!ai.ok) {
    return { ok: false, status: 502, error: ai.error || "AI call failed" };
  }

  const parsed = parseCaption(ai.text);
  if (!parsed) {
    return {
      ok: false,
      status: 502,
      error: "AI returned invalid caption JSON. Try again — the model occasionally adds prose around the JSON block.",
    };
  }

  // If the user supplied a hook/cta, honour it verbatim regardless of what the
  // model echoed back (it usually obeys, but this guarantees consistency).
  const hook = input.hook?.trim() || parsed.hook;
  const cta = input.cta?.trim() || parsed.cta;
  const caption = assembleCaption({ hook, body: parsed.body, cta, hashtags: parsed.hashtags });

  return {
    ok: true,
    result: {
      hook,
      body: parsed.body,
      cta,
      hashtags: parsed.hashtags,
      caption,
      style: parsed.style,
      language: input.language,
      model: "internal-ai",
    },
  };
}

// ─── Adapt Inspiration ──────────────────────────────────────────────────────────

const ADAPT_SYSTEM_PROMPT = `You rewrite an Instagram post into Markus' own version. Markus is an indie maker,
brand "Built with AI" (practical, hands-on, never arrogant).

GOAL: the SAME post — same idea, same structure, same value — but reworded AND
re-labeled enough that it does NOT read as a copy of the original. This is the
sweet spot between a verbatim spin (too close) and a brand-new post (too
different): keep the substance, swap the signature branding.

KEEP (same substance — do not change):
- The same core idea, claims, takeaway, and the same examples/specifics.
- The same structure: the same sections, the SAME number of points/steps, in the SAME order.
- Roughly the same length (within ~20%). Do NOT expand into an essay or add/remove sections.
- Real product / tool / company names EXACTLY (Claude, Anthropic, ChatGPT, Gemini,
  GitHub, Veo, etc.). Never rename or genericize a real product.

RE-LABEL (this is the key step — what stops it reading as a copy):
- The original usually COINS its own catchy names: a framework/method/system name,
  named roles or personas, or named steps (e.g. a method "The Council" with roles
  "The Contrarian / The First-Principles Thinker / ..."; or "The Vault / The Standing
  Order / The Sealed Memory"). REPLACE every one of these coined labels with a fitting
  SYNONYM or equivalent of your own — same meaning, different word.
    · "The Council" → "The Panel" / "The Board" / "The Roundtable"
    · "The Contrarian" → "The Skeptic"; "The Executor" → "The Operator"
    · German: "Rat" → "Gremium" / "Beirat" / "Komitee"
  Each renamed role/step must do the EXACT SAME thing as in the original — only its
  NAME changes, never its function, count, or order.
- If a comment-trigger WORD is tied to that name, change the trigger to match the new
  name (e.g. trigger "COUNCIL" → "PANEL").

RE-EXPRESS THE PROSE (genuinely rewrite — do NOT word-swap):
- Rewrite EVERY sentence from scratch with a DIFFERENT sentence structure, a different
  opening, and a different rhythm. If your version were placed next to the original,
  NO sentence should be identical or near-identical. Swapping a few adjectives
  (good→solid, start→launch) is NOT enough — that still reads as copy-paste.
- The HOOK especially must be genuinely re-built, not the original line with two words
  changed.
    · Original hook: "Ever noticed how Claude just... agrees with everything you say?"
    · Too close (FORBIDDEN): "Ever noticed how Claude just... agrees with everything you say?"
    · Good: "Claude has a habit nobody questions: it nods along to whatever you tell it."
- Keep each example's POINT, but phrase it your own way (you may vary the specifics
  slightly as long as the point lands the same).
- Markus' voice: clear, confident, never arrogant. 1 emoji max per line.
- Match the requested language. For "de" produce fluent native German, using German
  synonyms for the coined labels.

DO NOT: change the actual advice/content, reorder or add/remove points, rename real
products, drift to a different topic, OR keep any sentence verbatim/near-verbatim from
the source. Same substance + structure + length, fully re-expressed prose, freshly-named
signature concepts.

Return ONLY valid JSON in this exact shape, no markdown fences, no commentary:
{ "hook": "...", "body": "line one\\n\\nline two", "cta": "Comment WORD for ...", "hashtags": ["tag1", "tag2", ...], "style": "cozy" }`;

function buildAdaptUserPrompt(input: {
  handle: string;
  format: string;
  referenceCaption: string;
  topic?: string;
  language: IgWizardLanguage;
}): string {
  const lines = [
    `Language: ${input.language}`,
    `Reference post format: ${input.format}`,
  ];
  if (input.topic && input.topic.trim()) {
    lines.push(`Optional emphasis (do not let it change the content): ${input.topic.trim()}`);
  }
  lines.push(
    "",
    "REFERENCE POST — rewrite THIS keeping the same content, structure, examples,",
    "length and CTA, but rename every coined/branded concept + role + trigger word",
    "to a fitting synonym (keep real product names as-is):",
    input.referenceCaption.trim(),
  );
  return lines.join("\n");
}

/**
 * Take a post Markus saved from a creator he admires and rewrite the underlying
 * idea as his own original caption (same JSON shape as generateCaption, so the
 * UI and the WizardPost draft path are identical). Theme-level reuse, not
 * verbatim copy — this is the risk-free alternative to crawling.
 */
export async function adaptInspiration(input: {
  handle: string;
  format: string;
  referenceCaption: string;
  topic?: string;
  language: IgWizardLanguage;
}): Promise<CaptionGenerateOk | CaptionGenerateErr> {
  if (!input.referenceCaption || !input.referenceCaption.trim()) {
    return { ok: false, status: 400, error: "referenceCaption is required to adapt." };
  }
  if (!hasInternalAI()) {
    return {
      ok: false,
      status: 503,
      error: "No internal AI provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings.",
    };
  }

  const ai = await callInternalAI({
    systemPrompt: ADAPT_SYSTEM_PROMPT,
    userPrompt: buildAdaptUserPrompt(input),
    maxTokens: 1500,
    temperature: 0.85,
    timeoutMs: 60_000,
  });

  if (!ai.ok) {
    return { ok: false, status: 502, error: ai.error || "AI call failed" };
  }

  const parsed = parseCaption(ai.text);
  if (!parsed) {
    return {
      ok: false,
      status: 502,
      error: "AI returned invalid caption JSON. Try again — the model occasionally adds prose around the JSON block.",
    };
  }

  const caption = assembleCaption({
    hook: parsed.hook,
    body: parsed.body,
    cta: parsed.cta,
    hashtags: parsed.hashtags,
  });

  return {
    ok: true,
    result: {
      hook: parsed.hook,
      body: parsed.body,
      cta: parsed.cta,
      hashtags: parsed.hashtags,
      caption,
      style: parsed.style,
      language: input.language,
      model: "internal-ai",
    },
  };
}

// ─── Carousel Script ────────────────────────────────────────────────────────────

export interface CarouselSlide {
  /** Short on-image text for this slide (a headline, not a paragraph). */
  text: string;
  /** Short visual concept for the slide image, e.g. "a stylized terminal motif".
      Used for person-free middle slides; ignored for the hook/CTA (Markus) slides. */
  visual?: string;
}

export interface CarouselScriptResult {
  slides: CarouselSlide[];
  model: string;
}

export interface CarouselScriptOk { ok: true; result: CarouselScriptResult; }
export interface CarouselScriptErr { ok: false; error: string; status: 400 | 502 | 503; }

/** Clamp the slide count to Instagram's 3..10 carousel range. */
export function normalizeSlideCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 5;
  return Math.max(3, Math.min(10, Math.round(n)));
}

const CAROUSEL_SYSTEM_PROMPT = `You are a social-media designer who writes Instagram CAROUSEL scripts — short on-image text, one line per slide, built to make people swipe.

Given a post (topic + hook + body + CTA), write exactly {{N}} slides:
  - Slide 1: the HOOK — the scroll-stopper, the strongest promise/curiosity. Make them swipe.
  - Slides 2..{{N-1}}: ONE concrete, specific point each. Short. Punchy. A single idea per slide — no paragraphs. Build momentum.
  - Slide {{N}}: the CTA — tell them exactly what to do next (comment / follow / save / DM).

COHERENCE — this is the most important rule:
  - The hook in slide 1 makes a SPECIFIC promise. Every middle slide MUST pay off THAT exact promise. Do NOT drift to a different sub-topic.
  - Example of the trap to avoid: if the hook is "Your prompts are the problem, not the model", the slides must be about PROMPTS (how to write them, what to fix) — they must NOT pivot to a different fix like "connect an MCP server". Stay on the hook's thread the whole way.
  - If the provided body drifts off the hook, IGNORE the drift and keep all slides true to the hook's promise.

For EACH slide also give a "visual": a SHORT (3-8 word) concept for that slide's background image — an abstract/iconographic motif that matches the slide's point (e.g. "a stylized terminal command motif", "abstract glowing schema diagram", "a clean file-tree graphic", "split before/after panels"). No people in the visual. Vary the visual across slides so no two slides look alike.

Rules:
  - Each slide's "text" is what gets PRINTED ON the image — keep it under ~12 words, ideally under 8. No slide numbers in the text.
  - Concrete over vague. Real specifics from the post.
  - Match the post's language. 1 emoji max per slide, only if it adds punch.
  - Never use "as an AI", never refuse.

Return ONLY valid JSON, no markdown fences, no commentary:
{ "slides": [ { "text": "...", "visual": "..." }, ... exactly {{N}} items ] }`;

interface ParsedCarousel { slides?: unknown; }

export async function generateCarouselScript(input: {
  topic: string;
  hook: string;
  body: string;
  cta: string;
  language: IgWizardLanguage;
  slides: number;
}): Promise<CarouselScriptOk | CarouselScriptErr> {
  if (!hasInternalAI()) {
    return { ok: false, status: 503, error: "No internal AI provider is configured." };
  }
  const n = normalizeSlideCount(input.slides);
  const sys = CAROUSEL_SYSTEM_PROMPT.replace(/\{\{N-1\}\}/g, String(n - 1)).replace(/\{\{N\}\}/g, String(n));
  const ai = await callInternalAI({
    systemPrompt: sys,
    userPrompt: `Topic: ${input.topic || "AI tools"}\nHook: ${input.hook}\nBody: ${input.body}\nCTA: ${input.cta}\nLanguage: ${input.language}\nSlides: ${n}`,
    maxTokens: 1200,
    temperature: 0.8,
    timeoutMs: 60_000,
  });
  if (!ai.ok) return { ok: false, status: 502, error: ai.error || "AI call failed" };

  const block = extractJsonBlock(ai.text);
  let parsed: ParsedCarousel;
  try { parsed = JSON.parse(block) as ParsedCarousel; } catch { return { ok: false, status: 502, error: "AI returned invalid carousel JSON." }; }
  const slides: CarouselSlide[] = Array.isArray(parsed.slides)
    ? parsed.slides
        .map((s): CarouselSlide | null => {
          if (!s || typeof s !== "object") return null;
          const obj = s as { text?: unknown; visual?: unknown };
          const text = typeof obj.text === "string" ? obj.text.trim() : "";
          if (!text) return null;
          const visual = typeof obj.visual === "string" && obj.visual.trim() ? obj.visual.trim() : undefined;
          return { text, visual };
        })
        .filter((s): s is CarouselSlide => s !== null)
        .slice(0, n)
    : [];
  if (slides.length === 0) return { ok: false, status: 502, error: "AI returned no usable slides." };
  return { ok: true, result: { slides, model: "internal-ai" } };
}

// ─── Reel b-roll scenes ─────────────────────────────────────────────────────────

export interface ReelScenesResult { scenes: string[]; model: string; }
export interface ReelScenesOk { ok: true; result: ReelScenesResult; }
export interface ReelScenesErr { ok: false; error: string; status: 502 | 503; }

const REEL_SCENES_SYSTEM_PROMPT = `You are a cinematographer planning B-ROLL shots for a vertical short-form video.
Given the video's topic + hook + body, write {{N}} DISTINCT b-roll shot descriptions
that visually MATCH this specific content — not generic stock footage.

Rules:
  - Each scene = ONE short shot description, 6-16 words.
  - NO people, NO faces, NO hands, NO on-screen text / letters / UI labels / numbers.
  - Concrete + specific to THIS topic. Avoid generic "neon server room" unless the
    content is literally about servers. Match the IDEA: e.g. a multi-agent debate →
    several glowing panels facing each other exchanging light; self-hosting → a small
    home-lab mini PC glowing on a shelf; a prompt trick → a single command line of
    light forming and branching.
  - Cinematic, premium, dark high-tech aesthetic. Each scene clearly different.

Return ONLY valid JSON, no markdown fences, no commentary:
{ "scenes": [ "...", ... exactly {{N}} items ] }`;

/**
 * Generate N content-specific b-roll shot descriptions for a reel from the post's
 * own hook + body, so the middle of the reel matches the topic instead of looking
 * like generic stock tech footage. Falls back (caller's responsibility) to the
 * generic scene rotation if this errors.
 */
export async function generateReelScenes(input: {
  topic: string;
  hook: string;
  body: string;
  count: number;
  language: IgWizardLanguage;
}): Promise<ReelScenesOk | ReelScenesErr> {
  if (!hasInternalAI()) return { ok: false, status: 503, error: "No internal AI provider is configured." };
  const n = Math.max(1, Math.min(4, Math.round(input.count) || 1));
  const sys = REEL_SCENES_SYSTEM_PROMPT.replace(/\{\{N\}\}/g, String(n));
  const ai = await callInternalAI({
    systemPrompt: sys,
    userPrompt: `Topic: ${input.topic || "AI tools"}\nHook: ${input.hook}\nBody: ${input.body}\nLanguage: ${input.language}\nScenes: ${n}`,
    maxTokens: 600,
    temperature: 0.8,
    timeoutMs: 40_000,
  });
  if (!ai.ok) return { ok: false, status: 502, error: ai.error || "AI call failed" };

  const block = extractJsonBlock(ai.text);
  let parsed: { scenes?: unknown };
  try { parsed = JSON.parse(block) as { scenes?: unknown }; } catch { return { ok: false, status: 502, error: "AI returned invalid scenes JSON." }; }
  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()).slice(0, n)
    : [];
  if (scenes.length === 0) return { ok: false, status: 502, error: "AI returned no usable scenes." };
  return { ok: true, result: { scenes, model: "internal-ai" } };
}

// ─── 30-Day Plan ────────────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a social-media strategist who turns ONE topic into a month of Instagram content that builds an email list.

Generate a {{DAYS}}-day content plan for the given topic. Each day is a DISTINCT angle — a different lens on the same topic so the feed never feels repetitive. Rotate through frames like: educational how-to, personal story, contrarian take, behind-the-scenes, myth-bust, listicle, case study / result, common-mistake, tool spotlight, beginner question, advanced tip, comparison, prediction, quick win.

For each day return:
  - "day": the day number (1..{{DAYS}})
  - "angle": one concrete sentence describing that day's specific post idea (not generic — name the actual takeaway)
  - "hook": a scroll-stopping opening line, under 90 characters
  - "ctaType": one of "lead", "engagement", "growth" — which CTA fits this post best

Distribution of ctaType across the {{DAYS}} days: roughly 30% "lead" (the email-list/DM-funnel days), 40% "engagement", 30% "growth". Don't make every day a lead-magnet — that burns the audience.

Rules:
  - Each angle + hook must be genuinely different from the others. No near-duplicates.
  - Match the requested language ("en" or "de"). For "de" write fluent native German.
  - 1 emoji max per hook. Never use "as an AI", never refuse.

Return ONLY valid JSON, no markdown fences, no commentary:
{ "briefs": [ { "day": 1, "angle": "...", "hook": "...", "ctaType": "lead" }, ... {{DAYS}} items ] }`;

interface ParsedPlan {
  briefs?: unknown;
}

function normalizeCtaType(raw: unknown): PlanCtaType {
  if (raw === "lead" || raw === "engagement" || raw === "growth") return raw;
  return "engagement";
}

function parsePlan(raw: string, days: number): PlanBrief[] | null {
  const block = extractJsonBlock(raw);
  let parsed: ParsedPlan;
  try {
    parsed = JSON.parse(block) as ParsedPlan;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.briefs)) return null;
  const briefs: PlanBrief[] = [];
  for (const item of parsed.briefs) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const angle = typeof o.angle === "string" ? o.angle.trim() : "";
    const hook = typeof o.hook === "string" ? o.hook.trim() : "";
    if (!angle && !hook) continue;
    briefs.push({
      // Re-number sequentially so a missing/garbled day field never leaves holes.
      day: briefs.length + 1,
      angle,
      hook,
      ctaType: normalizeCtaType(o.ctaType),
    });
    if (briefs.length >= days) break;
  }
  return briefs.length > 0 ? briefs : null;
}

/** Clamp the requested day count to a sane 1..30 range. */
export function normalizePlanDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(30, Math.round(n)));
}

/**
 * Generate a multi-day Instagram content plan from one topic. Each day is a
 * light brief (angle + hook + ctaType) — expand any of them into a full caption
 * via generateCaption / the Caption Composer.
 */
export async function generatePlan(input: {
  topic: string;
  language: IgWizardLanguage;
  days: number;
}): Promise<PlanGenerateOk | PlanGenerateErr> {
  if (!hasInternalAI()) {
    return {
      ok: false,
      status: 503,
      error: "No internal AI provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings.",
    };
  }

  const days = normalizePlanDays(input.days);
  const ai = await callInternalAI({
    systemPrompt: PLAN_SYSTEM_PROMPT.replace(/\{\{DAYS\}\}/g, String(days)),
    userPrompt: `Topic: ${input.topic || "AI tools for solo creators"}\nLanguage: ${input.language}\nDays: ${days}`,
    maxTokens: 4000,
    temperature: 0.9,
    timeoutMs: 90_000,
  });

  if (!ai.ok) {
    return { ok: false, status: 502, error: ai.error || "AI call failed" };
  }

  const briefs = parsePlan(ai.text, days);
  if (!briefs) {
    return {
      ok: false,
      status: 502,
      error: "AI returned an invalid plan. Try again — the model occasionally adds prose around the JSON block.",
    };
  }

  return {
    ok: true,
    result: {
      topic: input.topic || "(empty)",
      language: input.language,
      briefs,
      model: "internal-ai",
    },
  };
}
