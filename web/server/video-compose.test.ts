import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
  buildDrawtextFilter,
  escapeDrawtext,
  composeReel,
  wrapTextToWidth,
  expandOverlayToLines,
} from "./video-compose.js";
import { getTheme } from "./brand-themes.js";

// These tests run real ffmpeg invocations. They write into a temp HEYHANK_HOME
// so the production media dir stays clean.
let tempHome: string;
beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-compose-test-"));
  process.env.HEYHANK_HOME = tempHome;
});

function makeColorImage(path: string, width = 720, height = 1280, color = "blue"): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${width}x${height}:d=1`,
      "-frames:v",
      "1",
      path,
    ], { stdio: "ignore" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg color image failed: ${code}`))));
    p.on("error", reject);
  });
}

describe("escapeDrawtext()", () => {
  it("escapes filter-syntax characters", () => {
    // The filter syntax treats `:` and `\` specially; both must be doubled
    // for drawtext to consume them as literals.
    expect(escapeDrawtext("a:b")).toBe("a\\:b");
    expect(escapeDrawtext("a\\b")).toBe("a\\\\b");
  });

  it("converts straight apostrophes to typographic quotes", () => {
    // Inside the quoted text='…' form a literal ' would close the string.
    // Smart quote sidesteps the close/escape/reopen dance entirely.
    expect(escapeDrawtext("it's")).toBe("it’s");
  });

  it("converts \\n character into ffmpeg's two-char line-break sequence", () => {
    // drawtext renders the literal backslash-n as a line break.
    expect(escapeDrawtext("line1\nline2")).toBe("line1\\nline2");
  });
});

describe("wrapTextToWidth()", () => {
  it("keeps short text on a single line", () => {
    expect(wrapTextToWidth("Hello world", 40)).toEqual(["Hello world"]);
  });

  it("wraps greedily on word boundaries", () => {
    // "Most business owners think AI is just a chat bot" at 25 chars/line
    // should break after "owners" (24 chars) and continue.
    const lines = wrapTextToWidth("Most business owners think AI is just a chat bot", 25);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28);
  });

  it("preserves user-supplied \\n as a forced break", () => {
    // The newline marks a deliberate stanza split — wrap MUST honor it
    // regardless of remaining char budget on the line.
    expect(wrapTextToWidth("line one\nline two", 99)).toEqual(["line one", "line two"]);
  });

  it("keeps an over-budget word on its own line rather than mid-word split", () => {
    // A 30-char word at budget=10 still gets one line — never split mid-word
    // (better an overflow tile than mangled text).
    const lines = wrapTextToWidth("supercalifragilisticexpialidocious", 10);
    expect(lines).toEqual(["supercalifragilisticexpialidocious"]);
  });
});

describe("expandOverlayToLines()", () => {
  const claudeTheme = getTheme("claude");

  it("returns a single drawtext when no wrap and no \\n", () => {
    // Should be indistinguishable from buildDrawtextFilter for the simple case.
    const out = expandOverlayToLines({ text: "Hi" }, claudeTheme);
    expect(out).toContain("text='Hi'");
    expect(out.split("drawtext=").length - 1).toBe(1);
  });

  it("emits one drawtext per line when maxWidth forces wrapping", () => {
    const out = expandOverlayToLines(
      { text: "one two three four five six seven", fontSize: 40, maxWidth: 200 },
      claudeTheme,
    );
    expect(out.split("drawtext=").length - 1).toBeGreaterThan(1);
  });

  it("offsets subsequent lines by lineHeight × fontSize", () => {
    // With fontSize=50 + lineHeight=1.2, line spacing = 60. Second line's y
    // expression must include the +60 offset.
    const out = expandOverlayToLines(
      { text: "one\ntwo", fontSize: 50, lineHeight: 1.2, position: { y: 100 } },
      claudeTheme,
    );
    expect(out).toMatch(/y=100\+60/);
  });
});

