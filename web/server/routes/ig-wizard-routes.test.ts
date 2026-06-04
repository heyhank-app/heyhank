import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerIgWizardRoutes, buildReelCaptions, chunkCaption, buildReelVeoPrompt, buildReelLogos, planReelClips } from "./ig-wizard-routes.js";

// Mock the internal-ai module so tests don't hit a real provider.
// We control the response text per-test by reassigning these variables before
// each call. The mock returns whatever `mockReturn` is set to.
let mockReturn = { text: "", ok: true, error: undefined as string | undefined };
let mockHasProvider = true;

vi.mock("../internal-ai.js", () => ({
  callInternalAI: vi.fn(async () => mockReturn),
  hasInternalAI: vi.fn(() => mockHasProvider),
}));

// Mock the research module so caption-grounding + /research tests don't hit a
// real web search. mockResearch controls researchTopic's return per test.
const mockResearch = vi.fn();
vi.mock("../research.js", () => ({
  researchTopic: (...a: unknown[]) => mockResearch(...a),
  briefToGroundingText: (b: { hotDataPoint?: string }) => `GROUNDING:${b.hotDataPoint ?? ""}`,
}));

// Mock the cover generator + the social-media draft store so compose-and-save
// tests never hit gpt-image-2 or write real draft files.
const mockGenerateIgCover = vi.fn();
const mockGenerateReelHookImage = vi.fn();
const mockCreateDraft = vi.fn();
const mockGenerateConceptSlide = vi.fn();
vi.mock("../ig-cover.js", () => ({
  generateIgCover: (...args: unknown[]) => mockGenerateIgCover(...args),
  generateConceptSlide: (...args: unknown[]) => mockGenerateConceptSlide(...args),
  generateReelHookImage: (...args: unknown[]) => mockGenerateReelHookImage(...args),
  conceptAccent: (i: number) => ({ name: `accent${i}`, hex: "#000000" }),
  normalizeStyle: (raw: unknown) =>
    raw === "business" || raw === "pointing" || raw === "bold" || raw === "screen" ? raw : "cozy",
  normalizeHookSetting: (raw: unknown) =>
    raw === "desk" || raw === "cafe" || raw === "outdoor" || raw === "loft" ? raw : "studio",
}));
vi.mock("../socialmedia/manager.js", () => ({
  createDraft: (...args: unknown[]) => mockCreateDraft(...args),
}));

// Wizard Saved Posts store mock.
const mockWpList = vi.fn();
const mockWpCreate = vi.fn();
const mockWpGet = vi.fn();
const mockWpUpdate = vi.fn();
const mockWpRemove = vi.fn();
const mockWpBulkRemove = vi.fn();
vi.mock("../ig-wizard-posts.js", () => ({
  listPosts: (...a: unknown[]) => mockWpList(...a),
  createPost: (...a: unknown[]) => mockWpCreate(...a),
  getPost: (...a: unknown[]) => mockWpGet(...a),
  updatePost: (...a: unknown[]) => mockWpUpdate(...a),
  removePost: (...a: unknown[]) => mockWpRemove(...a),
  bulkRemove: (...a: unknown[]) => mockWpBulkRemove(...a),
}));

// Inspiration store mock. The normalize helpers keep their real shape so the
// route's validation (handle/format coercion) behaves like production.
const mockInspList = vi.fn();
const mockInspCreate = vi.fn();
const mockInspGet = vi.fn();
const mockInspRemove = vi.fn();
vi.mock("../ig-inspiration.js", () => ({
  listItems: (...a: unknown[]) => mockInspList(...a),
  createItem: (...a: unknown[]) => mockInspCreate(...a),
  getItem: (...a: unknown[]) => mockInspGet(...a),
  removeItem: (...a: unknown[]) => mockInspRemove(...a),
  normalizeHandle: (raw: unknown) =>
    typeof raw === "string" ? raw.trim().replace(/^@+/, "").trim() : "",
  normalizeInspirationFormat: (raw: unknown) =>
    raw === "carousel" || raw === "reel" || raw === "story" ? raw : "post",
}));

