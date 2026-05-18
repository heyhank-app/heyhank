// Tests for the remixPost workflow. The interesting behaviour is in the
// prompt-construction (does it include source + business context + style?)
// and the output shape (correct ContentPiece + remix metadata + rejection
// on malformed JSON). We mock callInternalAI so the model isn't called.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LibraryPost } from "../socialview/types.js";

const mockCallInternalAI = vi.hoisted(() => vi.fn());
vi.mock("../internal-ai.js", () => ({
  callInternalAI: mockCallInternalAI,
}));

// Style profiles are looked up per-creator — return null by default so the
// "no profile available" path is the default test surface.
const mockGetStyleProfile = vi.hoisted(() => vi.fn(() => null));
vi.mock("../socialview/style-profiles.js", () => ({
  getProfile: mockGetStyleProfile,
}));

let tempHome: string;
type RemixPostFn = (typeof import("./content-engine.js"))["remixPost"];
let remixPost: RemixPostFn;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "remix-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  mockCallInternalAI.mockReset();
  mockGetStyleProfile.mockReset().mockReturnValue(null);
  ({ remixPost } = await import("./content-engine.js"));
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

function makeLibraryPost(overrides: Partial<LibraryPost> & { id: string }): LibraryPost {
  return {
    id: overrides.id,
    platform: overrides.platform ?? "instagram",
    source: overrides.source ?? "role-model",
    url: overrides.url ?? `https://example/${overrides.id}`,
    author: overrides.author ?? { handle: "rileybrown.ai", displayName: "Riley Brown" },
    text: overrides.text ?? "I built a full SaaS in 8 hours with Claude Code. Here's how.",
    hook: overrides.hook ?? "I built a full SaaS in 8 hours.",
    cta: overrides.cta ?? "Comment 'Master AI' for the playbook.",
    hashtags: overrides.hashtags ?? ["aibuilding", "claudecode"],
    mentions: overrides.mentions ?? [],
    media: overrides.media ?? [],
    engagement: overrides.engagement ?? { likes: 12000, comments: 340, shares: 87, views: null, saves: 200 },
    engagementRate: overrides.engagementRate ?? 0.04,
    postType: overrides.postType ?? "reel",
    postedAt: overrides.postedAt ?? "2026-05-15T12:00:00Z",
    tags: overrides.tags ?? [],
    isGold: overrides.isGold ?? false,
    extractedAt: overrides.extractedAt ?? "2026-05-17T08:00:00Z",
    notes: overrides.notes ?? "",
  };
}

