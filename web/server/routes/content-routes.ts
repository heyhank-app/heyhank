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