// Apify Instagram scraper mock — no real Apify run.
const mockApifyScrape = vi.fn();
const mockApifyDownload = vi.fn();
let mockHasApify = true;
vi.mock("../apify-instagram.js", () => ({
  scrapeInstagramPosts: (...a: unknown[]) => mockApifyScrape(...a),
  downloadToMedia: (...a: unknown[]) => mockApifyDownload(...a),
  hasApifyToken: () => mockHasApify,
}));

// Reel pipeline mocks (Veo + TTS + compositor) — no real video generation.
const mockVeoGen = vi.fn();
const mockVeoPoll = vi.fn();
const mockTts = vi.fn();
const mockCompose = vi.fn();
vi.mock("../fal-video.js", () => ({
  generateVeoGoogle: (...a: unknown[]) => mockVeoGen(...a),
  pollVeoGoogle: (...a: unknown[]) => mockVeoPoll(...a),
}));
vi.mock("../gemini-tts.js", () => ({ generateTts: (...a: unknown[]) => mockTts(...a) }));
vi.mock("../video-compose.js", () => ({ composeReel: (...a: unknown[]) => mockCompose(...a) }));

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
    mockResearch.mockReset();
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

  it("auto-researches inline when autoResearch is set, marking the caption grounded", async () => {
    mockResearch.mockResolvedValue({ ok: true, brief: { hotDataPoint: "72% SWE-bench" } });
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "self-hosting AI", autoResearch: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockResearch).toHaveBeenCalledTimes(1);
    expect(json.grounded).toBe(true);
  });

  it("uses a pre-built grounding string without researching again", async () => {
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", grounding: "RECENT: ZAYA1-8B ships" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockResearch).not.toHaveBeenCalled(); // grounding supplied → no search
    expect(json.grounded).toBe(true);
  });

  it("composes ungrounded (grounded:false) when research fails — never blocks the caption", async () => {
    mockResearch.mockResolvedValue({ ok: false, error: "rate limited" });
    const res = await app.request("/ig-wizard/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", autoResearch: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grounded).toBe(false);
  });
});

describe("POST /ig-wizard/research", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockResearch.mockReset();
  });

  it("returns 200 with the content brief on success", async () => {
    const brief = { topic: "self-hosting AI", freshItems: [{ headline: "ZAYA1-8B" }], facts: [] };
    mockResearch.mockResolvedValue({ ok: true, brief });
    const res = await app.request("/ig-wizard/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "self-hosting AI", language: "en" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.freshItems[0].headline).toBe("ZAYA1-8B");
    expect(mockResearch).toHaveBeenCalledWith(expect.objectContaining({ topic: "self-hosting AI" }));
  });

  it("returns 502 with the error when research fails (e.g. no Anthropic provider)", async () => {
    mockResearch.mockResolvedValue({ ok: false, error: "Live research needs the Anthropic provider" });
    const res = await app.request("/ig-wizard/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x" }),
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/Anthropic/);
  });

  it("forwards forceRefresh through to the researcher", async () => {
    mockResearch.mockResolvedValue({ ok: true, brief: { topic: "x" } });
    await app.request("/ig-wizard/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", forceRefresh: true }),
    });
    expect(mockResearch).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
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

