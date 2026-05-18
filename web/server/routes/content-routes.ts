// ─── Content Engine Routes ──────────────────────────────────────────────────
// REST API for the Content Engine / Ad Creator system.

import type { Hono } from "hono";

export function registerContentRoutes(api: Hono): void {
  /** Analyze a website — extract brand identity, products, colors, tone */
  api.post("/content/analyze", async (c) => {
    try {
      const body = await c.req.json();
      const url = (body.url || "").trim();
      if (!url) return c.json({ error: "url is required" }, 400);

      const { analyzeWebsite } = await import("../content-intelligence/content-engine.js");
      const intelligence = await analyzeWebsite(url);
      return c.json(intelligence);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Analysis failed" }, 500);
    }
  });

  /** Create a content strategy based on website analysis */
  api.post("/content/strategy", async (c) => {
    try {
      const body = await c.req.json();
      const url = (body.url || "").trim();
      if (!url) return c.json({ error: "url is required" }, 400);

      const platformsStr = (body.platforms as string | undefined) || "instagram,linkedin,facebook";
      const platforms = Array.isArray(platformsStr)
        ? platformsStr
        : platformsStr.split(",").map((p: string) => p.trim()).filter(Boolean);

      const { analyzeWebsite, createContentStrategy } = await import("../content-intelligence/content-engine.js");
      const intelligence = await analyzeWebsite(url);
      const strategy = createContentStrategy(intelligence, platforms);
      return c.json(strategy);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Strategy creation failed" }, 500);
    }
  });

  /** Generate platform-optimized content pieces */
  api.post("/content/generate", async (c) => {
    try {
      const body = await c.req.json();
      const url = (body.url || "").trim();
      const platform = (body.platform || "").trim();
      if (!url) return c.json({ error: "url is required" }, 400);
      if (!platform) return c.json({ error: "platform is required" }, 400);

      const count = body.count || 5;
      const journeyStage = body.journeyStage || undefined;
      const styleProfileHandle =
        typeof body.styleProfileHandle === "string" && body.styleProfileHandle.trim()
          ? body.styleProfileHandle.trim()
          : undefined;

      const { analyzeWebsite, createContentStrategy, generateSmartContent } = await import("../content-intelligence/content-engine.js");
      const intelligence = await analyzeWebsite(url);
      const strategy = createContentStrategy(intelligence, [platform]);
      const pieces = await generateSmartContent({
        intelligence,
        strategy,
        platform,
        journeyStage,
        count,
        styleProfileHandle,
      });
      return c.json({ pieces, count: pieces.length });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Content generation failed" }, 500);
    }
  });

  /** Generate ad creatives */
  api.post("/content/ads", async (c) => {
    try {
      const body = await c.req.json();
      const url = (body.url || "").trim();
      const platform = (body.platform || "").trim();
      if (!url) return c.json({ error: "url is required" }, 400);
      if (!platform) return c.json({ error: "platform is required" }, 400);

      const count = body.count || 3;

      const { analyzeWebsite, generateAdCreatives } = await import("../content-intelligence/content-engine.js");
      const intelligence = await analyzeWebsite(url);
      const ads = await generateAdCreatives({ intelligence, platform, count });
      return c.json({ ads, count: ads.length });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Ad generation failed" }, 500);
    }
  });

  /**
   * Remix a library post into Markus's voice + business.
   * Body: { sourcePostId, sourcePlatform, targetPlatform, url, businessAngle? }
   *   - url: Markus's site, used to (re-)derive WebsiteIntelligence for tone/USPs/audience
   * Returns: { piece: ContentPiece }
   */
  api.post("/content/remix", async (c) => {
    try {
      const body = await c.req.json();
      const sourcePostId = (body.sourcePostId || "").trim();
      const sourcePlatform = (body.sourcePlatform || "").trim();
      const targetPlatform = (body.targetPlatform || sourcePlatform).trim();
      const url = (body.url || "").trim();
      const businessAngle = typeof body.businessAngle === "string" ? body.businessAngle.trim() : undefined;
      if (!sourcePostId || !sourcePlatform || !targetPlatform || !url) {
        return c.json({ error: "sourcePostId, sourcePlatform, targetPlatform, url are required" }, 400);
      }
      const { SOCIAL_PLATFORMS } = await import("../socialview/types.js");
      if (!SOCIAL_PLATFORMS.includes(sourcePlatform as any)) {
        return c.json({ error: `invalid sourcePlatform: ${sourcePlatform}` }, 400);
      }
      const { analyzeWebsite, remixPost } = await import("../content-intelligence/content-engine.js");
      const intelligence = await analyzeWebsite(url);
      const piece = await remixPost({
        sourcePostId,
        sourcePlatform: sourcePlatform as any,
        targetPlatform,
        intelligence,
        businessAngle,
      });
      return c.json({ piece });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Remix failed";
      // Source-not-found surfaces as 404 so the UI can show a friendly retry message.
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * Batch-remix: take N library posts + a single business angle/topic, run
   * remixPost in parallel for each, and persist the results as drafts in the
   * socialmedia store. Powers the weekly "Brief Run" wizard — the user
   * picks 5-10 swipes in Latest Hits view, presses one button, and gets
   * 5-10 ready-to-review drafts.
   *
   * Body: { posts: [{ id, platform }], url, targetPlatform?, businessAngle? }
   * Returns: { drafts: [{ id, text, platforms }], errors: [{ sourcePostId, error }] }
   */
  api.post("/content/remix-batch", async (c) => {
    try {
      const body = await c.req.json();
      const sourcePosts = Array.isArray(body.posts) ? body.posts : [];
      const url = (body.url || "").trim();
      const targetPlatform = (body.targetPlatform || "").trim();
      const businessAngle = typeof body.businessAngle === "string" ? body.businessAngle.trim() : undefined;
      if (sourcePosts.length === 0) return c.json({ error: "posts array is required" }, 400);
      if (!url) return c.json({ error: "url is required" }, 400);
      if (sourcePosts.length > 25) {
        // Hard cap: a single batch call shouldn't fire 100 model invocations.
        // 25 is enough for the 15-21 reels/week target with headroom.
        return c.json({ error: "batch size capped at 25" }, 400);
      }

      const { SOCIAL_PLATFORMS } = await import("../socialview/types.js");
      const { analyzeWebsite, remixPost } = await import("../content-intelligence/content-engine.js");
      const { savePost } = await import("../socialmedia/store.js");

      // Run analyzeWebsite once and pass intelligence to every remix —
      // re-analyzing per item would be wasteful and slow.
      const intelligence = await analyzeWebsite(url);

      const results = await Promise.all(
        sourcePosts.map(async (sp: { id: string; platform: string }) => {
          try {
            if (!sp.id || !SOCIAL_PLATFORMS.includes(sp.platform as any)) {
              return { ok: false as const, sourcePostId: sp.id, error: "invalid id or platform" };
            }
            const piece = await remixPost({
              sourcePostId: sp.id,
              sourcePlatform: sp.platform as any,
              targetPlatform: targetPlatform || sp.platform,
              intelligence,
              businessAngle,
            });
            return { ok: true as const, piece, sourcePostId: sp.id };
          } catch (e) {
            return {
              ok: false as const,
              sourcePostId: sp.id,
              error: e instanceof Error ? e.message : "remix failed",
            };
          }
        }),
      );

      // Persist successful pieces as drafts. We compose the text body from
      // the ContentPiece fields the user actually reviews (hook → body → CTA
      // → hashtags) so the draft renders sensibly without us inventing yet
      // another canonical format.
      const drafts: { id: string; text: string; platforms: string[]; remixFrom?: string }[] = [];
      const errors: { sourcePostId: string; error: string }[] = [];
      const now = new Date().toISOString();

      for (const r of results) {
        if (!r.ok) {
          errors.push({ sourcePostId: r.sourcePostId, error: r.error });
          continue;
        }
        const piece = r.piece;
        const text = [piece.hook, piece.body, piece.cta, piece.hashtags.map((h: string) => `#${h}`).join(" ")]
          .filter(Boolean)
          .join("\n\n");
        const post = {
          id: piece.id,
          text,
          platforms: [piece.platform as any],
          status: "draft" as const,
          backendId: null,
          mediaUrls: [],
          createdAt: now,
          updatedAt: now,
          createdBy: "agent" as const,
          // Stash remix attribution in backendData so it's visible in the
          // drafts panel without polluting the SocialPost schema.
          backendData: { remix: piece.remix },
        };
        savePost(post as any);
        drafts.push({
          id: post.id,
          text,
          platforms: post.platforms,
          remixFrom: piece.remix?.sourceAuthor,
        });
      }

      return c.json({
        drafts,
        errors,
        attempted: sourcePosts.length,
        succeeded: drafts.length,
        failed: errors.length,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "batch remix failed" }, 500);
    }
  });

  /** Generate a complete multi-week content plan */
  api.post("/content/plan", async (c) => {
    try {
      const body = await c.req.json();
      const url = (body.url || "").trim();
      if (!url) return c.json({ error: "url is required" }, 400);

      const platformsStr = (body.platforms as string | undefined) || "instagram,linkedin,facebook";
      const platforms = Array.isArray(platformsStr)
        ? platformsStr
        : platformsStr.split(",").map((p: string) => p.trim()).filter(Boolean);
      const weeks = body.weeks || 4;

      const { generateContentPlan } = await import("../content-intelligence/content-engine.js");
      const plan = await generateContentPlan({ url, platforms, weeks });
      return c.json(plan);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Plan generation failed" }, 500);
    }
  });
}
