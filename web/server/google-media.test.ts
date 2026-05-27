import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// listMedia uses HEYHANK_HOME at import-time via paths.ts, so we set it before
// importing the module fresh in each test (via vi.resetModules).
import { vi } from "vitest";

let tempHome: string;
let mediaDir: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-listmedia-"));
  process.env.HEYHANK_HOME = tempHome;
  mediaDir = join(tempHome, "media");
  mkdirSync(mediaDir, { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("listMedia()", () => {
  it("returns files sorted by mtime descending (newest first)", async () => {
    // Three files with explicit, monotonic timestamps so the assertion is deterministic
    // regardless of how fast the test runs. utimesSync uses seconds since epoch.
    const oldFile = join(mediaDir, "old.png");
    const midFile = join(mediaDir, "mid.png");
    const newFile = join(mediaDir, "new.png");
    writeFileSync(oldFile, Buffer.from([1]));
    writeFileSync(midFile, Buffer.from([2]));
    writeFileSync(newFile, Buffer.from([3]));

    const baseSeconds = Math.floor(Date.now() / 1000) - 1000;
    utimesSync(oldFile, baseSeconds, baseSeconds);
    utimesSync(midFile, baseSeconds + 100, baseSeconds + 100);
    utimesSync(newFile, baseSeconds + 200, baseSeconds + 200);

    const { listMedia } = await import("./google-media.js");
    const files = listMedia();

    expect(files.map((f) => f.filename)).toEqual(["new.png", "mid.png", "old.png"]);
    // mtime monotonically decreases
    expect(files[0].mtime).toBeGreaterThan(files[1].mtime);
    expect(files[1].mtime).toBeGreaterThan(files[2].mtime);
  });

  it("returns an empty array when the media dir is empty", async () => {
    const { listMedia } = await import("./google-media.js");
    expect(listMedia()).toEqual([]);
  });

  it("includes mtime as a number on every entry", async () => {
    writeFileSync(join(mediaDir, "a.png"), Buffer.from([1]));
    const { listMedia } = await import("./google-media.js");
    const files = listMedia();
    expect(files).toHaveLength(1);
    expect(typeof files[0].mtime).toBe("number");
    expect(files[0].mtime).toBeGreaterThan(0);
  });
});
