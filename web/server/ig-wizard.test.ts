import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateIgWizard,
  generateCaption,
  adaptInspiration,
  generatePlan,
  generateCarouselScript,
  normalizeLanguage,
  normalizeNiche,
  normalizeTopic,
  normalizeOptionalLine,
  normalizeHashtags,
  assembleCaption,
  normalizePlanDays,
  normalizeSlideCount,
} from "./ig-wizard.js";

// Mock the AI provider for predictable tests.
let mockReturn = { text: "", ok: true, error: undefined as string | undefined };
let mockHasProvider = true;
vi.mock("./internal-ai.js", () => ({
  callInternalAI: vi.fn(async () => mockReturn),
  hasInternalAI: vi.fn(() => mockHasProvider),
}));

function validPayload(): string {
  return JSON.stringify({
    hooks: Array.from({ length: 20 }, (_, i) => `Hook ${i + 1}`),
    ctas: {
      engagement: Array.from({ length: 10 }, (_, i) => `Engagement ${i + 1}`),
      leads: Array.from({ length: 10 }, (_, i) => `Comment WORD${i + 1}`),
      growth: Array.from({ length: 10 }, (_, i) => `Follow ${i + 1}`),
    },
  });
}

beforeEach(() => {
  mockReturn = { text: validPayload(), ok: true, error: undefined };
  mockHasProvider = true;
});

describe("normalizeLanguage", () => {
  it("returns 'de' when input is exactly 'de' (case-insensitive)", () => {
    expect(normalizeLanguage("de")).toBe("de");
    expect(normalizeLanguage("DE")).toBe("de");
    expect(normalizeLanguage("De")).toBe("de");
  });
  it("returns 'en' for anything else", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage("english")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage(123)).toBe("en");
  });
});

describe("normalizeNiche", () => {
  it("trims whitespace", () => {
    expect(normalizeNiche("  AI productivity  ")).toBe("AI productivity");
  });
  it("returns empty string for non-string input", () => {
    expect(normalizeNiche(undefined)).toBe("");
    expect(normalizeNiche(null)).toBe("");
    expect(normalizeNiche(123)).toBe("");
  });
  it("truncates input to 200 chars (prompt-injection ceiling)", () => {
    const longInput = "x".repeat(1000);
    expect(normalizeNiche(longInput).length).toBe(200);
  });
});

describe("generateIgWizard", () => {
  it("returns ok:true with parsed result on success", async () => {
    const res = await generateIgWizard("AI", "en");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.hooks).toHaveLength(20);
    expect(res.result.ctas.leads).toHaveLength(10);
    expect(res.result.niche).toBe("AI");
    expect(res.result.language).toBe("en");
  });

  it("returns ok:false status 503 when no AI provider", async () => {
    mockHasProvider = false;
    const res = await generateIgWizard("AI", "en");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
  });

  it("returns ok:false status 502 when AI call fails", async () => {
    mockReturn = { text: "", ok: false, error: "rate limit" };
    const res = await generateIgWizard("AI", "en");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(502);
    expect(res.error).toMatch(/rate limit/i);
  });

  it("returns ok:false status 502 when AI returns junk", async () => {
    mockReturn = { text: "I cannot help with that.", ok: true, error: undefined };
    const res = await generateIgWizard("AI", "en");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(502);
  });

  it("substitutes '(empty)' for missing niche so the caller sees the empty path", async () => {
    const res = await generateIgWizard("", "en");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.niche).toBe("(empty)");
  });
});

// ─── Caption Composer ──────────────────────────────────────────────────────────

describe("normalizeHashtags", () => {
  it("strips leading #, dedupes case-insensitively, drops blanks", () => {
    expect(normalizeHashtags(["#AI", "ai", " build ", "", "#Build"])).toEqual(["AI", "build"]);
  });
  it("returns [] for non-arrays", () => {
    expect(normalizeHashtags("nope")).toEqual([]);
    expect(normalizeHashtags(undefined)).toEqual([]);
  });
  it("caps at 15 tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    expect(normalizeHashtags(many)).toHaveLength(15);
  });
});

describe("assembleCaption", () => {
  it("joins hook + body + cta + #hashtags with blank lines", () => {
    const out = assembleCaption({
      hook: "Stop scrolling",
      body: "Line one\n\nLine two",
      cta: "Comment GUIDE",
      hashtags: ["ai", "build"],
    });
    expect(out).toBe("Stop scrolling\n\nLine one\n\nLine two\n\nComment GUIDE\n\n#ai #build");
  });
  it("omits empty parts cleanly", () => {
    const out = assembleCaption({ hook: "Hook only", body: "", cta: "", hashtags: [] });
    expect(out).toBe("Hook only");
  });
});

