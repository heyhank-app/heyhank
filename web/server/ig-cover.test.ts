// Tests for the branded IG cover generator. The OpenAI fetch + the reference
// photos are stubbed so no real gpt-image-2 call happens and no real files on
// /opt are required. Output is written to a temp HEYHANK_HOME/media.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;
let refDir: string;
type CoverModule = typeof import("./ig-cover.js");
let cover: CoverModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "ig-cover-test-"));
  refDir = mkdtempSync(join(tmpdir(), "ig-cover-refs-"));
  // Fake reference photos so existsSync passes + readFileSync returns bytes.
  writeFileSync(join(refDir, "r1.jpeg"), Buffer.from([0xff, 0xd8, 0xff]));
  writeFileSync(join(refDir, "r2.jpeg"), Buffer.from([0xff, 0xd8, 0xff]));
  process.env.HEYHANK_HOME = tempHome;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.MARKUS_REF_1 = join(refDir, "r1.jpeg");
  process.env.MARKUS_REF_2 = join(refDir, "r2.jpeg");
  vi.resetModules();
  cover = await import("./ig-cover.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(refDir, { recursive: true, force: true });
  delete process.env.OPENAI_API_KEY;
  delete process.env.MARKUS_REF_1;
  delete process.env.MARKUS_REF_2;
});

// A 1x1 PNG, base64 — what gpt-image-2 would return in data[0].b64_json.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("buildIgCoverPrompt", () => {
  it("embeds the headline + badge + identity anchors", () => {
    const p = cover.buildIgCoverPrompt({ headline: "Stop renting your AI", badge: "Built with AI", hero: "laptop" });
    expect(p).toContain("Stop renting your AI");
    expect(p).toContain("Built with AI");
    expect(p).toContain("M-cap");
    expect(p).toContain("1:1 square");
    expect(p).toContain("laptop");
  });

  it("defaults the badge + hero when omitted", () => {
    const p = cover.buildIgCoverPrompt({ headline: "Hi" });
    expect(p).toContain("Built with AI");
    expect(p).toContain("notebook");
  });

  it("varies the composition per style while keeping the locked identity", () => {
    const business = cover.buildIgCoverPrompt({ headline: "X", style: "business" });
    const pointing = cover.buildIgCoverPrompt({ headline: "X", style: "pointing" });
    const bold = cover.buildIgCoverPrompt({ headline: "X", style: "bold" });
    const screen = cover.buildIgCoverPrompt({ headline: "X", style: "screen" });
    // Every style keeps the M-cap identity anchor.
    for (const p of [business, pointing, bold, screen]) expect(p).toContain("M-cap");
    // But each has its own composition cue.
    expect(business).toMatch(/studio|professional|collared/i);
    expect(pointing).toMatch(/pointing|gestur/i);
    expect(bold).toMatch(/DOMINATES|typography|poster/i);
    expect(screen).toMatch(/screen|monitor|dashboard/i);
  });

  it("normalizeStyle falls back to cozy for unknown values", () => {
    expect(cover.normalizeStyle("business")).toBe("business");
    expect(cover.normalizeStyle("nonsense")).toBe("cozy");
    expect(cover.normalizeStyle(undefined)).toBe("cozy");
  });

  it("exposes the 5-style library", () => {
    expect(cover.IG_STYLES.map((s) => s.id)).toEqual(["cozy", "business", "pointing", "bold", "screen"]);
  });

  it("drops the M-cap from the prompt when cap is false", () => {
    const capped = cover.buildIgCoverPrompt({ headline: "X", cap: true });
    const bare = cover.buildIgCoverPrompt({ headline: "X", cap: false });
    expect(capped).toContain("M-cap");
    expect(bare).not.toContain("M-cap");
    expect(bare).toMatch(/NO hat|bare head|bald/i);
  });
});

describe("generateIgCover", () => {
  it("posts to the edits endpoint with refs and saves the decoded PNG", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init.headers as Record<string, string>).Authorization;
      // The body is FormData with model + refs.
      expect(init.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
    });

    const res = await cover.generateIgCover(
      { headline: "Self-host your AI", hero: "notebook" },
      { fetch: fakeFetch as never, now: () => 1717000000000, rand: () => "abc123" },
    );

    expect(capturedUrl).toContain("/v1/images/edits");
    expect(capturedAuth).toBe("Bearer test-key");
    expect(res.filename).toBe("img_1717000000000_abc123.png");
    expect(res.url).toBe("/api/media/file/img_1717000000000_abc123.png");
    expect(res.model).toBe("gpt-image-2");
    // The file was actually written + decoded.
    expect(existsSync(res.path)).toBe(true);
    expect(readFileSync(res.path).length).toBeGreaterThan(0);
  });

  it("throws a clean error when the API returns an error", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "content policy" } }), { status: 400 }),
    );
    await expect(
      cover.generateIgCover({ headline: "x" }, { fetch: fakeFetch as never }),
    ).rejects.toThrow(/content policy/);
  });

  it("throws when no image data comes back", async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(
      cover.generateIgCover({ headline: "x" }, { fetch: fakeFetch as never }),
    ).rejects.toThrow(/no image data/);
  });

  it("requires a headline", async () => {
    const fakeFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      cover.generateIgCover({ headline: "  " }, { fetch: fakeFetch as never }),
    ).rejects.toThrow(/headline is required/);
  });
});
