// ─── IG Cover Generator ─────────────────────────────────────────────────────
// Branded "Style A" square cover for Instagram feed posts, generated with
// gpt-image-2's edit endpoint anchored to Markus's reference photos so his
// identity (M-cap, glasses, beard, vest) stays locked. This is the in-app,
// HTTP-callable sibling of the CLI cover generator at scripts/make-cover.sh —
// same visual DNA, re-composed for a 1:1 IG frame instead of a wide Substack
// cover.
//
// Output is saved to ~/.heyhank/media/ (same dir + filename pattern as
// google-media.ts) and served at /api/media/file/<filename>.
//
// Key + refs:
//   - OpenAI key: ~/.config/openai-image/credentials.json (field "api_key"),
//     overridable via OPENAI_API_KEY.
//   - Reference photos: /opt/agentplatform/Markus.jpeg (+ _2) — Markus's
//     identity anchors. Override via MARKUS_REF_1 / MARKUS_REF_2.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";

const REF_1 = process.env.MARKUS_REF_1 || "/opt/agentplatform/Markus.jpeg";
const REF_2 = process.env.MARKUS_REF_2 || "/opt/agentplatform/Markus_2.jpeg";

export interface IgCoverResult {
  filename: string;
  /** App-relative URL the frontend + draft mediaUrls use. */
  url: string;
  /** Absolute path on disk. */
  path: string;
  prompt: string;
  model: string;
}

/** Resolve the OpenAI API key from env or the openai-image credentials file. */
function openaiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const credPath = process.env.OPENAI_IMAGE_CREDENTIALS || "/root/.config/openai-image/credentials.json";
  try {
    const raw = JSON.parse(readFileSync(credPath, "utf-8")) as { api_key?: string };
    return raw.api_key ?? "";
  } catch {
    return "";
  }
}

export type IgCoverHero =
  | "notebook"
  | "laptop"
  | "phone"
  | "workspace"
  | string; // raw scene passthrough

function heroScene(hero: IgCoverHero): string {
  switch (hero) {
    case "notebook":
      return "seated at his warm wooden desk writing in a notebook with a fountain pen";
    case "laptop":
      return "sitting at his desk in front of a 14-inch laptop, a bookshelf with code books softly blurred behind him";
    case "phone":
      return "holding a single phone in his right hand, his left hand resting empty at his side";
    case "workspace":
      return "at his clean warm home-office desk with a single closed laptop, a small plant and a ceramic mug";
    default:
      return hero;
  }
}

/**
 * Build the square Style-A prompt. Identity-locking order follows the proven
 * recipe: subject (person) first, then composition, then text overlays, then
 * style directives (see memory feedback_gpt_image_identity).
 */
export function buildIgCoverPrompt(input: {
  headline: string;
  badge?: string;
  hero?: IgCoverHero;
}): string {
  const badge = input.badge?.trim() || "Built with AI";
  const scene = heroScene(input.hero || "notebook");
  return `Photorealistic 1:1 square Instagram post image, editorial photography quality.

SUBJECT (lower half of the square):
The man from the two reference photos, candidly ${scene}. He wears a black M-cap (capital letter M on the front), thin-rimmed glasses, a full short beard, and a dark vest over a long-sleeved shirt. Warm window light from the left, 85mm portrait-lens look, shallow depth of field, sharp focus on his face. Natural skin texture, a real working person — not a stock photo, not glamorous, not AI-sterile.

COMPOSITION (square 1:1):
Markus sits in the lower portion of the frame. The upper portion is a slightly darker warm-brown band that holds the headline so the text is always legible. Balanced, magazine-cover feel.

TEXT OVERLAYS — render EXACTLY these strings, nothing else:

1. HEADLINE — large bold serif typography (Playfair / Garamond feel), white, centered in the upper band, wrapped over up to 3 lines:
"${input.headline.trim()}"

2. BADGE — a small bright orange six-point asterisk star (Anthropic-style spark) followed by small white text: "${badge}"

STYLE DIRECTIVES:
- Photoreal, NOT illustration, NOT 3D render, NOT vector.
- Warm color grading, deep browns + amber highlights.
- Exactly ONE Markus in frame, no duplicated people or objects.
- DO NOT add any logo, watermark, or extra text beyond the headline + badge above. No random words, no URLs, no chart labels.
- The asterisk must be a sharp 6-point geometric symbol in saturated orange (#FF6719).`;
}

/** A `fetch`-compatible function; injectable so tests don't hit OpenAI. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Generate a branded square IG cover. Returns the saved-file descriptor. Throws
 * on missing key / missing refs / API error so the route can surface a clean
 * message. `deps.fetch` + `deps.now`/`deps.rand` are injectable for tests.
 */
export async function generateIgCover(
  input: { headline: string; badge?: string; hero?: IgCoverHero; quality?: "low" | "medium" | "high" },
  deps?: { fetch?: FetchLike; now?: () => number; rand?: () => string },
): Promise<IgCoverResult> {
  const key = openaiKey();
  if (!key) throw new Error("OpenAI API key not configured (set OPENAI_API_KEY or ~/.config/openai-image/credentials.json)");
  if (!existsSync(REF_1) || !existsSync(REF_2)) {
    throw new Error(`Markus reference photos not found (${REF_1}, ${REF_2})`);
  }
  if (!input.headline || !input.headline.trim()) throw new Error("headline is required");

  const prompt = buildIgCoverPrompt(input);
  const doFetch = deps?.fetch ?? (globalThis.fetch as FetchLike);

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  // "medium" keeps the synchronous request well under proxy timeouts while still
  // looking great for an IG feed image; callers can opt into "high" if needed.
  form.append("quality", input.quality || "medium");
  form.append("n", "1");
  // gpt-image-2 edit endpoint accepts multiple reference images under image[].
  form.append("image[]", new Blob([readFileSync(REF_1)], { type: "image/jpeg" }), "ref1.jpeg");
  form.append("image[]", new Blob([readFileSync(REF_2)], { type: "image/jpeg" }), "ref2.jpeg");

  const res = await doFetch(OPENAI_EDITS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
    throw new Error(`gpt-image-2 failed: ${msg}`);
  }

  const b64 =
    parsed && typeof parsed === "object" && "data" in parsed
      ? (parsed as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json
      : undefined;
  if (!b64) throw new Error("gpt-image-2 returned no image data (possible content-policy block)");

  mkdirSync(MEDIA_DIR, { recursive: true });
  const now = deps?.now ? deps.now() : Date.now();
  const rand = deps?.rand ? deps.rand() : Math.random().toString(36).slice(2, 8);
  const filename = `img_${now}_${rand}.png`;
  const filepath = join(MEDIA_DIR, filename);
  writeFileSync(filepath, Buffer.from(b64, "base64"));

  return {
    filename,
    url: `/api/media/file/${filename}`,
    path: filepath,
    prompt,
    model: "gpt-image-2",
  };
}
