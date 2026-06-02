// Instagram Wizard HTTP route. Thin wrapper around the shared generation
// logic in `../ig-wizard.ts` — kept tiny so the same code path can also be
// used by the MCP server (web/server/mcp/ig-wizard-mcp-server.ts).

import type { Hono } from "hono";
import {
  generateIgWizard,
  generateCaption,
  generatePlan,
  generateCarouselScript,
  assembleCaption,
  normalizeLanguage,
  normalizeNiche,
  normalizeTopic,
  normalizeOptionalLine,
  normalizePlanDays,
  normalizeSlideCount,
} from "../ig-wizard.js";
import { generateIgCover, normalizeStyle } from "../ig-cover.js";
import { researchTopic, briefToGroundingText } from "../research.js";
import * as socialManager from "../socialmedia/manager.js";
import type { SocialPlatform } from "../socialmedia/types.js";
import * as wizardPosts from "../ig-wizard-posts.js";
import { generateVeoGoogle, pollVeoGoogle } from "../fal-video.js";
import { generateTts } from "../gemini-tts.js";
import { composeReel, type TextOverlay } from "../video-compose.js";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { HEYHANK_HOME } from "../paths.js";

const WIZARD_MEDIA_DIR = join(HEYHANK_HOME, "media");

/** Resolve an /api/media/file/<name> URL back to its local path (or null). */
function mediaUrlToLocalPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const name = basename(url);
  const p = join(WIZARD_MEDIA_DIR, name);
  return existsSync(p) ? p : null;
}

