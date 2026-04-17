// ─── Claude Vision for post images ───────────────────────────────────────────
// Thin wrapper around the Anthropic Messages API with an image input. Used to
// describe the visual style of reference posts so the content agent can learn
// what "high visual quality" looks like per platform.

import { getSettings } from "../settings-manager.js";

const VISION_MODEL = "claude-sonnet-4-6";
const VISION_MAX_TOKENS = 512;

/** Prompt focused on the things the content agent actually needs to reproduce. */
const DESCRIBE_PROMPT = `Describe this social media post image for a content agent that needs to learn what works visually.

Cover (in 3–5 concise bullet points, under 120 words total):
- Subject & composition (what's in frame, how it's arranged)
- Color palette & mood (warm/cool, saturated/muted, dominant colors)
- Text overlays if any (quote them verbatim)
- Style (flatlay, portrait, candid, stock-ish, UGC, studio, meme, infographic)
- Production quality signals (natural light, shallow depth of field, brand consistency)

No preamble, just the bullets.`;

function resolveAnthropicKey(): string | null {
  const s = getSettings();
  const key = (s.anthropicApiKey as string | undefined)?.trim();
  return key || null;
}

/** Describe an image at an HTTP(S) URL via Claude Vision. Returns empty string on failure. */
export async function describeImageByUrl(url: string, timeoutMs = 30_000): Promise<string> {
  const apiKey = resolveAnthropicKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("[socialview/vision] no anthropicApiKey configured — skipping vision");
    return "";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url } },
              { type: "text", text: DESCRIBE_PROMPT },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[socialview/vision] ${res.status} ${res.statusText}`);
      return "";
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    return text.trim();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[socialview/vision] error:", e instanceof Error ? e.message : e);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Describe an image from a base64 string. Useful when we download the file locally. */
export async function describeImageBase64(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif",
  timeoutMs = 30_000,
): Promise<string> {
  const apiKey = resolveAnthropicKey();
  if (!apiKey) return "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: DESCRIBE_PROMPT },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return "";
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content?.find((b) => b.type === "text")?.text ?? "").trim();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