describe("Wizard Saved Posts routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    [mockWpList, mockWpCreate, mockWpGet, mockWpUpdate, mockWpRemove, mockWpBulkRemove].forEach((m) => m.mockReset());
    mockGenerateIgCover.mockReset();
    mockGenerateConceptSlide.mockReset();
    mockGenerateReelHookImage.mockReset();
    mockCreateDraft.mockReset();
    // The carousel route runs generateCarouselScript → the AI provider must
    // look configured (a prior describe may have toggled this off).
    mockHasProvider = true;
  });

  it("GET /ig-wizard/posts returns the list", async () => {
    mockWpList.mockReturnValue([{ id: "a", hook: "A" }]);
    const res = await app.request("/ig-wizard/posts");
    expect(res.status).toBe(200);
    expect((await res.json()).posts).toEqual([{ id: "a", hook: "A" }]);
  });

  it("POST /ig-wizard/posts creates a post (caption required)", async () => {
    mockWpCreate.mockReturnValue({ id: "new", source: "single" });
    const ok = await app.request("/ig-wizard/posts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: "Hi", hook: "Hi", source: "plan", day: 3 }),
    });
    expect(ok.status).toBe(201);
    expect(mockWpCreate).toHaveBeenCalledWith(expect.objectContaining({ caption: "Hi", source: "plan", day: 3 }));

    const bad = await app.request("/ig-wizard/posts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hook: "no caption" }),
    });
    expect(bad.status).toBe(400);
  });

  it("DELETE /ig-wizard/posts/:id removes a post", async () => {
    mockWpRemove.mockReturnValue(true);
    const res = await app.request("/ig-wizard/posts/abc", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(mockWpRemove).toHaveBeenCalledWith("abc");

    mockWpRemove.mockReturnValue(false);
    const miss = await app.request("/ig-wizard/posts/gone", { method: "DELETE" });
    expect(miss.status).toBe(404);
  });

  it("POST /ig-wizard/posts/bulk-delete removes many", async () => {
    mockWpBulkRemove.mockReturnValue(2);
    const res = await app.request("/ig-wizard/posts/bulk-delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["a", "b"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(2);
    expect(mockWpBulkRemove).toHaveBeenCalledWith(["a", "b"]);
  });

  it("POST /ig-wizard/posts/:id/image generates + attaches a branded image", async () => {
    mockWpGet.mockReturnValue({ id: "a", hook: "Stop renting AI", topic: "x", hero: "notebook" });
    mockGenerateIgCover.mockResolvedValue({ filename: "i.png", url: "/api/media/file/i.png", path: "/x", prompt: "p", model: "gpt-image-2" });
    mockWpUpdate.mockReturnValue({ id: "a", imageUrl: "/api/media/file/i.png" });

    const res = await app.request("/ig-wizard/posts/a/image", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hero: "laptop" }),
    });
    expect(res.status).toBe(200);
    expect(mockGenerateIgCover).toHaveBeenCalledWith(expect.objectContaining({ headline: "Stop renting AI", hero: "laptop" }));
    expect(mockWpUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ imageUrl: "/api/media/file/i.png" }));
  });

  it("POST /ig-wizard/posts/:id/to-draft promotes to a social draft", async () => {
    mockWpGet.mockReturnValue({ id: "a", hook: "H", body: "B", cta: "C", hashtags: ["ai"], platforms: ["instagram"], imageUrl: "/api/media/file/i.png" });
    mockCreateDraft.mockResolvedValue({ id: "draft-9", status: "draft", platforms: ["instagram"], text: "H\n\nB\n\nC", mediaUrls: ["/api/media/file/i.png"], firstComment: "#ai" });
    mockWpUpdate.mockReturnValue({ id: "a", promotedDraftId: "draft-9" });

    const res = await app.request("/ig-wizard/posts/a/to-draft", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.draft.id).toBe("draft-9");
    // Clean body (no inline hashtags), hashtags → first comment, image as media.
    expect(mockCreateDraft).toHaveBeenCalledWith(expect.objectContaining({
      text: "H\n\nB\n\nC",
      firstComment: "#ai",
      mediaUrls: ["/api/media/file/i.png"],
    }));
    expect(mockWpUpdate).toHaveBeenCalledWith("a", { promotedDraftId: "draft-9" });
  });

  it("returns 404 for image/to-draft on a missing post", async () => {
    mockWpGet.mockReturnValue(null);
    expect((await app.request("/ig-wizard/posts/x/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
    expect((await app.request("/ig-wizard/posts/x/to-draft", { method: "POST" })).status).toBe(404);
  });

  it("POST /ig-wizard/posts/:id/carousel — clone hook+CTA slides, concept middle slides", async () => {
    mockWpGet.mockReturnValue({ id: "a", hook: "Stop renting AI", topic: "x", body: "b", cta: "c", hero: "notebook" });
    // The carousel script comes from the internal-AI mock — now with a per-slide visual.
    mockReturn = {
      text: JSON.stringify({
        slides: [
          { text: "S1", visual: "hook motif" },
          { text: "S2", visual: "terminal motif" },
          { text: "S3", visual: "cta motif" },
        ],
      }),
      ok: true,
      error: undefined,
    };
    let imgN = 0;
    mockGenerateIgCover.mockImplementation(async () => ({ filename: `clone${++imgN}.png`, url: `/api/media/file/clone${imgN}.png`, path: "/x", prompt: "p", model: "gpt-image-2" }));
    let conceptN = 0;
    mockGenerateConceptSlide.mockImplementation(async () => ({ filename: `concept${++conceptN}.png`, url: `/api/media/file/concept${conceptN}.png`, path: "/x", prompt: "p", model: "gpt-image-2" }));
    mockWpUpdate.mockImplementation((_id: string, patch: Record<string, unknown>) => ({ id: "a", ...patch }));

    const res = await app.request("/ig-wizard/posts/a/carousel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slides: 3 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mediaUrls).toHaveLength(3);
    // First (hook) + last (CTA) slides are the identity-locked Markus edit;
    // the single middle slide is a person-free concept slide.
    expect(mockGenerateIgCover).toHaveBeenCalledTimes(2);
    expect(mockGenerateConceptSlide).toHaveBeenCalledTimes(1);
    // The middle concept slide gets the slide's visual concept passed through.
    expect(mockGenerateConceptSlide).toHaveBeenCalledWith(expect.objectContaining({ headline: "S2", visual: "terminal motif" }));
    expect(mockWpUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ format: "carousel" }));
  });

  it("carousel route 404s on a missing post", async () => {
    mockWpGet.mockReturnValue(null);
    expect((await app.request("/ig-wizard/posts/x/carousel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  });

  it("image route passes the style override to the cover generator + persists it", async () => {
    mockWpGet.mockReturnValue({ id: "a", hook: "H", topic: "x", hero: "notebook", style: "cozy" });
    mockGenerateIgCover.mockResolvedValue({ filename: "i.png", url: "/api/media/file/i.png", path: "/x", prompt: "p", model: "gpt-image-2" });
    mockWpUpdate.mockImplementation((_id: string, patch: Record<string, unknown>) => ({ id: "a", ...patch }));

    const res = await app.request("/ig-wizard/posts/a/image", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: "pointing" }),
    });
    expect(res.status).toBe(200);
    expect(mockGenerateIgCover).toHaveBeenCalledWith(expect.objectContaining({ style: "pointing" }));
    expect(mockWpUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ style: "pointing" }));
  });

  it("POST /ig-wizard/posts/:id/reel runs Veo → TTS → compose → format=reel", async () => {
    // No imageUrl → firstFrame resolution is skipped (no fs dependency).
    mockWpGet.mockReturnValue({ id: "a", hook: "Stop renting AI", body: "Run it yourself.", cta: "Comment STACK", topic: "x", imageUrl: null });
    mockVeoGen.mockResolvedValue({ operationName: "op/123" });
    mockVeoPoll.mockResolvedValue({ operationName: "op/123", done: true, videoPath: "/m/veo.mp4" });
    mockTts.mockResolvedValue({ audioPath: "/m/vo.mp3", cached: false, size: 100 });
    mockGenerateReelHookImage.mockResolvedValue({ path: "/m/hook.png", url: "/api/media/file/hook.png", filename: "hook.png", model: "gpt-image-2", prompt: "p" });
    mockCompose.mockResolvedValue({ videoPath: "/m/reel_x.mp4", themeSlug: "neutral", durationSeconds: 8, placeholderLogos: [] });
    mockWpUpdate.mockImplementation((_id: string, patch: Record<string, unknown>) => ({ id: "a", ...patch }));

    const res = await app.request("/ig-wizard/posts/a/reel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.videoUrl).toBe("/api/media/file/reel_x.mp4");
    // Veo got a 9:16 visual prompt; TTS spoke hook + body + CTA; compose replaced audio.
    expect(mockVeoGen).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "9:16", durationSeconds: 8 }));
    // The reel voiceover is the Charon narrator (deliberately not a Markus
    // impersonation) read in a narrator style — locked here against regression.
    expect(mockTts).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Stop renting AI. Run it yourself. Comment STACK",
        voice: "Charon",
        style: "Narrate in a clear, confident voice:",
      }),
    );
    // Two compose passes: (1) tile the silent b-roll clips, (2) burn captions +
    // logos and lay the full voiceover over the whole reel.
    expect(mockCompose).toHaveBeenCalledTimes(2);
    const tiledArg = mockCompose.mock.calls[0][0] as { segments: Array<{ type: string; path: string; durationSeconds?: number; replaceAudio?: boolean }> };
    expect(tiledArg.segments[0].type).toBe("video");
    // The branded presenter hook intro (Veo from the gpt-image hook frame) leads
    // the reel: first segment is the hook clip, ~3s.
    expect(mockGenerateReelHookImage).toHaveBeenCalledTimes(1);
    expect(tiledArg.segments[0].path).toBe("/m/veo.mp4"); // hook clip (also a Veo output)
    expect(tiledArg.segments[0].durationSeconds).toBe(3);
    const finalArg = mockCompose.mock.calls[1][0] as {
      segments: Array<{ path: string; textOverlays?: Array<{ text: string }> }>;
      audioPath?: string;
    };
    // Final pass wraps the tiled video, carries the captions, and the global VO.
    expect(finalArg.segments[0].path).toBe("/m/reel_x.mp4"); // = tiled output
    expect(finalArg.audioPath).toBe("/m/vo.mp3"); // full voiceover over the whole reel
    const overlays = finalArg.segments[0].textOverlays ?? [];
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    expect(overlays.map((o) => o.text)).toContain("Stop renting AI");
    expect(mockWpUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ format: "reel", videoUrl: "/api/media/file/reel_x.mp4" }));
  });

  it("reel route surfaces a Veo failure as 502", async () => {
    mockWpGet.mockReturnValue({ id: "a", hook: "h", cta: "c", topic: "x", imageUrl: null });
    mockTts.mockResolvedValue({ audioPath: "/m/vo.mp3", cached: false, size: 100 }); // VO runs first now
    mockVeoGen.mockResolvedValue({ operationName: "op/1" });
    mockVeoPoll.mockResolvedValue({ operationName: "op/1", done: false, error: "quota exceeded" });
    const res = await app.request("/ig-wizard/posts/a/reel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(502);
  });

  it("POST /ig-wizard/posts/bulk-to-draft promotes many, skipping missing ids", async () => {
    // a + b exist, c is missing.
    mockWpGet.mockImplementation((id: string) =>
      id === "c" ? null : { id, hook: "H", body: "B", cta: "C", hashtags: ["ai"], platforms: ["instagram"], imageUrl: null },
    );
    mockCreateDraft.mockImplementation(async () => ({ id: `draft-${Math.random()}`, status: "draft", platforms: ["instagram"], text: "H", mediaUrls: [] }));
    mockWpUpdate.mockReturnValue({ id: "x", promotedDraftId: "d" });

    const res = await app.request("/ig-wizard/posts/bulk-to-draft", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["a", "b", "c"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.promoted).toBe(2); // a + b promoted, c skipped
    expect(json.results).toHaveLength(3);
    expect(json.results.find((r: { id: string }) => r.id === "c").ok).toBe(false);
    expect(mockCreateDraft).toHaveBeenCalledTimes(2);
  });
});