function mediaPathToUrl(absPath: string): string {
  return `/api/media/file/${basename(absPath)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const VALID_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "twitter", "linkedin", "tiktok", "threads"];

function coercePlatforms(raw: unknown): SocialPlatform[] {
  if (!Array.isArray(raw)) return ["instagram"];
  const out = raw.filter((p): p is SocialPlatform => typeof p === "string" && VALID_PLATFORMS.includes(p as SocialPlatform));
  return out.length > 0 ? out : ["instagram"];
}

export function registerIgWizardRoutes(api: Hono): void {
  api.post("/ig-wizard/generate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { niche?: unknown; language?: unknown };
    const niche = normalizeNiche(body.niche);
    const lang = normalizeLanguage(body.language);

    const res = await generateIgWizard(niche, lang);
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json(res.result);
  });

  // Research a topic into a grounded Content Brief (live web search tuned for
  // fresh AI news + the local vault for Markus's own POV). The wizard shows this
  // before composing so captions cite real, current specifics instead of fluff.
  api.post("/ig-wizard/research", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: unknown;
      niche?: unknown;
      language?: unknown;
      forceRefresh?: unknown;
    };
    const res = await researchTopic({
      topic: normalizeTopic(body.topic),
      niche: normalizeNiche(body.niche),
      language: normalizeLanguage(body.language),
      forceRefresh: body.forceRefresh === true,
    });
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.brief);
  });

  // Compose a complete, ready-to-post caption from a topic (+ optional pre-picked
  // hook / CTA). Reuses the same internal-AI provider as /generate.
  //
  // Grounding ("beides wählbar"): the caller can either pass a pre-built
  // `grounding` string (manual flow — research, edit, then compose) OR set
  // `autoResearch: true` to research inline. A research failure never blocks the
  // caption — it just composes ungrounded.
  api.post("/ig-wizard/caption", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: unknown;
      niche?: unknown;
      language?: unknown;
      hook?: unknown;
      cta?: unknown;
      grounding?: unknown;
      autoResearch?: unknown;
    };
    const topic = normalizeTopic(body.topic);
    const language = normalizeLanguage(body.language);

    let grounding = typeof body.grounding === "string" ? body.grounding.trim() : "";
    let grounded = grounding.length > 0;
    if (!grounding && body.autoResearch === true) {
      const research = await researchTopic({ topic, niche: normalizeNiche(body.niche), language });
      if (research.ok && research.brief) {
        grounding = briefToGroundingText(research.brief);
        grounded = grounding.length > 0;
      }
    }

    const res = await generateCaption({
      topic,
      language,
      hook: normalizeOptionalLine(body.hook),
      cta: normalizeOptionalLine(body.cta),
      grounding: grounding || undefined,
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ ...res.result, grounded });
  });

  // Generate a multi-day content plan (light briefs) from one topic. Each brief
  // expands into a full caption via /ig-wizard/caption.
  api.post("/ig-wizard/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: unknown;
      language?: unknown;
      days?: unknown;
    };
    const res = await generatePlan({
      topic: normalizeTopic(body.topic),
      language: normalizeLanguage(body.language),
      days: normalizePlanDays(body.days),
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json(res.result);
  });

  // ─── Wizard Saved Posts (the persistent workbench) ──────────────────────

  /** List all saved wizard posts (newest first). Restores across restarts. */
  api.get("/ig-wizard/posts", (c) => {
    return c.json({ posts: wizardPosts.listPosts() });
  });

  /** Auto-save a composed caption as a wizard post. */
  api.post("/ig-wizard/posts", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.caption !== "string" || !b.caption.trim()) {
      return c.json({ error: "caption is required" }, 400);
    }
    const post = wizardPosts.createPost({
      topic: typeof b.topic === "string" ? b.topic : "",
      hook: typeof b.hook === "string" ? b.hook : "",
      body: typeof b.body === "string" ? b.body : "",
      cta: typeof b.cta === "string" ? b.cta : "",
      hashtags: Array.isArray(b.hashtags) ? b.hashtags.filter((h): h is string => typeof h === "string") : [],
      caption: b.caption,
      source: b.source === "plan" ? "plan" : "single",
      platforms: coercePlatforms(b.platforms),
      hero: typeof b.hero === "string" ? b.hero : undefined,
      style: typeof b.style === "string" ? b.style : undefined,
      day: typeof b.day === "number" ? b.day : undefined,
    });
    return c.json({ ok: true, post }, 201);
  });

  /** Update a wizard post (edited hook/body/cta/caption/platforms). */
  api.patch("/ig-wizard/posts/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const f of ["topic", "hook", "body", "cta", "caption", "hero"] as const) {
      if (typeof b[f] === "string") patch[f] = b[f];
    }
    if (Array.isArray(b.hashtags)) patch.hashtags = b.hashtags.filter((h): h is string => typeof h === "string");
    if (b.platforms !== undefined) patch.platforms = coercePlatforms(b.platforms);
    const post = wizardPosts.updatePost(c.req.param("id"), patch as Parameters<typeof wizardPosts.updatePost>[1]);
    if (!post) return c.json({ error: "not found" }, 404);
    return c.json(post);
  });

  api.delete("/ig-wizard/posts/:id", (c) => {
    const ok = wizardPosts.removePost(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  /** Bulk delete — curate the workbench down to the targeted posts. */
  api.post("/ig-wizard/posts/bulk-delete", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
    const removed = wizardPosts.bulkRemove(ids);
    return c.json({ ok: true, removed });
  });

  /** Generate (or regenerate) the branded image for a saved post + attach it. */
  api.post("/ig-wizard/posts/:id/image", async (c) => {
    const post = wizardPosts.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { hero?: unknown; style?: unknown; cap?: unknown };
    const style = normalizeStyle(typeof b.style === "string" ? b.style : post.style);
    const cap = typeof b.cap === "boolean" ? b.cap : post.cap !== false;
    try {
      const image = await generateIgCover({
        headline: post.hook || post.topic,
        badge: "Built with AI",
        hero: (typeof b.hero === "string" ? b.hero : post.hero) || "notebook",
        style,
        cap,
      });
      const updated = wizardPosts.updatePost(post.id, {
        format: "post",
        imageUrl: image.url,
        imageFilename: image.filename,
        hero: typeof b.hero === "string" ? b.hero : post.hero,
        style,
        cap,
      });
      return c.json({ ok: true, post: updated, image });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** Generate a branded CAROUSEL for a saved post: an AI slide-script rendered
      as N Style-A images (generated in parallel). Sets format=carousel. */
  api.post("/ig-wizard/posts/:id/carousel", async (c) => {
    const post = wizardPosts.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { slides?: unknown; hero?: unknown; style?: unknown; cap?: unknown };
    const slideCount = normalizeSlideCount(b.slides);
    const style = normalizeStyle(typeof b.style === "string" ? b.style : post.style);
    const cap = typeof b.cap === "boolean" ? b.cap : post.cap !== false;

    const script = await generateCarouselScript({
      topic: post.topic,
      hook: post.hook,
      body: post.body,
      cta: post.cta,
      language: normalizeLanguage(undefined),
      slides: slideCount,
    });
    if (!script.ok) return c.json({ error: script.error }, script.status);

    const hero = (typeof b.hero === "string" ? b.hero : post.hero) || "notebook";
    try {
      // Render every slide in parallel — N gpt-image-2 calls at once keeps the
      // whole carousel near single-image latency instead of N×.
      const images = await Promise.all(
        script.result.slides.map((s) => generateIgCover({ headline: s.text, badge: "Built with AI", hero, style, cap })),
      );
      const updated = wizardPosts.updatePost(post.id, {
        format: "carousel",
        mediaUrls: images.map((i) => i.url),
        imageUrl: images[0]?.url ?? post.imageUrl,
        hero,
        style,
        cap,
      });
      return c.json({ ok: true, post: updated, slides: script.result.slides, mediaUrls: images.map((i) => i.url) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** Generate a REEL for a saved post: Veo makes a silent vertical clip (its
      first frame = the post's branded cover, locking identity/continuity), then
      Gemini TTS voices the hook+CTA and the compositor lays the voiceover over
      the muted video. Long (~1-3 min): Veo is async + polled server-side. */
  api.post("/ig-wizard/posts/:id/reel", async (c) => {
    const post = wizardPosts.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { durationSeconds?: unknown; voice?: unknown };
    const duration = (b.durationSeconds === 4 || b.durationSeconds === 6 || b.durationSeconds === 8 ? b.durationSeconds : 8) as 4 | 6 | 8;

    try {
      // 1) Veo — silent vertical clip. Keep the prompt visual-only (no person
      //    description, no dialogue quotes) so it stays mute + dodges the audio
      //    safety filter; the cover image conditions the first frame.
      const firstFrame = mediaUrlToLocalPath(post.imageUrl);
      const veoPrompt = buildReelVeoPrompt(post.topic);
      const { operationName } = await generateVeoGoogle({
        prompt: veoPrompt,
        aspectRatio: "9:16",
        durationSeconds: duration,
        ...(firstFrame ? { firstFrameImagePath: firstFrame, mode: "firstFrame" as const } : {}),
      });

      // 2) Poll Veo until done (server-side; nginx /api/ allows 600s).
      let veoPath: string | undefined;
      for (let i = 0; i < 60; i++) {
        const op = await pollVeoGoogle(operationName);
        if (op.error) throw new Error(`Veo failed: ${op.error}`);
        if (op.done) { veoPath = op.videoPath; break; }
        await sleep(5000);
      }
      if (!veoPath) throw new Error("Veo timed out (>5 min)");

      // 3) Gemini TTS voiceover — hook + body + CTA so the speech fills the clip
      //    (the compositor trims to the audio length, so too-short VO = too-short
      //    reel). Capped so a long body doesn't run way past the video.
      const voText = `${post.hook}. ${post.body} ${post.cta}`.replace(/\s+/g, " ").trim().slice(0, 600);
      // Charon = the reel narrator (deliberately NOT an impersonation of Markus —
      // the face/brand is visual, the voice is a neutral third-person narrator).
      const tts = await generateTts({ text: voText, voice: "Charon", style: "Narrate in a clear, confident voice:" });

      // 4) Compose: muted Veo video + the voiceover + burned-in timed captions
      //    (hook → body → CTA) so the reel reads as content, not blank b-roll.
      const captions = buildReelCaptions(post, duration);
      const composed = await composeReel({
        segments: [{
          type: "video",
          path: veoPath,
          durationSeconds: duration,
          replaceAudio: true,
          audioPath: tts.audioPath,
          textOverlays: captions,
        }],
        outputName: `wizard_reel_${post.id.slice(0, 8)}`,
      });
      const videoUrl = mediaPathToUrl(composed.videoPath);

      const updated = wizardPosts.updatePost(post.id, {
        format: "reel",
        videoUrl,
        thumbnailUrl: post.imageUrl ?? null,
      });
      return c.json({ ok: true, post: updated, videoUrl });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** Promote a saved wizard post into the social-media drafts (publish queue). */
  api.post("/ig-wizard/posts/:id/to-draft", async (c) => {
    const post = wizardPosts.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    const { draft, post: updated } = await promotePostToDraft(post);
    return c.json({ ok: true, draft, post: updated });
  });

  /** Promote MANY saved posts to drafts at once. Per-id results so a single
      failure doesn't sink the batch. */
  api.post("/ig-wizard/posts/bulk-to-draft", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
    const results: Array<{ id: string; ok: boolean; draftId?: string; error?: string }> = [];
    for (const id of ids) {
      const post = wizardPosts.getPost(id);
      if (!post) { results.push({ id, ok: false, error: "not found" }); continue; }
      try {
        const { draft } = await promotePostToDraft(post);
        results.push({ id, ok: true, draftId: draft.id });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({ ok: true, promoted: results.filter((r) => r.ok).length, results });
  });
}

/** Shared promote logic: build a clean draft from a wizard post + tag the post.
    Format-aware — carousel sends the slide array, reel sends the video. */
async function promotePostToDraft(post: wizardPosts.WizardPost) {
  // Clean body (no inline hashtags); hashtags → IG first comment.
  const text = assembleCaption({ hook: post.hook, body: post.body, cta: post.cta, hashtags: [] });
  const firstComment = post.hashtags.length ? post.hashtags.map((h) => `#${h}`).join(" ") : undefined;
  const format = post.format ?? "post";

  let mediaUrls: string[] = [];
  let videoUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  if (format === "carousel") {
    mediaUrls = post.mediaUrls && post.mediaUrls.length ? post.mediaUrls : post.imageUrl ? [post.imageUrl] : [];
  } else if (format === "reel") {
    videoUrl = post.videoUrl ?? undefined;
    thumbnailUrl = post.thumbnailUrl ?? undefined;
  } else {
    mediaUrls = post.imageUrl ? [post.imageUrl] : [];
  }

  const draft = await socialManager.createDraft({
    text,
    platforms: coercePlatforms(post.platforms),
    mediaUrls,
    videoUrl,
    thumbnailUrl,
    firstComment,
    format,
    isDraft: true,
    createdBy: "agent",
  });
  const updated = wizardPosts.updatePost(post.id, { promotedDraftId: draft.id });
  return { draft, post: updated };
}

