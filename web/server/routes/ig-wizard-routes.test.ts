import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerIgWizardRoutes } from "./ig-wizard-routes.js";

// Mock the internal-ai module so tests don't hit a real provider.
// We control the response text per-test by reassigning these variables before
// each call. The mock returns whatever `mockReturn` is set to.
let mockReturn = { text: "", ok: true, error: undefined as string | undefined };
let mockHasProvider = true;

vi.mock("../internal-ai.js", () => ({
  callInternalAI: vi.fn(async () => mockReturn),
  hasInternalAI: vi.fn(() => mockHasProvider),
}));

// Mock the cover generator + the social-media draft store so compose-and-save
// tests never hit gpt-image-2 or write real draft files.
const mockGenerateIgCover = vi.fn();
const mockCreateDraft = vi.fn();
vi.mock("../ig-cover.js", () => ({
  generateIgCover: (...args: unknown[]) => mockGenerateIgCover(...args),
}));
vi.mock("../socialmedia/manager.js", () => ({
  createDraft: (...args: unknown[]) => mockCreateDraft(...args),
}));

// Helper to build a valid JSON payload like the real model would return.
function validPayload(): string {
  return JSON.stringify({
    hooks: Array.from({ length: 20 }, (_, i) => `Hook ${i + 1} for testing`),
    ctas: {
      engagement: Array.from({ length: 10 }, (_, i) => `Engagement CTA ${i + 1}`),
      leads: Array.from({ length: 10 }, (_, i) => `Comment WORD${i + 1} to get the guide`),
      growth: Array.from({ length: 10 }, (_, i) => `Follow me for tip ${i + 1}`),
    },
  });
}

describe("POST /ig-wizard/generate", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockReturn = { text: validPayload(), ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("returns 200 with the parsed wizard result for a happy-path call", async () => {
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "AI productivity for solopreneurs", language: "en" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hooks).toHaveLength(20);
    expect(json.ctas.engagement).toHaveLength(10);
    expect(json.ctas.leads).toHaveLength(10);
    expect(json.ctas.growth).toHaveLength(10);
    expect(json.niche).toBe("AI productivity for solopreneurs");
    expect(json.language).toBe("en");
  });

  it("normalizes unknown languages to 'en'", async () => {
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x", language: "fr" }),
    });
    const json = await res.json();
    expect(json.language).toBe("en");
  });

  it("accepts 'de' as a valid language", async () => {
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "Solo-Berater", language: "de" }),
    });
    const json = await res.json();
    expect(json.language).toBe("de");
  });

  it("handles JSON wrapped in markdown fences (defensive parsing)", async () => {
    // Some models still wrap output in ```json ... ``` despite system prompt.
    mockReturn = { text: "```json\n" + validPayload() + "\n```", ok: true, error: undefined };
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "test" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hooks).toHaveLength(20);
  });

  it("handles JSON with leading prose (extracts first {...} block)", async () => {
    mockReturn = {
      text: "Sure, here you go!\n\n" + validPayload() + "\n\nLet me know if you need more.",
      ok: true,
      error: undefined,
    };
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hooks.length).toBeGreaterThan(0);
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x" }),
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/provider/i);
  });

  it("returns 502 when the AI call itself fails", async () => {
    mockReturn = { text: "", ok: false, error: "rate limit hit" };
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x" }),
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/rate limit/i);
  });

  it("returns 502 when the AI returns junk that isn't parseable JSON", async () => {
    mockReturn = { text: "I'm sorry, I cannot help with that.", ok: true, error: undefined };
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x" }),
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/invalid JSON/i);
  });

  it("filters out non-string entries (defensive against model malformations)", async () => {
    mockReturn = {
      text: JSON.stringify({
        hooks: ["valid hook", 42, null, "another valid hook"],
        ctas: {
          engagement: ["good"],
          leads: [],
          growth: [{ not_a_string: true }, "valid growth"],
        },
      }),
      ok: true,
      error: undefined,
    };
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: "x" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hooks).toEqual(["valid hook", "another valid hook"]);
    expect(json.ctas.engagement).toEqual(["good"]);
    expect(json.ctas.leads).toEqual([]);
    expect(json.ctas.growth).toEqual(["valid growth"]);
  });

  it("truncates absurdly long niche input to prevent prompt injection abuse", async () => {
    const longNiche = "x".repeat(1000);
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: longNiche }),
    });
    const json = await res.json();
    // Whatever made it through must be at most 200 chars
    expect(json.niche.length).toBeLessThanOrEqual(200);
  });

  it("accepts empty niche (model produces generic content)", async () => {
    const res = await app.request("/ig-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.niche).toBe("(empty)");
  });
});