describe("buildReelCaptions", () => {
  it("turns hook + body + CTA into timed, ordered captions covering the duration", () => {
    const caps = buildReelCaptions(
      { hook: "Stop renting AI", body: "Run it yourself. It is cheap.", cta: "Comment STACK" },
      8,
    );
    expect(caps.length).toBeGreaterThanOrEqual(3);
    // Hook is first; captions sit small at the BOTTOM so they don't cover the subject.
    expect(caps[0].text).toBe("Stop renting AI");
    expect(caps[0].position).toBe("bottom");
    expect(caps.every((c) => c.position === "bottom")).toBe(true);
    // Small fonts (≤ 40) so the hook magic + face stay the star.
    expect(caps.every((c) => (c.fontSize ?? 0) <= 40)).toBe(true);
    expect(caps[caps.length - 1].text).toBe("Comment STACK");
    // Captions are sequential and span (almost) the whole clip (a small gap
    // before the end prevents overlapping boxes).
    expect(caps[0].startSeconds).toBe(0);
    expect(caps[caps.length - 1].endSeconds).toBeGreaterThan(7);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i].startSeconds).toBeGreaterThanOrEqual(caps[i - 1].startSeconds ?? 0);
    }
  });

  it("paces captions by reading time — each stays on screen long enough to read", () => {
    // A rich body must NOT produce many flash-by captions: each window ≥ ~1.5s.
    const body = Array.from({ length: 10 }, (_, i) => `This is body sentence number ${i + 1}.`).join(" ");
    const caps = buildReelCaptions({ hook: "Hook", body, cta: "CTA" }, 8);
    // 8s / 2.3s reading floor → at most ~3 captions.
    expect(caps.length).toBeLessThanOrEqual(3);
    for (const c of caps) {
      expect((c.endSeconds ?? 0) - (c.startSeconds ?? 0)).toBeGreaterThanOrEqual(1.3);
    }
  });

  it("returns no captions for an empty post", () => {
    expect(buildReelCaptions({ hook: "", body: "", cta: "" }, 8)).toEqual([]);
  });

  it("always keeps the CTA even when a long body would overflow the line budget", () => {
    // 8 body sentences but only ~6 caption slots → the body must be trimmed,
    // NOT the CTA (the funnel-critical line).
    const body = Array.from({ length: 8 }, (_, i) => `Body point ${i + 1}.`).join(" ");
    const caps = buildReelCaptions({ hook: "Hook line", body, cta: "Comment STACK for the guide" }, 8);
    expect(caps[caps.length - 1].text).toBe("Comment STACK for the guide");
    expect(caps[0].text).toBe("Hook line");
  });

  it("strips emoji from on-screen captions (the font renders them as tofu)", () => {
    const caps = buildReelCaptions(
      { hook: "Run your own AI 🔒💡", body: "Cheap and private. 🚀", cta: "Comment VPS 📩" },
      8,
    );
    for (const c of caps) {
      expect(c.text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
    expect(caps[0].text).toBe("Run your own AI");
    expect(caps[caps.length - 1].text).toBe("Comment VPS");
  });

  it("chunks a long step-list line so no caption is a wall of text", () => {
    // A run-on step list with no sentence breaks must be split into short chunks,
    // never one giant caption that covers the whole video.
    const body =
      "Here's how to get running in 5 steps: Download the app at antigravity.google.com Log in with your Google account Start a project and choose your working folder Select Claude Sonnet 4.6 Type out what you want to build";
    const caps = buildReelCaptions({ hook: "Short hook", body, cta: "Comment AGENT" }, 45);
    // Every on-screen caption stays short (≤ ~64 chars) — no wall.
    for (const c of caps) {
      expect(c.text.length).toBeLessThanOrEqual(66);
    }
    // The long body produced more than one body chunk (it was split, not dumped).
    expect(caps.length).toBeGreaterThan(3);
  });
});

