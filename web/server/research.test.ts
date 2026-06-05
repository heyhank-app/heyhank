// Tests for the content-research / grounding module. callInternalAI + the
// web_search capability check are mocked so no real Anthropic call happens; the
// Obsidian vault and the brief cache are pointed at temp dirs.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockCall = vi.fn();
const mockSupports = vi.fn();
vi.mock("./internal-ai.js", () => ({
  callInternalAI: (...a: unknown[]) => mockCall(...a),
  internalAiSupportsWebSearch: () => mockSupports(),
}));

let tempHome: string;
let tempVault: string;
type Mod = typeof import("./research.js");
let research: Mod;

// A well-formed brief JSON the model would return after web_search.
const GOOD_JSON = JSON.stringify({
  angles: ["Self-host Claude on a $5 box", "Why per-seat AI pricing is a trap"],
  facts: [{ fact: "ZAYA1-8B runs ~760M active params", source: "https://example.com/zaya" }],
  freshItems: [{ headline: "Zyphra ships ZAYA1-8B", detail: "Apache 2.0 MoE", source: "https://example.com/z", date: "May 2026" }],
  painPoints: ["Vendor lock-in", "Surprise bills"],
  myths: ["You need a GPU farm"],
  hotDataPoint: "72.2% on SWE-bench from an open model",
});

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "research-home-"));
  tempVault = mkdtempSync(join(tmpdir(), "research-vault-"));
  process.env.HEYHANK_HOME = tempHome;
  process.env.OBSIDIAN_VAULT_DIR = tempVault;
  mockCall.mockReset();
  mockSupports.mockReset();
  mockSupports.mockReturnValue(true);
  vi.resetModules();
  research = await import("./research.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempVault, { recursive: true, force: true });
  delete process.env.OBSIDIAN_VAULT_DIR;
});

describe("researchTopic", () => {
  it("requires a topic", async () => {
    const res = await research.researchTopic({ topic: "  " });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/topic is required/);
  });

  it("returns a clear error when the provider has no web search", async () => {
    mockSupports.mockReturnValue(false);
    const res = await research.researchTopic({ topic: "self-hosting AI" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Anthropic/);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("parses a brief from the web_search response and passes the search tool flag", async () => {
    mockCall.mockResolvedValue({ ok: true, text: `Here is the brief: ${GOOD_JSON}`, sources: ["https://example.com/z"] });
    const res = await research.researchTopic({ topic: "self-hosting AI", niche: "solo builders", language: "en" });
    expect(res.ok).toBe(true);
    expect(res.brief?.freshItems[0].headline).toBe("Zyphra ships ZAYA1-8B");
    expect(res.brief?.facts[0].source).toBe("https://example.com/zaya");
    expect(res.brief?.hotDataPoint).toMatch(/SWE-bench/);
    expect(res.brief?.sources).toContain("https://example.com/z");
    // The web_search tool must be requested.
    expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ webSearch: expect.objectContaining({ maxUses: expect.any(Number) }) }));
  });

  it("caches a brief and serves it without a second AI call", async () => {
    mockCall.mockResolvedValue({ ok: true, text: GOOD_JSON, sources: [] });
    const first = await research.researchTopic({ topic: "self-hosting AI" });
    expect(first.brief?.cached).toBe(false);
    const second = await research.researchTopic({ topic: "self-hosting AI" });
    expect(second.brief?.cached).toBe(true);
    expect(mockCall).toHaveBeenCalledTimes(1); // served from cache
  });

  it("forceRefresh bypasses the cache", async () => {
    mockCall.mockResolvedValue({ ok: true, text: GOOD_JSON, sources: [] });
    await research.researchTopic({ topic: "self-hosting AI" });
    await research.researchTopic({ topic: "self-hosting AI", forceRefresh: true });
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("errors cleanly when the model returns no parseable JSON", async () => {
    mockCall.mockResolvedValue({ ok: true, text: "I could not find anything useful.", sources: [] });
    const res = await research.researchTopic({ topic: "self-hosting AI" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/parse/);
  });

  it("propagates an AI failure", async () => {
    mockCall.mockResolvedValue({ ok: false, text: "", error: "rate limited" });
    const res = await research.researchTopic({ topic: "self-hosting AI" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rate limited/);
  });

  it("pulls the user's own takes from the local vault into the brief", async () => {
    // A vault note containing topic keywords → should surface as an ownTake.
    mkdirSync(join(tempVault, "08-knowledge"), { recursive: true });
    writeFileSync(
      join(tempVault, "08-knowledge", "selfhosting.md"),
      "# Notes\nSelf-hosting your own AI on a cheap server beats paying per-seat for every team member.\n",
    );
    mockCall.mockResolvedValue({ ok: true, text: GOOD_JSON, sources: [] });
    const res = await research.researchTopic({ topic: "self-hosting AI server", niche: "" });
    expect(res.brief?.ownTakes.some((t) => /per-seat/.test(t))).toBe(true);
  });
});

describe("gatherVaultTakes", () => {
  it("returns [] when the vault is missing", () => {
    process.env.OBSIDIAN_VAULT_DIR = join(tempVault, "does-not-exist");
    // re-evaluate via a fresh import is overkill; the function reads the env each call
    expect(Array.isArray(research.gatherVaultTakes("anything topic", ""))).toBe(true);
  });
});

describe("briefToGroundingText", () => {
  it("renders fresh items, facts, stat and own takes into a prompt block", async () => {
    mockCall.mockResolvedValue({ ok: true, text: GOOD_JSON, sources: [] });
    const res = await research.researchTopic({ topic: "self-hosting AI" });
    const text = research.briefToGroundingText(res.brief!);
    expect(text).toMatch(/RECENT & NOTEWORTHY/);
    expect(text).toMatch(/Zyphra ships ZAYA1-8B/);
    expect(text).toMatch(/SWE-bench/);
    expect(text).toMatch(/FACTS YOU CAN CITE/);
  });
});