describe("buildDrawtextFilter()", () => {
  it("uses headline colour from theme when no override is set", () => {
    const theme = getTheme("claude");
    const filter = buildDrawtextFilter({ text: "Hi" }, theme);
    // claude theme.headline = #FFFFFF
    expect(filter).toContain("fontcolor=#FFFFFF");
    // Default centred position evaluates to the (h-text_h)/2 expression
    expect(filter).toContain("y=(h-text_h)/2");
  });

  it("supports an explicit numeric y position", () => {
    const filter = buildDrawtextFilter({ text: "Hi", position: { y: 200 } }, getTheme("neutral"));
    expect(filter).toContain("y=200");
  });

  it("anchors 'bottom' to the bottom edge, lifted by bottomOffset when set", () => {
    // Default bottom uses the font size as the margin.
    const def = buildDrawtextFilter({ text: "Hi", position: "bottom", fontSize: 40 }, getTheme("neutral"));
    expect(def).toContain("y=h-text_h-40");
    // bottomOffset lifts the box into the readable lower third.
    const lifted = buildDrawtextFilter({ text: "Hi", position: "bottom", fontSize: 40, bottomOffset: 220 }, getTheme("neutral"));
    expect(lifted).toContain("y=h-text_h-220");
  });

  it("adds a padded box when bgColor is set", () => {
    const filter = buildDrawtextFilter(
      { text: "Badge", bgColor: "#D97757", bgPadding: 24 },
      getTheme("claude"),
    );
    expect(filter).toContain("box=1");
    expect(filter).toContain("boxcolor=#D97757@0.92");
    expect(filter).toContain("boxborderw=24");
  });

  it("includes an enable expression when timing is specified", () => {
    const filter = buildDrawtextFilter(
      { text: "Timed", startSeconds: 1, endSeconds: 3 },
      getTheme("neutral"),
    );
    expect(filter).toContain("enable='between(t,1,3)'");
  });
});

describe("composeReel() integration", () => {
  it("rejects empty segment lists", async () => {
    await expect(composeReel({ segments: [] })).rejects.toThrow(/at least one segment/);
  });

  it("renders a single-image segment into a playable mp4", async () => {
    const img = join(tempHome, "single.png");
    await makeColorImage(img, 720, 1280, "navy");

    const result = await composeReel({
      segments: [
        {
          type: "image",
          path: img,
          durationSeconds: 2,
          textOverlays: [{ text: "Hello", position: "center" }],
        },
      ],
      brand: "claude",
    });

    expect(result.themeSlug).toBe("claude");
    expect(result.durationSeconds).toBe(2);
    expect(existsSync(result.videoPath)).toBe(true);
    expect(statSync(result.videoPath).size).toBeGreaterThan(1000);
  }, 60000);

  it("concatenates multiple segments and reports their total duration", async () => {
    const img1 = join(tempHome, "a.png");
    const img2 = join(tempHome, "b.png");
    await makeColorImage(img1, 720, 1280, "red");
    await makeColorImage(img2, 720, 1280, "green");

    const result = await composeReel({
      segments: [
        { type: "image", path: img1, durationSeconds: 1.5 },
        { type: "image", path: img2, durationSeconds: 2 },
      ],
      brand: "openai",
      outputName: "test_concat",
    });

    expect(result.durationSeconds).toBe(3.5);
    expect(result.videoPath).toMatch(/test_concat\.mp4$/);
    expect(existsSync(result.videoPath)).toBe(true);
  }, 90000);

  it("falls back to the neutral theme on unknown brand slugs", async () => {
    const img = join(tempHome, "neutral.png");
    await makeColorImage(img, 720, 1280, "gray");

    const result = await composeReel({
      segments: [{ type: "image", path: img, durationSeconds: 1 }],
      brand: "not-a-real-brand-xyz",
    });

    expect(result.themeSlug).toBe("neutral");
  }, 60000);
});
