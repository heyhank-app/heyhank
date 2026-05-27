// Gemini Text-to-Speech wrapper.
//
// Talks to the Gemini generative-language API's TTS-capable models
// (`gemini-2.5-flash-preview-tts` by default). The API returns base64-encoded
// linear-PCM audio (24 kHz, 16-bit, mono); we re-encode to MP3 via ffmpeg so
// the slideshow compositor (video-compose.ts) can consume it directly.
//
// Files are written to `~/.heyhank/media/tts_<sha8>.mp3`. The hash is built
// from text + voice + model so two identical requests reuse the same file
// without re-hitting the API — a single TTS call costs cents but matters when
// the Reel pipeline regenerates dozens of clips during iteration.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HEYHANK_HOME } from "./paths.js";
import { getSettings } from "./settings-manager.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** TTS model. Default `gemini-2.5-flash-preview-tts` (fast + cheap + stable). */
export type GeminiTtsModel =
  | "gemini-2.5-flash-preview-tts"
  | "gemini-2.5-pro-preview-tts"
  | "gemini-3.1-flash-tts-preview";

/**
 * Gemini prebuilt voice names. Subset of the documented catalog — these are
 * the voices that fit Markus' tone (mostly informative / confident / male,
 * plus a couple of female options for B-roll or contrast use-cases).
 *
 * Full list at: https://ai.google.dev/gemini-api/docs/speech-generation
 */
export type GeminiVoice =
  | "Charon"    // informative, male — good for tutorials, DEFAULT
  | "Orus"      // firm, male
  | "Puck"      // upbeat, male — energetic hooks
  | "Fenrir"    // excitable, male
  | "Kore"      // firm, female
  | "Aoede"     // breezy, female
  | "Zephyr"    // bright, female
  | "Leda";     // youthful, female

export interface GenerateTtsParams {
  text: string;
  /** Voice name. Default "Charon". */
  voice?: GeminiVoice;
  /** TTS model. Default "gemini-2.5-flash-preview-tts". */
  model?: GeminiTtsModel;
  /**
   * Style hint inserted before the text as Gemini's recommended prompt
   * pattern — e.g. "Say cheerfully:" or "Read in a calm, authoritative voice:".
   * If omitted, the text is sent as-is.
   */
  style?: string;
  /**
   * Bypass the on-disk cache. Forces re-generation even when an identical
   * (text + voice + model + style) request was processed earlier.
   */
  noCache?: boolean;
}

export interface GenerateTtsResult {
  /** Absolute mp3 path inside ~/.heyhank/media/. */
  audioPath: string;
  /** Whether the file came from the disk cache (true) or was just generated. */
  cached: boolean;
  /** Bytes on disk for the mp3 — useful for sanity checks in tests. */
  size: number;
}

function cacheKey(p: Required<Pick<GenerateTtsParams, "text" | "voice" | "model">> & { style: string }): string {
  const h = createHash("sha256");
  h.update(p.model);
  h.update("\0");
  h.update(p.voice);
  h.update("\0");
  h.update(p.style);
  h.update("\0");
  h.update(p.text);
  return h.digest("hex").slice(0, 16);
}

/**
 * Convert raw PCM (s16le, 24kHz mono — what Gemini TTS emits) into an mp3.
 *
 * ffmpeg input flags carry the format metadata that PCM doesn't self-describe;
 * skipping any of them produces garbled output. The libmp3lame codec ships
 * with the standard Ubuntu ffmpeg build.
 */
function pcmToMp3(pcmPath: string, mp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      [
        "-y",
        "-f", "s16le",
        "-ar", "24000",
        "-ac", "1",
        "-i", pcmPath,
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        mp3Path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stderr: string[] = [];
    p.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.join("").split("\n").slice(-10).join("\n");
        reject(new Error(`ffmpeg PCM→MP3 failed (${code}):\n${tail}`));
      }
    });
  });
}

function apiKey(): string {
  const key = getSettings().geminiApiKey || process.env.GEMINI_API_KEY || "";
  if (!key) {
    throw new Error("Gemini API key is not configured. Set it in Settings or GEMINI_API_KEY.");
  }
  return key;
}

/**
 * Generate speech audio for the given text via Gemini TTS.
 *
 * Returns a cached file when one already exists for the exact same input —
 * the `cached` flag in the result reports which path was taken so callers
 * (tests, telemetry) can distinguish a fresh API call from a cache hit.
 */
export async function generateTts(params: GenerateTtsParams): Promise<GenerateTtsResult> {
  if (!params.text || !params.text.trim()) {
    throw new Error("generateTts: text is required and must be non-empty");
  }
  const voice = params.voice ?? "Charon";
  const model = params.model ?? "gemini-2.5-flash-preview-tts";
  const style = params.style ?? "";

  mkdirSync(MEDIA_DIR, { recursive: true });
  const key = cacheKey({ text: params.text, voice, model, style });
  const mp3Path = join(MEDIA_DIR, `tts_${key}.mp3`);
  if (!params.noCache && existsSync(mp3Path)) {
    const { statSync } = await import("node:fs");
    return { audioPath: mp3Path, cached: true, size: statSync(mp3Path).size };
  }

  const prompt = style ? `${style.trim()}: ${params.text.trim()}` : params.text.trim();
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey()}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    error?: { message?: string };
  };
  if (data.error) {
    throw new Error(`Gemini TTS API error: ${data.error.message ?? JSON.stringify(data.error)}`);
  }
  const inlineData = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inlineData?.data) {
    throw new Error(`Gemini TTS returned no audio data: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (!inlineData.mimeType?.startsWith("audio/L16")) {
    throw new Error(`Unexpected TTS audio mime: ${inlineData.mimeType}`);
  }

  const pcmBuffer = Buffer.from(inlineData.data, "base64");
  const pcmPath = join(tmpdir(), `tts_${key}_${Date.now()}.pcm`);
  writeFileSync(pcmPath, pcmBuffer);
  try {
    await pcmToMp3(pcmPath, mp3Path);
  } finally {
    try { unlinkSync(pcmPath); } catch { /* ok */ }
  }

  const { statSync } = await import("node:fs");
  return { audioPath: mp3Path, cached: false, size: statSync(mp3Path).size };
}
