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
