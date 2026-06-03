// Instagram Wizard HTTP route. Thin wrapper around the shared generation
// logic in `../ig-wizard.ts` — kept tiny so the same code path can also be
// used by the MCP server (web/server/mcp/ig-wizard-mcp-server.ts).

import type { Hono } from "hono";
import {
  generateIgWizard,
  generateCaption,
  adaptInspiration,
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
import { generateIgCover, normalizeStyle, generateReelHookImage, normalizeHookSetting, generateConceptSlide, conceptAccent } from "../ig-cover.js";
import { researchTopic, briefToGroundingText } from "../research.js";
import * as socialManager from "../socialmedia/manager.js";
import type { SocialPlatform } from "../socialmedia/types.js";
import * as wizardPosts from "../ig-wizard-posts.js";
import * as inspiration from "../ig-inspiration.js";
import { generateVeoGoogle, pollVeoGoogle } from "../fal-video.js";
import { generateTts } from "../gemini-tts.js";
import { composeReel, type TextOverlay, type LogoOverlay } from "../video-compose.js";
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

/** Probe an audio/video file's duration in seconds via ffprobe (0 on failure). */
async function probeDurationSeconds(path: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise<number>((resolve) => {
    const ff = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
    let out = "";
    ff.stdout.on("data", (d) => { out += d; });
    ff.on("close", () => resolve(parseFloat(out.trim()) || 0));
    ff.on("error", () => resolve(0));
  });
}

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
      // Slide variety: the FIRST slide (hook) and the LAST slide (CTA) feature
      // Markus (identity-locked edit). The MIDDLE slides are person-free concept
      // slides — a distinct accent + thematic visual per slide — so the carousel
      // doesn't read as "the same photo 5 times with different captions".
      const slides = script.result.slides;
      const lastIdx = slides.length - 1;
      const images = await Promise.all(
        slides.map((s, i) => {
          const isClonedSlide = i === 0 || i === lastIdx;
          if (isClonedSlide) {
            return generateIgCover({ headline: s.text, badge: "Built with AI", hero, style, cap });
          }
          return generateConceptSlide({ headline: s.text, visual: s.visual, badge: "Built with AI", accent: conceptAccent(i) });
        }),
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
    const body = (await c.req.json().catch(() => ({}))) as { hookIntro?: unknown; hookSetting?: unknown };
    // Branded presenter hook intro is on by default; the setting (studio, desk,
    // cafe, outdoor, loft) is the user's choice — it doesn't have to be a studio.
    const hookIntro = body.hookIntro !== false;
    const hookSetting = normalizeHookSetting(body.hookSetting);

    try {
      // 1) Voiceover FIRST — its length drives the reel length so the whole
      //    narration plays (an 8s clip would cut a 40s VO off after one line).
      //    Charon = the reel narrator (deliberately NOT a Markus impersonation;
      //    the brand is visual, the voice is a neutral third-person narrator).
      const voText = `${post.hook}. ${post.body} ${post.cta}`.replace(/\s+/g, " ").trim().slice(0, 900);
      const tts = await generateTts({ text: voText, voice: "Charon", style: "Narrate in a clear, confident voice:" });
      const voDuration = await probeDurationSeconds(tts.audioPath);
      const reelDuration = planReelClips(voDuration).reelDuration;
      const distinctBody = Math.max(1, Math.min(Math.ceil(reelDuration / REEL_CLIP_SECONDS), REEL_MAX_DISTINCT_CLIPS));

      // Generic Veo clip generator (a scene from a text prompt + optional first
      // frame). Polls up to ~8 min/clip; clips run in parallel so wall time ≈
      // the slowest clip, not the sum.
      const genClip = async (opts: { prompt: string; firstFramePath?: string }): Promise<string> => {
        const { operationName } = await generateVeoGoogle({
          prompt: opts.prompt,
          aspectRatio: "9:16",
          durationSeconds: REEL_CLIP_SECONDS,
          ...(opts.firstFramePath ? { firstFrameImagePath: opts.firstFramePath, mode: "firstFrame" as const } : {}),
        });
        for (let i = 0; i < 96; i++) {
          const op = await pollVeoGoogle(operationName);
          if (op.error) throw new Error(`Veo failed: ${op.error}`);
          if (op.done && op.videoPath) return op.videoPath;
          await sleep(5000);
        }
        throw new Error("Veo timed out (>8 min)");
      };

      // 2) Generate the b-roll scenes in parallel; overlap the branded presenter
      //    HOOK INTRO (gpt-image-2 presenter frame → Veo motion). The hook opens
      //    the reel like a charismatic talking-head, then it cuts to b-roll +
      //    the Charon narration. Best-effort: a hook failure never sinks the reel.
      const bodyClipsP = Promise.all(
        Array.from({ length: distinctBody }, (_, i) => genClip({ prompt: buildReelVeoPrompt(post.topic, i) })),
      );
      let hookClip: string | null = null;
      if (hookIntro) {
        try {
          const hookImage = await generateReelHookImage({ cap: post.cap !== false, setting: hookSetting });
          hookClip = await genClip({ prompt: REEL_HOOK_MOTION_PROMPT, firstFramePath: hookImage.path });
        } catch (e) {
          console.warn(`reel hook intro skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const bodyClips = await bodyClipsP;

      // 3) Tile clips into one silent long video: [hook?] + b-roll filling the
      //    rest so the total still equals the voiceover length.
      const bodyDuration = +(reelDuration - (hookClip ? REEL_HOOK_SECONDS : 0)).toFixed(2);
      const bodySlots = tileSlots(bodyDuration);
      const segments = [
        ...(hookClip ? [{ type: "video" as const, path: hookClip, durationSeconds: REEL_HOOK_SECONDS, replaceAudio: true }] : []),
        ...bodySlots.map((d, i) => ({
          type: "video" as const,
          path: bodyClips[i % bodyClips.length],
          durationSeconds: d,
          replaceAudio: true, // strip any source audio; the VO is added below
        })),
      ];
      const tiled = await composeReel({
        segments,
        outputName: `wizard_reel_${post.id.slice(0, 8)}_bg`,
      });

      // 4) Final pass: burn captions (hook → body → CTA, paced across the FULL
      //    duration so they're readable) + theme logos onto the long video, and
      //    lay the complete voiceover over the whole reel.
      const captions = buildReelCaptions(post, reelDuration);
      const logos = buildReelLogos(post);
      const composed = await composeReel({
        segments: [{
          type: "video",
          path: tiled.videoPath,
          durationSeconds: reelDuration,
          textOverlays: captions,
          ...(logos.length ? { logos } : {}),
        }],
        audioPath: tts.audioPath,
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

  // ─── Inspiration (manual swipe file) ──────────────────────────────────────
  // Paste posts you admire from other creators (caption + format + media), then
  // one-click "adapt for me" rewrites the idea in Markus' voice as a draft.
  // The risk-free alternative to crawling Instagram. Media uploads go through
  // the existing POST /api/media/upload; we just store the returned URLs here.

  api.get("/ig-wizard/inspiration", (c) => {
    return c.json({ items: inspiration.listItems() });
  });

  api.post("/ig-wizard/inspiration", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const handle = inspiration.normalizeHandle(b.handle);
    const caption = typeof b.caption === "string" ? b.caption.trim() : "";
    if (!handle) return c.json({ error: "handle is required" }, 400);
    if (!caption) return c.json({ error: "caption is required" }, 400);
    const item = inspiration.createItem({
      handle,
      format: b.format,
      caption,
      topic: typeof b.topic === "string" ? b.topic : undefined,
      mediaUrls: b.mediaUrls,
      sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    return c.json({ ok: true, item }, 201);
  });

  api.delete("/ig-wizard/inspiration/:id", (c) => {
    const ok = inspiration.removeItem(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  /** Adapt a saved inspiration into Markus' own caption + auto-save as a draft. */
  api.post("/ig-wizard/inspiration/:id/adapt", async (c) => {
    const item = inspiration.getItem(c.req.param("id"));
    if (!item) return c.json({ error: "not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { language?: unknown; topic?: unknown };
    const language = normalizeLanguage(b.language);
    const topic = typeof b.topic === "string" && b.topic.trim() ? b.topic.trim() : item.topic;

    const res = await adaptInspiration({
      handle: item.handle,
      format: item.format,
      referenceCaption: item.caption,
      topic,
      language,
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);

    // Map the inspiration format to a WizardPost format (no "story" there → post).
    const wpFormat: wizardPosts.WizardPostFormat =
      item.format === "carousel" ? "carousel" : item.format === "reel" ? "reel" : "post";

    const post = wizardPosts.createPost({
      topic: topic || `Adapted from @${item.handle}`,
      hook: res.result.hook,
      body: res.result.body,
      cta: res.result.cta,
      hashtags: res.result.hashtags,
      caption: res.result.caption,
      source: "single",
      format: wpFormat,
      style: res.result.style,
      platforms: ["instagram"],
    });
    return c.json({ ok: true, post, result: res.result }, 201);
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

  // Each caption needs ~2.3s+ on screen to actually be read — so cap the COUNT
  // by reading time, not just fit. Fewer, longer captions > many that flash by.
  const MIN_READ = 2.3;
  const maxLines = Math.max(2, Math.floor(duration / MIN_READ));

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

  // Allocate time per caption: a base floor each + the remainder weighted by
  // text length (long lines get more reading time). A small gap before the next
  // caption means only one is ever on screen — no overlapping boxes.
  const n = ordered.length;
  const GAP = 0.08;
  const floorEach = Math.min(1.6, (duration / n) * 0.7);
  const lens = ordered.map((l) => Math.max(14, l.text.length));
  const totalLen = lens.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, duration - floorEach * n);
  let cursor = 0;

  return ordered.map((line, i) => {
    const dur = floorEach + (extra * lens[i]) / totalLen;
    const start = +cursor.toFixed(2);
    const end = +Math.min(duration, cursor + dur - GAP).toFixed(2);
    cursor += dur;
    // lineHeight 1.5 + small padding keeps each wrapped line's box from
    // overlapping the next (box height ≈ fontSize + 2·padding must stay under
    // the line spacing = fontSize · lineHeight) — clean stacked boxes.
    if (line.kind === "hook") {
      return { text: line.text, position: "center" as const, fontSize: 52, color: "#ffffff",
        bgColor: "black", bgPadding: 12, bold: true, maxWidth: 600, lineHeight: 1.5,
        startSeconds: start, endSeconds: end };
    }
    if (line.kind === "cta") {
      // Centered (not bottom-anchored) so a wrapped 2-3 line CTA never clips off
      // the bottom edge. Orange box = the funnel call-to-action.
      return { text: line.text, position: "center" as const, fontSize: 46, color: "#ffffff",
        bgColor: "#c2410c", bgPadding: 11, bold: true, maxWidth: 600, lineHeight: 1.5,
        startSeconds: start, endSeconds: end };
    }
    return { text: line.text, position: "center" as const, fontSize: 42, color: "#ffffff",
      bgColor: "black", bgPadding: 10, bold: true, maxWidth: 620, lineHeight: 1.5,
      startSeconds: start, endSeconds: end };
  });
}

/**
 * A topic-aware visual prompt for the silent Veo b-roll. Stays visual-only (no
 * person, no dialogue, no on-screen text — we burn clean captions ourselves) so
 * it dodges the audio-safety filter, but is themed to the post instead of a
 * single hardcoded cozy-laptop scene that looked identical for every reel.
 */
/** Distinct scene focuses so tiled clips don't look identical. */
const REEL_SCENE_VARIANTS = [
  "glowing screens and terminal windows, code and dashboards reflecting on a clean desk",
  "a rack of servers with blinking status LEDs in a dim data-centre, cables and cool blue light",
  "a macro close-up of a tiny single-board computer / mini PC on a desk, shallow depth of field",
  "an abstract flowing network of glowing nodes and data streams, dark premium background",
];

export function buildReelVeoPrompt(topic: string, variant = 0): string {
  const t = (topic || "").trim();
  const theme = t ? `B-roll for a short video about "${t}". ` : "";
  const scene = REEL_SCENE_VARIANTS[variant % REEL_SCENE_VARIANTS.length];
  return (
    `Vertical 9:16 cinematic b-roll. ${theme}` +
    `Modern, energetic tech atmosphere: ${scene}, dynamic rim lighting, ` +
    "subtle particle/bokeh, a smooth dolly camera move. Premium editorial color " +
    "grade, high contrast, fast premium product-film feel. " +
    "No on-screen text, no captions, no subtitles, no logos, no watermark."
  );
}

/** Per-clip length Veo produces. */
const REEL_CLIP_SECONDS = 8;
/** Hard cap on total reel length (IG reels stay punchy). */
const REEL_MAX_SECONDS = 60;
/** Cap on distinct Veo generations — extra slots reuse/tile these. Kept low
    (cost + parallel Veo jobs contend and slow each other down). */
const REEL_MAX_DISTINCT_CLIPS = 3;

/**
 * Plan a reel long enough to fit the full voiceover: how long the reel runs,
 * how many distinct Veo clips to generate, and each tiled slot's duration. A
 * 44s voiceover → ~44s reel, 4 distinct 8s clips tiled across 6 slots.
 */
/** Split a duration into ≤8s slots (a clip per slot, last one trimmed). */
export function tileSlots(duration: number): number[] {
  const slots: number[] = [];
  let remaining = Math.max(0, +duration.toFixed(2));
  while (remaining > 0.1) {
    const d = Math.min(REEL_CLIP_SECONDS, +remaining.toFixed(2));
    slots.push(d);
    remaining = +(remaining - d).toFixed(2);
  }
  return slots.length ? slots : [REEL_CLIP_SECONDS];
}

export function planReelClips(voDuration: number): {
  reelDuration: number;
  distinctClips: number;
  slotDurations: number[];
} {
  const reelDuration = Math.min(REEL_MAX_SECONDS, Math.max(REEL_CLIP_SECONDS, +(voDuration + 0.5).toFixed(2)));
  const slotDurations = tileSlots(reelDuration);
  const distinctClips = Math.max(1, Math.min(slotDurations.length, REEL_MAX_DISTINCT_CLIPS));
  return { reelDuration, distinctClips, slotDurations };
}

/** Seconds the branded presenter hook intro occupies at the start of a reel. */
const REEL_HOOK_SECONDS = 3;
/** Veo motion prompt for the hook clip (the presenter frame is the first frame).
    The presenter does NOT speak — he does something magical with the floating
    tiles (Charon narrates the audio). */
const REEL_HOOK_MOTION_PROMPT =
  "Vertical 9:16. The person does NOT speak — his mouth stays closed in a " +
  "confident smile, NO talking, NO lip movement. The two glowing holographic " +
  "tiles floating above his open hands pulse, orbit and rush together, colliding " +
  "in a burst of magical light and energy particles. Subtle confident head " +
  "movement and a slow gentle camera push-in. Premium cinematic lighting, cool " +
  "blue rim light. No on-screen text, no captions, no subtitles, no watermark.";

/**
 * Brand keyword → logo slug. The AI tools a post talks about get their real
 * logos overlaid (top-left stack) so the reel is visibly on-topic. Slugs resolve
 * via logo-resolver (local PNG → favicon fetch → placeholder), so even brands
 * without a bundled logo render something sensible.
 */
const REEL_LOGO_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(claude|anthropic)\b/i, "claude"],
  [/\b(chatgpt|openai|gpt-?\d)\b/i, "openai"],
  [/\bgemini\b/i, "gemini"],
  [/\bcopilot\b/i, "copilot"],
  [/\bcursor\b/i, "cursor"],
  [/\bperplexity\b/i, "perplexity"],
  [/\bnotion\b/i, "notion"],
  [/\bvercel\b/i, "vercel"],
  [/\bn8n\b/i, "n8n"],
  [/\bmidjourney\b/i, "midjourney"],
  [/\brunway\b/i, "runway"],
  [/\bsuno\b/i, "suno"],
  [/\bgithub\b/i, "github"],
  [/\bgoogle\b/i, "google"],
];

/** Detect up to 3 theme logos to overlay on the reel from the post's text. */
export function buildReelLogos(
  post: Pick<wizardPosts.WizardPost, "topic" | "hook" | "body" | "cta">,
): LogoOverlay[] {
  const hay = `${post.topic ?? ""} ${post.hook ?? ""} ${post.body ?? ""} ${post.cta ?? ""}`;
  const slugs: string[] = [];
  for (const [re, slug] of REEL_LOGO_KEYWORDS) {
    if (re.test(hay) && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length >= 3) break;
  }
  return slugs.map((brand) => ({ brand, width: 72, hideLabel: true }));
}