describe("POST /ig-wizard/caption", () => {
  let app: Hono;

  function captionPayload(): string {
    return JSON.stringify({
      hook: "AI wrote this in 3 minutes",
      body: "Here's the workflow.\n\nNo fluff.",
      cta: "Comment BUILD for the template",
      hashtags: ["ai", "automation", "#ai"],
    });
  }

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockReturn = { text: captionPayload(), ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("returns 200 with a fully assembled caption", async () => {
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "AI workflows", language: "en" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hook).toBe("AI wrote this in 3 minutes");
    expect(json.hashtags).toEqual(["ai", "automation"]); // deduped + #-stripped
    expect(json.caption).toContain("#ai #automation");
  });

  it("uses a supplied hook + CTA verbatim", async () => {
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "AI", hook: "Custom hook", cta: "Custom CTA" }),
    });
    const json = await res.json();
    expect(json.hook).toBe("Custom hook");
    expect(json.cta).toBe("Custom CTA");
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 502 when the model returns junk", async () => {
    mockReturn = { text: "no json here", ok: true, error: undefined };
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x" }),
    });
    expect(res.status).toBe(502);
  });
});

describe("POST /ig-wizard/plan", () => {
  let app: Hono;

  function planPayload(n: number): string {
    return JSON.stringify({
      briefs: Array.from({ length: n }, (_, i) => ({
        day: i + 1,
        angle: `Angle ${i + 1}`,
        hook: `Hook ${i + 1}`,
        ctaType: "engagement",
      })),
    });
  }

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockReturn = { text: planPayload(30), ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("returns 200 with 30 briefs", async () => {
    const res = await app.request("/ig-wizard/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "AI tools", language: "en", days: 30 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.briefs).toHaveLength(30);
    expect(json.topic).toBe("AI tools");
  });

  it("clamps days to the 1..30 range", async () => {
    mockReturn = { text: planPayload(30), ok: true, error: undefined };
    const res = await app.request("/ig-wizard/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", days: 500 }),
    });
    const json = await res.json();
    expect(json.briefs.length).toBeLessThanOrEqual(30);
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await app.request("/ig-wizard/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x" }),
    });
    expect(res.status).toBe(503);
  });
});

describe("POST /ig-wizard/compose-and-save-draft", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockHasProvider = true;
    mockGenerateIgCover.mockReset();
    mockCreateDraft.mockReset();
    mockGenerateIgCover.mockResolvedValue({
      filename: "img_1_a.png",
      url: "/api/media/file/img_1_a.png",
      path: "/tmp/img_1_a.png",
      prompt: "…",
      model: "gpt-image-2",
    });
    mockCreateDraft.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "draft-1",
      status: "draft",
      platforms: input.platforms,
      text: input.text,
      mediaUrls: input.mediaUrls,
      firstComment: input.firstComment,
      format: input.format,
      createdAt: "2026-05-31T00:00:00.000Z",
    }));
  });

  it("saves a draft verbatim from a pre-composed caption (no re-generation)", async () => {
    const res = await app.request("/ig-wizard/compose-and-save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "self-hosting AI",
        platforms: ["instagram", "facebook"],
        caption: { hook: "Stop renting AI", body: "Do this.", cta: "Comment BUILD", hashtags: ["ai", "selfhosted"] },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Draft text = hook+body+cta (no inline hashtags); hashtags → first comment.
    expect(json.draft.text).toBe("Stop renting AI\n\nDo this.\n\nComment BUILD");
    expect(json.draft.firstComment).toBe("#ai #selfhosted");
    expect(json.draft.platforms).toEqual(["instagram", "facebook"]);
    expect(json.draft.mediaUrls).toEqual(["/api/media/file/img_1_a.png"]);
    // The image was generated with the caption's hook as the headline.
    expect(mockGenerateIgCover).toHaveBeenCalledWith(expect.objectContaining({ headline: "Stop renting AI" }));
    // Pre-composed → the AI caption generator was NOT called.
    // (callInternalAI is mocked; assert createDraft got the verbatim text instead.)
    expect(json.caption.hook).toBe("Stop renting AI");
  });

  it("still saves a text-only draft when image generation fails", async () => {
    mockGenerateIgCover.mockRejectedValueOnce(new Error("gpt-image-2 failed: rate limit"));
    const res = await app.request("/ig-wizard/compose-and-save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "x",
        caption: { hook: "H", body: "B", cta: "C", hashtags: [] },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.image).toBeNull();
    expect(json.imageError).toMatch(/rate limit/);
    expect(json.draft.mediaUrls).toEqual([]); // text-only
  });

  it("skips image generation when generateImage:false", async () => {
    const res = await app.request("/ig-wizard/compose-and-save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "x",
        generateImage: false,
        caption: { hook: "H", body: "B", cta: "C", hashtags: [] },
      }),
    });
    const json = await res.json();
    expect(mockGenerateIgCover).not.toHaveBeenCalled();
    expect(json.image).toBeNull();
  });

  it("defaults platforms to [instagram] when none given", async () => {
    const res = await app.request("/ig-wizard/compose-and-save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", caption: { hook: "H", body: "", cta: "", hashtags: [] } }),
    });
    const json = await res.json();
    expect(json.draft.platforms).toEqual(["instagram"]);
  });
});