// ─── Reel helpers ────────────────────────────────────────────────────────────

/**
 * Strip emoji + pictographs from on-screen caption text. The reel font
 * (Lato-Bold) has no emoji glyphs, so they render as tofu "?" boxes — clean
 * them out for burned-in captions (the voiceover/caption text keeps them).
 */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split prose into sentences for caption chunking. */
function splitSentences(text: string): string[] {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build time-sequenced burned-in captions for a reel from the post's caption.
 * A blank B-roll clip reads as filler; on-screen text is what makes a reel land.
 * The hook opens centered + large, then body sentences + the CTA scroll along
 * the bottom in sync with the Charon voiceover (which speaks the same text).
 */
export function buildReelCaptions(
  post: Pick<wizardPosts.WizardPost, "hook" | "body" | "cta">,
  duration: number,
): TextOverlay[] {
  const hook = stripEmoji(post.hook ?? "");
  const cta = stripEmoji(post.cta ?? "");
  const bodyLines = splitSentences(post.body).map(stripEmoji).filter((s) => s.length > 0);

  // Keep each caption on screen long enough to read (≥1.3s).
  const maxLines = Math.max(1, Math.floor(duration / 1.3));

  // Hook and CTA are the load-bearing lines (the hook stops the scroll, the CTA
  // drives the funnel) — always keep them and trim the body middle to fit,
  // rather than letting a long body push the CTA off the end.
  const chosen: Array<{ text: string; kind: "hook" | "body" | "cta" }> = [];
  if (hook) chosen.push({ text: hook, kind: "hook" });
  if (cta) chosen.push({ text: cta, kind: "cta" }); // reserved; moved to the end below
  const bodyBudget = Math.max(0, maxLines - chosen.length);
  const bodyChosen = bodyLines.slice(0, bodyBudget).map((text) => ({ text, kind: "body" as const }));
  // Order: hook → body → cta.
  const ordered = [
    ...chosen.filter((l) => l.kind === "hook"),
    ...bodyChosen,
    ...chosen.filter((l) => l.kind === "cta"),
  ];
  if (!ordered.length) return [];
  const slice = duration / ordered.length;

  return ordered.map((line, i) => {
    const start = +(i * slice).toFixed(2);
    const end = +((i + 1) * slice).toFixed(2);
    if (line.kind === "hook") {
      return { text: line.text, position: "center" as const, fontSize: 52, color: "#ffffff",
        bgColor: "black", bgPadding: 22, bold: true, maxWidth: 600, lineHeight: 1.2,
        startSeconds: start, endSeconds: end };
    }
    if (line.kind === "cta") {
      // Centered (not bottom-anchored) so a wrapped 2-3 line CTA never clips off
      // the bottom edge. Orange box = the funnel call-to-action.
      return { text: line.text, position: "center" as const, fontSize: 46, color: "#ffffff",
        bgColor: "#c2410c", bgPadding: 20, bold: true, maxWidth: 600, lineHeight: 1.2,
        startSeconds: start, endSeconds: end };
    }
    return { text: line.text, position: "center" as const, fontSize: 42, color: "#ffffff",
      bgColor: "black", bgPadding: 18, bold: true, maxWidth: 620, lineHeight: 1.2,
      startSeconds: start, endSeconds: end };
  });
}

/**
 * A topic-aware visual prompt for the silent Veo b-roll. Stays visual-only (no
 * person, no dialogue, no on-screen text — we burn clean captions ourselves) so
 * it dodges the audio-safety filter, but is themed to the post instead of a
 * single hardcoded cozy-laptop scene that looked identical for every reel.
 */
export function buildReelVeoPrompt(topic: string): string {
  const t = (topic || "").trim();
  const theme = t
    ? `B-roll for a short video about "${t}". `
    : "";
  return (
    `Vertical 9:16 cinematic b-roll. ${theme}` +
    "Modern, energetic tech atmosphere: glowing screens and terminal windows, " +
    "server status LEDs, code and dashboards reflecting on a clean desk, dynamic " +
    "rim lighting, subtle particle/bokeh, a smooth dolly camera move. Premium " +
    "editorial color grade, high contrast, fast premium product-film feel. " +
    "No on-screen text, no captions, no subtitles, no logos, no watermark."
  );
}
