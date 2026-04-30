// ─── Style Analyzer ──────────────────────────────────────────────────────────
// Distills a writing-style profile from all library posts of a given handle.
// One LLM call: read all posts of <handle> on <platform>, return a structured
// `StyleProfile`. The result is saved via `style-profiles.ts` and consumed by
// `content-engine.ts` when generating new posts in that handle's style.

import { randomUUID } from "node:crypto";
import { callClaudeCodeHeadless } from "../claude-code-worker.js";
import { backfillImageDescriptions } from "./image-describe.js";
import { listPosts } from "./library.js";
import { saveProfile } from "./style-profiles.js";
import type { LibraryPost, SocialPlatform, StyleProfile } from "./types.js";

/**
 * Analyze all library posts for a single handle on a platform and produce a
 * `StyleProfile`. Saves the profile to disk before returning.
 *
 * Throws if the library has no posts for this handle (caller should surface
 * "extract some posts first").
 */
export async function analyzeHandleStyle(
  platform: SocialPlatform,
  handle: string,
): Promise<StyleProfile> {
  const allOnPlatform = listPosts({ platform });
  const posts = allOnPlatform.filter(
    (p) => p.author.handle.toLowerCase() === handle.toLowerCase(),
  );
  if (posts.length === 0) {
    throw new Error(`No library posts found for ${platform}/${handle}`);
  }

  const displayName = posts[0]!.author.displayName ?? handle;

  const llmProfile = await runLlmAnalysis(posts, platform, handle);

  const now = new Date().toISOString();
  const profile: StyleProfile = {
    id: randomUUID(),
    platform,
    handle,
    displayName,
    basedOnPostCount: posts.length,
    basedOnPostIds: posts.map((p) => p.id),
    averageWordCount: avgWordCount(posts),
    lengthCategory: classifyLength(avgWordCount(posts)),
    hookPatterns: llmProfile.hookPatterns,
    ctaPatterns: llmProfile.ctaPatterns,
    emojiStyle: llmProfile.emojiStyle,
    emojiList: llmProfile.emojiList,
    hashtagStyle: llmProfile.hashtagStyle,
    contentPillars: llmProfile.contentPillars,
    toneOfVoice: llmProfile.toneOfVoice,
    commentEngagementPattern: llmProfile.commentEngagementPattern,
    visualStyle: llmProfile.visualStyle,
    rawAnalysis: llmProfile.rawAnalysis,
    createdAt: now,
    updatedAt: now,
  };

  saveProfile(profile);
  return profile;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function avgWordCount(posts: LibraryPost[]): number {
  if (posts.length === 0) return 0;
  const total = posts.reduce((sum, p) => sum + p.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.round(total / posts.length);
}

function classifyLength(avg: number): "kompakt" | "mittel" | "lang" {
  if (avg < 60) return "kompakt";
  if (avg < 200) return "mittel";
  return "lang";
}

interface LlmStyleResult {
  hookPatterns: StyleProfile["hookPatterns"];
  ctaPatterns: StyleProfile["ctaPatterns"];
  emojiStyle: StyleProfile["emojiStyle"];
  emojiList: string[];
  hashtagStyle: StyleProfile["hashtagStyle"];
  contentPillars: string[];
  toneOfVoice: string;
  commentEngagementPattern: string;
  visualStyle: string;
  rawAnalysis: string;
}

async function runLlmAnalysis(
  posts: LibraryPost[],
  platform: SocialPlatform,
  handle: string,
): Promise<LlmStyleResult> {
  // Slice posts to keep the prompt manageable. 25 posts × ~800 chars ≈ 20K
  // chars — well within Sonnet's window. Pick highest-engagement first if
  // there are more than that many; otherwise take everything.
  const SAMPLE_LIMIT = 25;
  const sample = posts
    .slice() // don't mutate caller
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, SAMPLE_LIMIT);

  // Backfill missing image descriptions via Claude Code Subscription. Persists
  // results back to the library so subsequent persona runs are fast.
  await backfillImageDescriptions(sample);

  const formattedPosts = sample
    .map((p, i) => {
      const lines: string[] = [`### Post ${i + 1}`];
      if (p.engagementRate !== null) lines.push(`engagement_rate: ${p.engagementRate.toFixed(3)}`);
      if (p.postType) lines.push(`type: ${p.postType}`);
      // text already has [Eigener Kommentar] markers from extractor
      lines.push(`text: ${p.text}`);
      if (p.hashtags.length) lines.push(`hashtags: ${p.hashtags.map((h) => "#" + h).join(" ")}`);
      const visual = p.media.find((m) => m.description)?.description;
      if (visual) lines.push(`visual: ${visual.slice(0, 240)}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const prompt = `Analysiere die folgenden ${sample.length} Posts von **${handle}** auf ${platform} und destilliere daraus ein strukturiertes Stil-Profil. Achte besonders auf wiederkehrende Muster, nicht auf einzelne Inhalte.

POSTS:
${formattedPosts}

Wichtig: Posts enthalten teilweise [Eigener Kommentar]-Blöcke. Das sind Antworten/Ergänzungen, die der Autor selbst unter seinem Post geschrieben hat — extrem wertvoll für das Feld "commentEngagementPattern".

Antworte mit GENAU diesem JSON (kein Markdown, keine Erklärung):
{
  "hookPatterns": [
    { "type": "Kurzlabel z.B. 'rhetorische Frage', 'mutige These', 'Story-Opener', 'Statistik'", "frequency": 0.0_bis_1.0, "examples": ["beispielhafter Hook 1 (max 100 Zeichen)", "..."] }
  ],
  "ctaPatterns": [
    { "type": "Label z.B. 'Frage am Ende', 'Link in Bio', 'Kommentar-Aufforderung', 'kein expliziter CTA'", "frequency": 0.0_bis_1.0, "examples": ["..."] }
  ],
  "emojiStyle": "keine|sparsam|moderat|dicht",
  "emojiList": ["✨", "💪"],
  "hashtagStyle": "keine|wenige|viele",
  "contentPillars": ["3-6 Hauptthemen, jeweils 1-3 Worte"],
  "toneOfVoice": "Fließtext (1-2 Sätze) der die Stimme beschreibt: direkt/indirekt, formell/casual, motivational/sachlich, Du/Sie, etc.",
  "commentEngagementPattern": "Fließtext (1-2 Sätze): Was macht der Autor unter seinen eigenen Posts? Antwortet mit Frage zurück? Ergänzt CTA? Erklärt nach? Falls keine Eigenkommentare in den Posts: leerer String.",
  "visualStyle": "Fließtext (3-5 Sätze): Synthese der visuellen Patterns über alle Posts hinweg, basierend auf den 'visual:'-Beschreibungen oben. Komposition, Farbpalette, wiederkehrende Overlay-/Branding-Muster, Stilkategorie (Foto vs. Grafik vs. Meme), Produktionsqualität. Ein Imitator soll daraus ableiten können wie ein passendes neues Bild aussehen muss. Falls keine Bilder beschrieben: leerer String.",
  "rawAnalysis": "3-5 Sätze Fließtext-Zusammenfassung: Wie schreibt diese Person? Was unterscheidet sie? Was sollte ein Imitator beachten?"
}`;

  // Run via Claude Code Subscription (no Anthropic API charges) — no fallback.
  const result = await callClaudeCodeHeadless({
    systemPrompt:
      "Du bist ein Linguist und Social-Media-Stilanalytiker. Du destillierst aus konkreten Posts wiederkehrende Schreib-Muster (Hooks, CTAs, Tonfall, Engagement-Tricks). Antworte ausschließlich mit validem JSON, keine Markdown-Fences, keine Erklärung.",
    userPrompt: prompt,
    model: "sonnet",
    timeoutMs: 180_000,
  });

  if (!result.ok || !result.text) {
    throw new Error(`Style analysis failed: ${"error" in result ? result.error : "no output"}`);
  }

  let jsonText = result.text.trim();
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonText = fence[1].trim();

  let parsed: Partial<LlmStyleResult>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Style analysis returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    hookPatterns: Array.isArray(parsed.hookPatterns) ? parsed.hookPatterns : [],
    ctaPatterns: Array.isArray(parsed.ctaPatterns) ? parsed.ctaPatterns : [],
    emojiStyle: parsed.emojiStyle ?? "moderat",
    emojiList: Array.isArray(parsed.emojiList) ? parsed.emojiList : [],
    hashtagStyle: parsed.hashtagStyle ?? "wenige",
    contentPillars: Array.isArray(parsed.contentPillars) ? parsed.contentPillars : [],
    toneOfVoice: parsed.toneOfVoice ?? "",
    commentEngagementPattern: parsed.commentEngagementPattern ?? "",
    visualStyle: parsed.visualStyle ?? "",
    rawAnalysis: parsed.rawAnalysis ?? "",
  };
}
