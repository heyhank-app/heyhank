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