describe("chunkCaption", () => {
  it("keeps a short line intact", () => {
    expect(chunkCaption("Hello there", 64)).toEqual(["Hello there"]);
  });

  it("splits a long line at word boundaries, each ≤ maxChars", () => {
    const chunks = chunkCaption("one two three four five six seven eight nine ten", 16);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(16);
    // Rejoining the chunks reproduces the original words in order.
    expect(chunks.join(" ")).toBe("one two three four five six seven eight nine ten");
  });

  it("returns [] for blank input", () => {
    expect(chunkCaption("   ", 64)).toEqual([]);
  });
});

describe("planReelClips", () => {
  it("makes the reel long enough to fit the full voiceover", () => {
    // A 43.6s voiceover must NOT be crammed into an 8s clip.
    const plan = planReelClips(43.6);
    expect(plan.reelDuration).toBeGreaterThanOrEqual(43.6);
    expect(plan.slotDurations.reduce((a, b) => a + b, 0)).toBeCloseTo(plan.reelDuration, 1);
    // Slots are ≤8s (Veo's clip cap) and distinct clips are capped for cost.
    for (const d of plan.slotDurations) expect(d).toBeLessThanOrEqual(8);
    expect(plan.distinctClips).toBeLessThanOrEqual(4);
    expect(plan.distinctClips).toBeGreaterThanOrEqual(1);
  });

  it("clamps a tiny voiceover to a single 8s clip", () => {
    const plan = planReelClips(2);
    expect(plan.reelDuration).toBe(8);
    expect(plan.slotDurations).toEqual([8]);
    expect(plan.distinctClips).toBe(1);
  });

  it("caps a very long voiceover at the max reel length", () => {
    const plan = planReelClips(300);
    expect(plan.reelDuration).toBeLessThanOrEqual(60);
  });
});

