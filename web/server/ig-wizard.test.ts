import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateIgWizard,
  generateCaption,
  normalizeLanguage,
  normalizeNiche,
  normalizeTopic,
  normalizeOptionalLine,
  normalizeHashtags,
  assembleCaption,
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
});
