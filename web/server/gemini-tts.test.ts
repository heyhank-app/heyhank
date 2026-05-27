import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// generateTts() needs HEYHANK_HOME at import-time via paths.ts. Set it before
// importing the module fresh in each test (vi.resetModules).
let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-tts-test-"));
  process.env.HEYHANK_HOME = tempHome;
  mkdirSync(join(tempHome, "media"), { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// A 1024-byte PCM "audio" payload — enough to exercise base64 + ffmpeg path
// without making the test fake-data look like garbage to the codec.
function fakePcmBase64(): string {
  const buf = Buffer.alloc(2048);
  for (let i = 0; i < buf.length; i += 2) {
    // Tiny sine wave so libmp3lame doesn't choke on dead silence.
    buf.writeInt16LE(Math.floor(Math.sin(i / 4) * 1000), i);
  }
  return buf.toString("base64");
}

describe("generateTts()", () => {
  it("rejects empty text", async () => {
    const { generateTts } = await import("./gemini-tts.js");
    await expect(generateTts({ text: "" })).rejects.toThrow(/text is required/);
    await expect(generateTts({ text: "   " })).rejects.toThrow(/text is required/);
  });

  it("calls Gemini API + writes mp3 to media dir + reports cached=false on first call", async () => {
    // Inject a settings file with a fake key. settings-manager looks for
    // HEYHANK_HOME/settings.json — we placed HEYHANK_HOME in tempHome.
    writeFileSync(join(tempHome, "settings.json"), JSON.stringify({ geminiApiKey: "test-key-123" }));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: fakePcmBase64() },
              }],
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { generateTts } = await import("./gemini-tts.js");
    const result = await generateTts({ text: "Hello world." });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("gemini-2.5-flash-preview-tts:generateContent");
    expect(url).toContain("key=test-key-123");

    expect(result.cached).toBe(false);
    expect(result.audioPath).toMatch(/tts_[a-f0-9]{16}\.mp3$/);
    expect(existsSync(result.audioPath)).toBe(true);
    expect(result.size).toBeGreaterThan(100);
  }, 30000);

  it("reuses the on-disk file on a second identical request (cached=true)", async () => {
    writeFileSync(join(tempHome, "settings.json"), JSON.stringify({ geminiApiKey: "test-key-cache" }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: fakePcmBase64() } }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { generateTts } = await import("./gemini-tts.js");
    const first = await generateTts({ text: "Same text" });
    const second = await generateTts({ text: "Same text" });

    expect(fetchSpy).toHaveBeenCalledOnce(); // second call hits cache
    expect(second.cached).toBe(true);
    expect(second.audioPath).toBe(first.audioPath);
  }, 30000);

  it("produces a different cache key for a different voice", async () => {
    writeFileSync(join(tempHome, "settings.json"), JSON.stringify({ geminiApiKey: "test-key-voices" }));
    // A Response body can only be consumed once, so use mockImplementation to
    // return a fresh Response per call instead of mockResolvedValue.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: fakePcmBase64() } }] } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );

    const { generateTts } = await import("./gemini-tts.js");
    const charon = await generateTts({ text: "Hi", voice: "Charon" });
    const puck = await generateTts({ text: "Hi", voice: "Puck" });

    expect(charon.audioPath).not.toBe(puck.audioPath);
    expect(charon.cached).toBe(false);
    expect(puck.cached).toBe(false);
  }, 30000);

  it("surfaces Gemini API errors verbatim instead of silently returning empty audio", async () => {
    writeFileSync(join(tempHome, "settings.json"), JSON.stringify({ geminiApiKey: "test-key-err" }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 200 }),
    );
    const { generateTts } = await import("./gemini-tts.js");
    await expect(generateTts({ text: "Hi" })).rejects.toThrow(/quota exceeded/);
  });

  it("throws when no API key is configured", async () => {
    // Leave HEYHANK_HOME/settings.json absent → settings-manager defaults to empty key.
    delete process.env.GEMINI_API_KEY;
    const { generateTts } = await import("./gemini-tts.js");
    await expect(generateTts({ text: "Hi" })).rejects.toThrow(/Gemini API key is not configured/);
  });

  it("rejects unexpected audio mime types instead of writing garbage to disk", async () => {
    writeFileSync(join(tempHome, "settings.json"), JSON.stringify({ geminiApiKey: "test-key-mime" }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mp3", data: fakePcmBase64() } }] } }],
      }), { status: 200 }),
    );
    const { generateTts } = await import("./gemini-tts.js");
    await expect(generateTts({ text: "Hi" })).rejects.toThrow(/Unexpected TTS audio mime/);
  });
});
