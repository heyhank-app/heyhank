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
