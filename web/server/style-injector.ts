// ─── Persona Style Injector ──────────────────────────────────────────────────
// Scans a free-text task description for known SocialView persona references
// (display name or handle) and produces a binding "STIL-PROFIL"-block that
// downstream agents (Content Agent etc.) can apply as hard rules.
//
// Used by `run_agent` executor to enrich the task automatically — neither
// Hank nor the agent need to remember to load the profile.

import { listProfiles } from "./socialview/style-profiles.js";
import type { StyleProfile } from "./socialview/types.js";

/**
 * Find personas mentioned in `text`. A persona matches if its handle OR
 * display-name (case-insensitive, multi-token) appears in the text.
 * Returns the matched profiles, deduped, ordered by length of the matched
 * token (longer = more specific match wins).
 */
function findMentionedPersonas(text: string): StyleProfile[] {
  if (!text || !text.trim()) return [];
  const haystack = text.toLowerCase();
  const profiles = listProfiles();
  const hits: Array<{ profile: StyleProfile; matchLen: number }> = [];
  const seen = new Set<string>();

  for (const p of profiles) {
    const key = `${p.platform}:${p.handle.toLowerCase()}`;
    if (seen.has(key)) continue;

    const candidates: string[] = [];
    if (p.handle) candidates.push(p.handle.toLowerCase());
    if (p.displayName) {
      const dn = p.displayName.toLowerCase().trim();
      if (dn && dn !== p.handle.toLowerCase()) {
        candidates.push(dn);
        // Also try last-name only (e.g. "remsik" matches "rene remsik")
        const tokens = dn.split(/\s+/).filter((t) => t.length >= 4);
        if (tokens.length > 1) candidates.push(tokens[tokens.length - 1]!);
      }
    }

    for (const c of candidates) {
      // Word-boundary check so "rene" in "renewable" doesn't match.
      const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(haystack)) {
        hits.push({ profile: p, matchLen: c.length });
        seen.add(key);
        break;
      }
    }
  }

  hits.sort((a, b) => b.matchLen - a.matchLen);
  return hits.map((h) => h.profile);
}

/**
 * Render a single profile as a markdown block with binding rules. Designed
 * to be appended verbatim to an agent task so the LLM treats it as
 * authoritative.
 */
function renderProfileBlock(p: StyleProfile): string {
  const lines: string[] = [];
  lines.push(`## STIL-PROFIL: ${p.displayName || p.handle} (@${p.handle} auf ${p.platform})`);
  lines.push("");
  lines.push("DIESE REGELN SIND BINDEND und überschreiben die Plattform-Defaults im System-Prompt:");
  lines.push("");
  lines.push(`- **Tonfall**: ${p.toneOfVoice || "(nicht spezifiziert)"}`);
  lines.push(`- **Länge**: ${p.lengthCategory} (Ø ${p.averageWordCount} Wörter)`);
  lines.push(`- **Hashtag-Stil**: ${p.hashtagStyle}${p.hashtagStyle === "keine" ? " — VERWENDE KEINE HASHTAGS, auch wenn der Plattform-Default welche vorschlägt" : ""}`);
  lines.push(`- **Emoji-Stil**: ${p.emojiStyle}${p.emojiStyle === "keine" ? " — VERWENDE KEINE EMOJIS" : ""}`);

  if (p.hookPatterns.length > 0) {
    const top = p.hookPatterns.slice().sort((a, b) => b.frequency - a.frequency).slice(0, 3);
    lines.push(`- **Bevorzugte Hooks** (verwende einen davon, NICHT die Standard-Hook-Liste):`);
    for (const h of top) {
      const ex = h.examples[0] ? ` — z.B. "${h.examples[0].slice(0, 100)}"` : "";
      lines.push(`  - ${h.type}${ex}`);
    }
  }

  if (p.ctaPatterns.length > 0) {
    const top = p.ctaPatterns.slice().sort((a, b) => b.frequency - a.frequency).slice(0, 2);
    lines.push(`- **CTA-Muster**:`);
    for (const c of top) {
      const ex = c.examples[0] ? ` — z.B. "${c.examples[0].slice(0, 100)}"` : "";
      lines.push(`  - ${c.type}${ex}`);
    }
  }

  if (p.contentPillars.length > 0) {
    lines.push(`- **Content-Säulen**: ${p.contentPillars.join(", ")}`);
  }

  if (p.commentEngagementPattern && p.commentEngagementPattern.trim()) {
    lines.push(`- **Eigenkommentar-Pattern**: ${p.commentEngagementPattern}`);
  }

  if (p.visualStyle && p.visualStyle.trim()) {
    lines.push("");
    lines.push("### Visueller Stil (für Bildgenerierung)");
    lines.push(p.visualStyle);
  }

  if (p.rawAnalysis && p.rawAnalysis.trim()) {
    lines.push("");
    lines.push("### Gesamteinschätzung");
    lines.push(p.rawAnalysis);
  }

  return lines.join("\n");
}

/**
 * Public entry: given a task text, return a string that should be APPENDED
 * to the task. Empty string if no persona is mentioned.
 */
export function buildStyleProfileBlockFromText(text: string): string {
  const matches = findMentionedPersonas(text);
  if (matches.length === 0) return "";
  // Cap to top 2 to keep the prompt focused.
  const blocks = matches.slice(0, 2).map(renderProfileBlock);
  return [
    "",
    "---",
    "",
    "# AUTOMATISCH ERKANNTE PERSONA-REFERENZ",
    "",
    "Der User hat oben eine Persona genannt. Wende das folgende Profil als",
    "BINDENDE Schreib- und Bildregel an. Die Profil-Regeln gewinnen IMMER",
    "gegen die Plattform-Defaults im System-Prompt (z.B. Hashtag-Anzahl,",
    "Hook-Liste, Emoji-Verwendung).",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
