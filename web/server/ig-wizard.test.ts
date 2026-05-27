import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateIgWizard, normalizeLanguage, normalizeNiche } from "./ig-wizard.js";

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