function writeLibraryPost(post: LibraryPost): void {
  const dir = join(tempHome, "socialview", "library", post.platform);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${post.id}.json`), JSON.stringify(post));
}

// Minimal WebsiteIntelligence stub — remixPost only reads a handful of fields
// (companyName, industry, businessType, targetAudience, usp, tone, language).
// Using `as any` keeps the test focused without enumerating the dozen other
// fields the production analyzer fills.
const intelligence: any = {
  url: "https://markusstoeger.com",
  companyName: "Markus Stoeger",
  industry: "AI / Software",
  businessType: "saas",
  targetAudience: "DACH SMB owners curious about AI",
  usp: ["builds voltah2-style cinematic sites in one night with Claude Code"],
  tone: "direct, confident, builder-grade",
  language: "en",
};

describe("remixPost", () => {
  // Happy path: model returns a clean JSON post, we wrap it in a ContentPiece
  // with the remix-source metadata attached for attribution + audit.
  it("returns a ContentPiece with source attribution", async () => {
    writeLibraryPost(makeLibraryPost({ id: "src1" }));
    mockCallInternalAI.mockResolvedValue({
      text: JSON.stringify({
        framework: "PAS",
        pillar: "AI Speedrun",
        targetPain: "agency quotes",
        hook: "I built voltah2 in one night.",
        headline: "voltah2 — one night, one prompt",
        body: "Three agencies wanted twenty grand. I built it overnight.",
        cta: "Comment 'Master AI' for the recipe.",
        hashtags: ["claudecode", "vibecoding"],
        imagePrompt: "Markus at concrete-wall office, laptop with voltah2",
      }),
    });

    const piece = await remixPost({
      sourcePostId: "src1",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
      businessAngle: "frame around voltah2",
    });

    expect(piece.hook).toContain("voltah2");
    expect(piece.framework).toBe("PAS");
    expect(piece.status).toBe("draft");
    expect(piece.remix).toBeDefined();
    expect(piece.remix?.sourcePostId).toBe("src1");
    expect(piece.remix?.sourceAuthor).toBe("rileybrown.ai");
    expect(piece.remix?.businessAngle).toBe("frame around voltah2");
  });

  // The prompt must include the source post and the business context — if
  // the prompt didn't contain the source, the model would be remixing from
  // air. Spot-check key fragments rather than fight prompt-template churn.
  it("includes source post + business context in the prompt", async () => {
    writeLibraryPost(makeLibraryPost({
      id: "src2",
      hook: "Three agencies quoted me $20K.",
      text: "Three agencies. $20K quote. I built it in one night.",
    }));
    mockCallInternalAI.mockResolvedValue({
      text: JSON.stringify({
        framework: "PAS", pillar: "x", targetPain: "x",
        hook: "x", headline: "x", body: "x", cta: "x",
        hashtags: [], imagePrompt: "x",
      }),
    });

    await remixPost({
      sourcePostId: "src2",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
    });

    expect(mockCallInternalAI).toHaveBeenCalled();
    const call = mockCallInternalAI.mock.calls[0][0] as { userPrompt: string };
    expect(call.userPrompt).toContain("Three agencies quoted me $20K");
    expect(call.userPrompt).toContain("Markus Stoeger");
    expect(call.userPrompt).toContain("voltah2"); // From USP
    expect(call.userPrompt).toContain("DACH SMB"); // From audience
  });

  // Model sometimes returns ```json fences despite instructions — must
  // strip them, not crash. Real Anthropic output frequently does this.
  it("strips ```json fences from model output before parsing", async () => {
    writeLibraryPost(makeLibraryPost({ id: "src3" }));
    mockCallInternalAI.mockResolvedValue({
      text: "```json\n" + JSON.stringify({
        framework: "AIDA", pillar: "x", targetPain: "x",
        hook: "h", headline: "h", body: "b", cta: "c",
        hashtags: ["a"], imagePrompt: "i",
      }) + "\n```",
    });

    const piece = await remixPost({
      sourcePostId: "src3",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
    });
    expect(piece.framework).toBe("AIDA");
    expect(piece.hook).toBe("h");
  });

  // Source post missing from library → throw with clear message so the
  // caller can return 404 to the UI.
  it("throws when source post is not in library", async () => {
    mockCallInternalAI.mockResolvedValue({ text: "{}" });
    await expect(remixPost({
      sourcePostId: "missing",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
    })).rejects.toThrow(/not found/);
    // Model should NOT have been invoked on missing source — that would
    // waste tokens before even attempting the operation.
    expect(mockCallInternalAI).not.toHaveBeenCalled();
  });

  // Malformed JSON from the model → useful error message that includes a
  // snippet of the raw output so the user can see why it failed.
  it("throws on non-JSON model output, surfacing the raw text", async () => {
    writeLibraryPost(makeLibraryPost({ id: "src4" }));
    mockCallInternalAI.mockResolvedValue({ text: "sorry, here is my answer instead of JSON" });

    await expect(remixPost({
      sourcePostId: "src4",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
    })).rejects.toThrow(/not valid JSON/);
  });

  // When the source author has a saved StyleProfile, the prompt should
  // include the voice fingerprint block.
  it("includes the source author's style profile in the prompt when available", async () => {
    writeLibraryPost(makeLibraryPost({ id: "src5", author: { handle: "knownauthor" } }));
    // Use a permissive cast — only the fields buildStyleProfileBlock reads
    // need to be present (contentPillars, toneOfVoice, etc.).
    mockGetStyleProfile.mockReturnValue({
      id: "p",
      platform: "instagram",
      handle: "knownauthor",
      displayName: "Known Author",
      basedOnPostCount: 10,
      basedOnPostIds: [],
      averageWordCount: 80,
      lengthCategory: "mittel",
      hookPatterns: [],
      ctaPatterns: [],
      emojiStyle: "sparsam",
      emojiList: [],
      hashtagStyle: "wenige",
      contentPillars: [],
      toneOfVoice: "test tone",
      commentEngagementPattern: null,
      rawAnalysis: null,
    } as any);
    mockCallInternalAI.mockResolvedValue({
      text: JSON.stringify({
        framework: "PAS", pillar: "x", targetPain: "x",
        hook: "h", headline: "h", body: "b", cta: "c",
        hashtags: [], imagePrompt: "i",
      }),
    });

    await remixPost({
      sourcePostId: "src5",
      sourcePlatform: "instagram",
      targetPlatform: "instagram",
      intelligence,
    });
    const call = mockCallInternalAI.mock.calls[0][0] as { userPrompt: string };
    expect(call.userPrompt).toMatch(/voice profile/i);
  });
});