describe("normalizeTopic / normalizeOptionalLine", () => {
  it("normalizeTopic trims + caps at 300", () => {
    expect(normalizeTopic("  hi  ")).toBe("hi");
    expect(normalizeTopic("x".repeat(500)).length).toBe(300);
    expect(normalizeTopic(42)).toBe("");
  });
  it("normalizeOptionalLine returns undefined for blank/non-string", () => {
    expect(normalizeOptionalLine("  ")).toBeUndefined();
    expect(normalizeOptionalLine(undefined)).toBeUndefined();
    expect(normalizeOptionalLine("a hook")).toBe("a hook");
  });
});

describe("generateCaption", () => {
  const captionPayload = JSON.stringify({
    hook: "AI wrote this in 3 minutes",
    body: "Here's the exact workflow.\n\nNo fluff.",
    cta: "Comment BUILD for the template",
    hashtags: ["#ai", "automation", "ai"], // dupe + # to exercise normalization
  });

  beforeEach(() => {
    mockReturn = { text: captionPayload, ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("returns a fully assembled caption on success", async () => {
    const res = await generateCaption({ topic: "AI workflows", language: "en" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.hook).toBe("AI wrote this in 3 minutes");
    expect(res.result.hashtags).toEqual(["ai", "automation"]); // normalized + deduped
    // The assembled caption contains all parts.
    expect(res.result.caption).toContain("AI wrote this in 3 minutes");
    expect(res.result.caption).toContain("#ai #automation");
  });

  it("honours a user-supplied hook + CTA verbatim over the model's", async () => {
    const res = await generateCaption({
      topic: "AI",
      language: "en",
      hook: "MY EXACT HOOK",
      cta: "MY EXACT CTA",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.hook).toBe("MY EXACT HOOK");
    expect(res.result.cta).toBe("MY EXACT CTA");
    expect(res.result.caption.startsWith("MY EXACT HOOK")).toBe(true);
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await generateCaption({ topic: "AI", language: "en" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
  });

  it("returns 502 when the model returns junk", async () => {
    mockReturn = { text: "Sorry, I can't.", ok: true, error: undefined };
    const res = await generateCaption({ topic: "AI", language: "en" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(502);
  });

  it("returns the AI-suggested style (falls back to cozy if missing/unknown)", async () => {
    mockReturn = { text: JSON.stringify({ hook: "h", body: "b", cta: "c", hashtags: [], style: "pointing" }), ok: true, error: undefined };
    const r1 = await generateCaption({ topic: "AI", language: "en" });
    expect(r1.ok && r1.result.style).toBe("pointing");

    mockReturn = { text: JSON.stringify({ hook: "h", body: "b", cta: "c", hashtags: [] }), ok: true, error: undefined };
    const r2 = await generateCaption({ topic: "AI", language: "en" });
    expect(r2.ok && r2.result.style).toBe("cozy");
  });
});

describe("adaptInspiration", () => {
  const adaptedPayload = JSON.stringify({
    hook: "You don't need a GPU to run AI",
    body: "Here's how I do it on a $5 box.\n\nStep by step.",
    cta: "Comment VPS for the setup",
    hashtags: ["selfhosted", "ai"],
    style: "screen",
  });

  beforeEach(() => {
    mockReturn = { text: adaptedPayload, ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("rewrites a reference post into a fully assembled caption", async () => {
    const res = await adaptInspiration({
      handle: "vaibhavsisinty",
      format: "reel",
      referenceCaption: "Stop paying for AI APIs. Here's why self-hosting wins.",
      language: "en",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.hook).toBe("You don't need a GPU to run AI");
    expect(res.result.style).toBe("screen");
    expect(res.result.caption).toContain("#selfhosted #ai");
  });

  it("requires a non-empty reference caption (400)", async () => {
    const res = await adaptInspiration({ handle: "x", format: "post", referenceCaption: "  ", language: "en" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await adaptInspiration({ handle: "x", format: "post", referenceCaption: "ref", language: "en" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
  });

  it("returns 502 when the model returns junk", async () => {
    mockReturn = { text: "no json here", ok: true, error: undefined };
    const res = await adaptInspiration({ handle: "x", format: "post", referenceCaption: "ref", language: "de" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(502);
  });
});

// ─── 30-Day Plan ────────────────────────────────────────────────────────────────

describe("normalizePlanDays", () => {
  it("defaults to 30 for non-numbers", () => {
    expect(normalizePlanDays(undefined)).toBe(30);
    expect(normalizePlanDays("abc")).toBe(30);
  });
  it("clamps to 1..30", () => {
    expect(normalizePlanDays(0)).toBe(1);
    expect(normalizePlanDays(100)).toBe(30);
    expect(normalizePlanDays(7)).toBe(7);
    expect(normalizePlanDays("14")).toBe(14);
  });
});

describe("generatePlan", () => {
  function planPayload(n: number): string {
    return JSON.stringify({
      briefs: Array.from({ length: n }, (_, i) => ({
        day: i + 1,
        angle: `Angle ${i + 1}`,
        hook: `Hook ${i + 1}`,
        ctaType: i % 3 === 0 ? "lead" : i % 3 === 1 ? "engagement" : "growth",
      })),
    });
  }

  beforeEach(() => {
    mockReturn = { text: planPayload(30), ok: true, error: undefined };
    mockHasProvider = true;
  });

  it("returns 30 sequentially-numbered briefs on success", async () => {
    const res = await generatePlan({ topic: "AI tools", language: "en", days: 30 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.briefs).toHaveLength(30);
    expect(res.result.briefs[0].day).toBe(1);
    expect(res.result.briefs[29].day).toBe(30);
    expect(res.result.topic).toBe("AI tools");
  });

  it("re-numbers days sequentially even if the model skips/garbles day fields", async () => {
    mockReturn = {
      text: JSON.stringify({
        briefs: [
          { day: 5, angle: "a", hook: "h1", ctaType: "lead" },
          { day: 99, angle: "b", hook: "h2", ctaType: "bogus" },
        ],
      }),
      ok: true,
      error: undefined,
    };
    const res = await generatePlan({ topic: "x", language: "en", days: 30 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.briefs.map((b) => b.day)).toEqual([1, 2]);
    // Unknown ctaType falls back to "engagement".
    expect(res.result.briefs[1].ctaType).toBe("engagement");
  });

  it("caps the briefs at the requested day count", async () => {
    mockReturn = { text: planPayload(30), ok: true, error: undefined };
    const res = await generatePlan({ topic: "x", language: "en", days: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.briefs).toHaveLength(7);
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockHasProvider = false;
    const res = await generatePlan({ topic: "x", language: "en", days: 30 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
  });

  it("returns 502 when the model returns junk", async () => {
    mockReturn = { text: "not a plan", ok: true, error: undefined };
    const res = await generatePlan({ topic: "x", language: "en", days: 30 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(502);
  });
});

// ─── Carousel Script ────────────────────────────────────────────────────────────

describe("normalizeSlideCount", () => {
  it("defaults to 5 + clamps to 3..10", () => {
    expect(normalizeSlideCount(undefined)).toBe(5);
    expect(normalizeSlideCount(1)).toBe(3);
    expect(normalizeSlideCount(99)).toBe(10);
    expect(normalizeSlideCount("7")).toBe(7);
  });
});

describe("generateCarouselScript", () => {
  beforeEach(() => {
    mockReturn = {
      text: JSON.stringify({ slides: Array.from({ length: 5 }, (_, i) => ({ text: `Slide ${i + 1}` })) }),
      ok: true,
      error: undefined,
    };
    mockHasProvider = true;
  });

  it("returns N slides on success", async () => {
    const res = await generateCarouselScript({ topic: "AI", hook: "h", body: "b", cta: "c", language: "en", slides: 5 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.slides).toHaveLength(5);
    expect(res.result.slides[0].text).toBe("Slide 1");
  });

  it("caps slides at the requested count + drops blanks", async () => {
    mockReturn = { text: JSON.stringify({ slides: [{ text: "A" }, { text: "" }, { text: "B" }] }), ok: true, error: undefined };
    const res = await generateCarouselScript({ topic: "x", hook: "h", body: "b", cta: "c", language: "en", slides: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.slides.map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("carries the per-slide visual concept through (for person-free middle slides)", async () => {
    mockReturn = {
      text: JSON.stringify({ slides: [{ text: "A", visual: "terminal motif" }, { text: "B" }] }),
      ok: true,
      error: undefined,
    };
    const res = await generateCarouselScript({ topic: "x", hook: "h", body: "b", cta: "c", language: "en", slides: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.slides[0].visual).toBe("terminal motif");
    expect(res.result.slides[1].visual).toBeUndefined(); // missing visual → undefined, not a crash
  });

  it("returns 503 when no provider, 502 on junk", async () => {
    mockHasProvider = false;
    expect((await generateCarouselScript({ topic: "x", hook: "h", body: "b", cta: "c", language: "en", slides: 5 })).ok).toBe(false);
    mockHasProvider = true;
    mockReturn = { text: "not json", ok: true, error: undefined };
    const r = await generateCarouselScript({ topic: "x", hook: "h", body: "b", cta: "c", language: "en", slides: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(502);
  });
});