describe("buildReelLogos", () => {
  it("detects the AI tools a post mentions and maps them to logo slugs", () => {
    const logos = buildReelLogos({
      topic: "running AI locally",
      hook: "Swap ChatGPT for a local model",
      body: "Ollama is OpenAI-compatible; pair it with Claude for review.",
      cta: "Comment STACK",
    });
    const brands = logos.map((l) => l.brand);
    expect(brands).toContain("openai"); // ChatGPT/OpenAI
    expect(brands).toContain("claude");
    expect(logos.length).toBeLessThanOrEqual(3); // capped
  });

  it("returns no logos when no known brand is mentioned", () => {
    expect(buildReelLogos({ topic: "productivity tips", hook: "Do more", body: "Focus.", cta: "Go" })).toEqual([]);
  });
});

describe("buildReelVeoPrompt", () => {
  it("is topic-aware and stays visual-only (no on-screen text)", () => {
    const p = buildReelVeoPrompt("self-hosting AI on a $5 server");
    expect(p).toContain("self-hosting AI on a $5 server");
    expect(p).toMatch(/9:16/);
    expect(p).toMatch(/no on-screen text/i);
    // Not the old hardcoded cozy-laptop scene.
    expect(p).not.toMatch(/warm home-office/i);
  });

  it("still produces a valid prompt with no topic", () => {
    const p = buildReelVeoPrompt("");
    expect(p).toMatch(/9:16/);
    expect(p).toMatch(/no on-screen text/i);
  });
});

