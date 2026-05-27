import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-logo-test-"));
  process.env.HEYHANK_HOME = tempHome;
  mkdirSync(join(tempHome, "reference-images", "logos"), { recursive: true });
  // paths.ts caches HEYHANK_HOME at import-time; reset so each test gets
  // a fresh module bound to that test's tempHome.
  vi.resetModules();
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
  // Restore fetch + any other spies between tests so we don't inherit
  // call-history when subsequent tests assert "not called".
  vi.restoreAllMocks();
});

describe("resolveLogo()", () => {
  it("returns existing logo without generating a placeholder", async () => {
    // Seed a fake claude.png the way the real install would.
    const seededPath = join(tempHome, "reference-images", "logos", "claude.png");
    writeFileSync(seededPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    const before = statSync(seededPath).size;

    const { resolveLogo } = await import("./logo-resolver.js");
    const result = await resolveLogo("claude");

    expect(result.slug).toBe("claude");
    expect(result.path).toBe(seededPath);
    expect(result.isPlaceholder).toBe(false);
    // File untouched — generator must NOT overwrite a real logo.
    expect(statSync(seededPath).size).toBe(before);
  });

  it("fetches the official logo from the web when available + saves it", async () => {
    const expectedPath = join(tempHome, "reference-images", "logos", "openai.png");
    expect(existsSync(expectedPath)).toBe(false);

    // Stub fetch to return a small PNG-looking buffer. Real Google s2 returns
    // ~1.8 KB for openai.com — we mock so the test stays offline-stable.
    const fakeLogoBytes = Buffer.alloc(800);
    fakeLogoBytes.write("\x89PNG\r\n\x1a\n", 0); // PNG magic header
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(fakeLogoBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );

    const { resolveLogo } = await import("./logo-resolver.js");
    const result = await resolveLogo("openai");

    expect(result.slug).toBe("openai");
    expect(result.path).toBe(expectedPath);
    // Real logo from web → NOT a placeholder.
    expect(result.isPlaceholder).toBe(false);
    expect(existsSync(expectedPath)).toBe(true);
    expect(statSync(expectedPath).size).toBe(fakeLogoBytes.byteLength);
  }, 30000);

  it("falls back to a generated placeholder when web fetch fails", async () => {
    // Simulate Google s2 returning a 404 or empty body.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );

    const expectedPath = join(tempHome, "reference-images", "logos", "openai.png");
    const { resolveLogo } = await import("./logo-resolver.js");
    const result = await resolveLogo("openai");

    expect(result.isPlaceholder).toBe(true);
    expect(existsSync(expectedPath)).toBe(true);
    expect(statSync(expectedPath).size).toBeGreaterThan(200);
  }, 30000);

  it("falls back to a placeholder for slugs not in the BRAND_DOMAINS map", async () => {
    // No fetch should be attempted when the brand isn't known.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const expectedPath = join(tempHome, "reference-images", "logos", "unknown-startup-xyz.png");
    const { resolveLogo } = await import("./logo-resolver.js");
    const result = await resolveLogo("unknown-startup-xyz");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.isPlaceholder).toBe(true);
    expect(existsSync(expectedPath)).toBe(true);
  }, 30000);

  it("places the resolved file where the References UI will pick it up", async () => {
    // Stub web fetch to fail so we deterministically hit the placeholder path
    // (the path-shape assertion is the same either way).
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { resolveLogo } = await import("./logo-resolver.js");
    const result = await resolveLogo("gemini");
    expect(result.path).toContain(`/reference-images/logos/gemini.png`);
  }, 30000);

  it("rejects slugs that contain path-separator characters", async () => {
    const { resolveLogo } = await import("./logo-resolver.js");
    await expect(resolveLogo("../etc/passwd")).rejects.toThrow(/Invalid logo slug/);
    await expect(resolveLogo("foo/bar")).rejects.toThrow(/Invalid logo slug/);
    await expect(resolveLogo("")).rejects.toThrow(/Invalid logo slug/);
  });

  it("does not duplicate generation when called twice for the same missing slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const { resolveLogo } = await import("./logo-resolver.js");
    const first = await resolveLogo("notion");
    const firstMtime = statSync(first.path).mtimeMs;
    // Wait long enough that mtime would differ if the file was regenerated.
    await new Promise((r) => setTimeout(r, 20));
    const second = await resolveLogo("notion");
    expect(second.isPlaceholder).toBe(false); // file now exists, treated as real
    expect(statSync(second.path).mtimeMs).toBe(firstMtime);
  }, 30000);
});
