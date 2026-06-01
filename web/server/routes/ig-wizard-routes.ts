// Instagram Wizard HTTP route. Thin wrapper around the shared generation
// logic in `../ig-wizard.ts` — kept tiny so the same code path can also be
// used by the MCP server (web/server/mcp/ig-wizard-mcp-server.ts).

import type { Hono } from "hono";
import {
  generateIgWizard,
  generateCaption,
  generatePlan,
  assembleCaption,
  normalizeLanguage,
  normalizeNiche,
  normalizeTopic,
  normalizeOptionalLine,
  normalizePlanDays,
} from "../ig-wizard.js";
import { generateIgCover } from "../ig-cover.js";
import * as socialManager from "../socialmedia/manager.js";
import type { SocialPlatform } from "../socialmedia/types.js";
import * as wizardPosts from "../ig-wizard-posts.js";

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

  // Compose a complete, ready-to-post caption from a topic (+ optional pre-picked
  // hook / CTA). Reuses the same internal-AI provider as /generate.
  api.post("/ig-wizard/caption", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: unknown;
      language?: unknown;
      hook?: unknown;
      cta?: unknown;
    };
    const res = await generateCaption({
      topic: normalizeTopic(body.topic),
      language: normalizeLanguage(body.language),
      hook: normalizeOptionalLine(body.hook),
      cta: normalizeOptionalLine(body.cta),
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json(res.result);
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

  // Full content-factory step: compose a caption, generate a branded square
  // Style-A image (optional), and save the pair as a local social-media draft.
  // Hashtags go into the first comment (clean caption); the image is the post
  // media. Returns the caption + image + the created draft.
  api.post("/ig-wizard/compose-and-save-draft", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: unknown;
      language?: unknown;
      hook?: unknown;
      cta?: unknown;
      platforms?: unknown;
      hero?: unknown;
      badge?: unknown;
      generateImage?: unknown;
      /** Pre-composed caption to save verbatim (skips re-generation). */
      caption?: { hook?: unknown; body?: unknown; cta?: unknown; hashtags?: unknown };
    };

    // Use a pre-composed caption verbatim if the UI passed one (what-you-see-is-
    // what-you-save); otherwise generate fresh from the topic.
    let captionResult: { hook: string; body: string; cta: string; hashtags: string[]; language: string };
    const pre = body.caption;
    if (pre && (typeof pre.hook === "string" || typeof pre.body === "string")) {
      captionResult = {
        hook: typeof pre.hook === "string" ? pre.hook : "",
        body: typeof pre.body === "string" ? pre.body : "",
        cta: typeof pre.cta === "string" ? pre.cta : "",
        hashtags: Array.isArray(pre.hashtags) ? pre.hashtags.filter((h): h is string => typeof h === "string") : [],
        language: normalizeLanguage(body.language),
      };
    } else {
      const cap = await generateCaption({
        topic: normalizeTopic(body.topic),
        language: normalizeLanguage(body.language),
        hook: normalizeOptionalLine(body.hook),
        cta: normalizeOptionalLine(body.cta),
      });
      if (!cap.ok) return c.json({ error: cap.error }, cap.status);
      captionResult = cap.result;
    }

    // Optional branded image. A failure here shouldn't lose the caption — we
    // surface it but still save a text-only draft so the work isn't wasted.
    let image: Awaited<ReturnType<typeof generateIgCover>> | null = null;
    let imageError: string | null = null;
    if (body.generateImage !== false) {
      try {
        image = await generateIgCover({
          headline: captionResult.hook || normalizeTopic(body.topic),
          badge: normalizeOptionalLine(body.badge) || "Built with AI",
          hero: normalizeOptionalLine(body.hero) || "notebook",
        });
      } catch (e) {
        imageError = e instanceof Error ? e.message : String(e);
      }
    }

    // Clean caption (no inline hashtags) for the post body; hashtags into the
    // IG first comment.
    const text = assembleCaption({
      hook: captionResult.hook,
      body: captionResult.body,
      cta: captionResult.cta,
      hashtags: [],
    });
    const firstComment = captionResult.hashtags.length
      ? captionResult.hashtags.map((h) => `#${h}`).join(" ")
      : undefined;

    const draft = await socialManager.createDraft({
      text,
      platforms: coercePlatforms(body.platforms),
      mediaUrls: image ? [image.url] : [],
      firstComment,
      format: "post",
      isDraft: true,
      createdBy: "agent",
    });

    return c.json({ caption: captionResult, image, imageError, draft });
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
    const b = (await c.req.json().catch(() => ({}))) as { hero?: unknown };
    try {
      const image = await generateIgCover({
        headline: post.hook || post.topic,
        badge: "Built with AI",
        hero: (typeof b.hero === "string" ? b.hero : post.hero) || "notebook",
      });
      const updated = wizardPosts.updatePost(post.id, {
        imageUrl: image.url,
        imageFilename: image.filename,
        hero: typeof b.hero === "string" ? b.hero : post.hero,
      });
      return c.json({ ok: true, post: updated, image });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** Promote a saved wizard post into the social-media drafts (publish queue). */
  api.post("/ig-wizard/posts/:id/to-draft", async (c) => {
    const post = wizardPosts.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    // Clean body (no inline hashtags); hashtags → IG first comment.
    const text = assembleCaption({ hook: post.hook, body: post.body, cta: post.cta, hashtags: [] });
    const firstComment = post.hashtags.length ? post.hashtags.map((h) => `#${h}`).join(" ") : undefined;
    const draft = await socialManager.createDraft({
      text,
      platforms: coercePlatforms(post.platforms),
      mediaUrls: post.imageUrl ? [post.imageUrl] : [],
      firstComment,
      format: "post",
      isDraft: true,
      createdBy: "agent",
    });
    const updated = wizardPosts.updatePost(post.id, { promotedDraftId: draft.id });
    return c.json({ ok: true, draft, post: updated });
  });
}