// ─── Inspiration (manual swipe file) routes ──────────────────────────────────
describe("inspiration routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    registerIgWizardRoutes(app);
    mockInspList.mockReset();
    mockInspCreate.mockReset();
    mockInspGet.mockReset();
    mockInspRemove.mockReset();
    mockWpCreate.mockReset();
    mockApifyScrape.mockReset();
    mockApifyDownload.mockReset();
    mockHasApify = true;
    // Adapt uses the real adaptInspiration → mocked internal-ai. Default to a
    // valid adapted caption payload.
    mockReturn = {
      text: JSON.stringify({
        hook: "You don't need a GPU",
        body: "Here's how.\n\nStep by step.",
        cta: "Comment VPS",
        hashtags: ["selfhosted"],
        style: "screen",
      }),
      ok: true,
      error: undefined,
    };
    mockHasProvider = true;
  });

  it("GET lists items", async () => {
    mockInspList.mockReturnValue([{ id: "i1", handle: "creator", format: "reel", caption: "x", mediaUrls: [] }]);
    const res = await app.request("/ig-wizard/inspiration");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it("POST creates an item (handle + caption required)", async () => {
    mockInspCreate.mockReturnValue({ id: "new", handle: "creator", format: "reel", caption: "ref", mediaUrls: [] });
    const res = await app.request("/ig-wizard/inspiration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@creator", format: "reel", caption: "ref post", mediaUrls: ["/api/media/file/a.mp4"] }),
    });
    expect(res.status).toBe(201);
    expect(mockInspCreate).toHaveBeenCalledWith(
      expect.objectContaining({ handle: "creator", caption: "ref post" }),
    );
  });

  it("POST rejects a missing handle (400)", async () => {
    const res = await app.request("/ig-wizard/inspiration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: "ref post" }),
    });
    expect(res.status).toBe(400);
    expect(mockInspCreate).not.toHaveBeenCalled();
  });

  it("POST rejects a missing caption (400)", async () => {
    const res = await app.request("/ig-wizard/inspiration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@creator", caption: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE removes an item, 404 when absent", async () => {
    mockInspRemove.mockReturnValueOnce(true);
    const ok = await app.request("/ig-wizard/inspiration/i1", { method: "DELETE" });
    expect(ok.status).toBe(200);

    mockInspRemove.mockReturnValueOnce(false);
    const gone = await app.request("/ig-wizard/inspiration/i1", { method: "DELETE" });
    expect(gone.status).toBe(404);
  });

  it("POST adapt rewrites the item + saves a wizard post (reel → reel format)", async () => {
    mockInspGet.mockReturnValue({
      id: "i1",
      handle: "creator",
      format: "reel",
      caption: "Stop paying for AI APIs.",
      topic: "self-hosting",
      mediaUrls: [],
    });
    mockWpCreate.mockReturnValue({ id: "wp1", format: "reel", hook: "You don't need a GPU" });

    const res = await app.request("/ig-wizard/inspiration/i1/adapt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.id).toBe("wp1");
    // The adapted caption was assembled + handed to the WizardPost store with
    // the format mapped from the inspiration (reel → reel).
    expect(mockWpCreate).toHaveBeenCalledWith(
      expect.objectContaining({ format: "reel", hook: "You don't need a GPU", source: "single" }),
    );
  });

  it("POST adapt maps a story inspiration to a post-format draft", async () => {
    mockInspGet.mockReturnValue({ id: "i2", handle: "c", format: "story", caption: "ref", mediaUrls: [] });
    mockWpCreate.mockReturnValue({ id: "wp2" });
    const res = await app.request("/ig-wizard/inspiration/i2/adapt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    expect(mockWpCreate).toHaveBeenCalledWith(expect.objectContaining({ format: "post" }));
  });

  it("POST adapt returns 404 for an unknown item", async () => {
    mockInspGet.mockReturnValue(null);
    const res = await app.request("/ig-wizard/inspiration/nope/adapt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("POST adapt surfaces the 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    mockInspGet.mockReturnValue({ id: "i1", handle: "c", format: "post", caption: "ref", mediaUrls: [] });
    const res = await app.request("/ig-wizard/inspiration/i1/adapt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect(mockWpCreate).not.toHaveBeenCalled();
  });

  // ── Apify Instagram import ──
  it("POST import-instagram scrapes + creates items with downloaded thumbnails", async () => {
    mockApifyScrape.mockResolvedValue([
      { caption: "c1", format: "reel", url: "https://ig/p/1", imageUrl: "https://cdn/1.jpg", videoUrl: null, ownerUsername: "creator", timestamp: null, likes: 10, comments: 1 },
    ]);
    mockApifyDownload.mockResolvedValue("/api/media/file/insp_1.jpg");
    mockInspCreate.mockImplementation((inp: Record<string, unknown>) => ({ id: "x", ...inp }));

    const res = await app.request("/ig-wizard/inspiration/import-instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@creator", limit: 12 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    // The downloaded local thumbnail (not the expiring CDN URL) is stored.
    expect(mockInspCreate).toHaveBeenCalledWith(
      expect.objectContaining({ handle: "creator", format: "reel", caption: "c1", mediaUrls: ["/api/media/file/insp_1.jpg"] }),
    );
  });

  it("import-instagram falls back to the raw URL when the thumbnail download fails", async () => {
    mockApifyScrape.mockResolvedValue([
      { caption: "c", format: "post", url: "u", imageUrl: "https://cdn/raw.jpg", videoUrl: null, ownerUsername: "creator", timestamp: null, likes: 0, comments: 0 },
    ]);
    mockApifyDownload.mockResolvedValue(null); // download failed
    mockInspCreate.mockImplementation((inp: Record<string, unknown>) => ({ id: "x", ...inp }));
    const res = await app.request("/ig-wizard/inspiration/import-instagram", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "creator" }),
    });
    expect(res.status).toBe(200);
    expect(mockInspCreate).toHaveBeenCalledWith(expect.objectContaining({ mediaUrls: ["https://cdn/raw.jpg"] }));
  });

  it("import-instagram returns 400 when no Apify token is configured", async () => {
    mockHasApify = false;
    const res = await app.request("/ig-wizard/inspiration/import-instagram", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "x" }),
    });
    expect(res.status).toBe(400);
    expect(mockApifyScrape).not.toHaveBeenCalled();
  });

  it("import-instagram returns 400 on a missing handle", async () => {
    const res = await app.request("/ig-wizard/inspiration/import-instagram", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("import-instagram surfaces scrape failures as 502", async () => {
    mockApifyScrape.mockRejectedValue(new Error("Apify scrape failed: quota"));
    const res = await app.request("/ig-wizard/inspiration/import-instagram", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "x" }),
    });
    expect(res.status).toBe(502);
  });
});
