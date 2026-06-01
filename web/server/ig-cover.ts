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

// Capped identity refs (M-cap, the original builder look).
const REF_1 = process.env.MARKUS_REF_1 || "/opt/agentplatform/Markus.jpeg";
const REF_2 = process.env.MARKUS_REF_2 || "/opt/agentplatform/Markus_2.jpeg";
// No-cap identity refs (bald head + beard, from the reference-images/person set).
const PERSON_DIR = join(HEYHANK_HOME, "reference-images", "person");
const NOCAP_REF_1 = process.env.MARKUS_NOCAP_REF_1 || join(PERSON_DIR, "markus-identity-360-nocap.png");
const NOCAP_REF_2 = process.env.MARKUS_NOCAP_REF_2 || join(PERSON_DIR, "markus-fullbody-denim-nocap.png");

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

// ─── Style library ───────────────────────────────────────────────────────────
// Each style is the same locked brand identity (M-cap, glasses, beard) +
// shared text-overlay + base directives, but a different SUBJECT pose/attire +
// COMPOSITION + mood. Pick the one that fits the post type.

export type IgStyle = "cozy" | "business" | "pointing" | "bold" | "screen";

export const IG_STYLES: { id: IgStyle; label: string; note: string }[] = [
  { id: "cozy", label: "Cozy Builder", note: "warm home office — builds + stories (default)" },
  { id: "business", label: "Authority", note: "clean studio, smart-casual — news + opinions" },
  { id: "pointing", label: "Pointing", note: "gestures at the headline — hooks + reveals" },
  { id: "bold", label: "Bold Text", note: "huge typography — hot takes + quotes" },
  { id: "screen", label: "Screen / Demo", note: "beside a UI screen — tool reviews" },
];

export function normalizeStyle(raw: unknown): IgStyle {
  return raw === "business" || raw === "pointing" || raw === "bold" || raw === "screen" ? raw : "cozy";
}

/** The locked identity clause. Capped (M-cap + glasses) or bare-headed. */
const IDENTITY_CAP = "the man from the reference photos — a black M-cap with a capital letter M on the front, thin-rimmed glasses, a full short beard. Natural skin texture, a real person, not a stock photo, not glamorous, not AI-sterile";
const IDENTITY_NOCAP = "the man from the reference photos — NO hat (bare head, cleanly shaved / bald on top), a full short beard, no glasses. Natural skin texture, a real person, not a stock photo, not glamorous, not AI-sterile";

function styleBlocks(style: IgStyle, scene: string, IDENTITY: string): { subject: string; composition: string } {
  switch (style) {
    case "business":
      return {
        subject: `SUBJECT:\n${IDENTITY}. Smart-casual professional — a crisp collared shirt or a clean smart knit (no suit jacket needed), confident, looking toward the camera. Clean modern studio / office setting, softly out of focus. Crisp soft key light, premium and credible.`,
        composition: `COMPOSITION (square 1:1):\nMarkus on the right third. The left two-thirds is a clean, slightly desaturated warm-neutral panel that holds the headline. Authoritative, magazine-editorial feel.`,
      };
    case "pointing":
      return {
        subject: `SUBJECT:\n${IDENTITY}, wearing a dark vest over a long-sleeved shirt. Expressive and animated: one hand raised, pointing/gesturing toward the headline, eyebrows up, a curious-excited "you have to see this" look. Warm light, candid energy.`,
        composition: `COMPOSITION (square 1:1):\nMarkus on one side gesturing across the frame toward the headline text on the other side. High energy, strong eye-line leading to the words.`,
      };
    case "bold":
      return {
        subject: `SUBJECT:\nA small portrait of ${IDENTITY}, occupying only the lower-right corner (roughly a quarter of the height).`,
        composition: `COMPOSITION (square 1:1):\nThe HEADLINE DOMINATES the frame — huge bold typography on a clean, flat, warm color-blocked background (deep brown / amber brand tones). Minimal, punchy, poster-like. Lots of negative space around the text.`,
      };
    case "screen":
      return {
        subject: `SUBJECT:\n${IDENTITY}, smart-casual, standing beside a large glowing monitor/screen that shows an abstract modern app dashboard — soft glowing UI panels, charts and cards with NO readable text on the screen. He gestures toward the screen, presenting it.`,
        composition: `COMPOSITION (square 1:1):\nMarkus on one side, the glowing screen on the other, the headline overlaid across the top. Modern, techy, product-demo mood.`,
      };
    case "cozy":
    default:
      return {
        subject: `SUBJECT (lower half of the square):\n${IDENTITY}, wearing a dark vest over a long-sleeved shirt, candidly ${scene}. Warm window light from the left, 85mm portrait-lens look, shallow depth of field, sharp focus on his face.`,
        composition: `COMPOSITION (square 1:1):\nMarkus sits in the lower portion of the frame. The upper portion is a slightly darker warm-brown band that holds the headline so the text is always legible. Balanced, magazine-cover feel.`,
      };
  }
}

/**
 * Build the square prompt for the chosen style. Identity-locking order follows
 * the proven recipe: subject (person) first, then composition, then text
 * overlays, then style directives (see memory feedback_gpt_image_identity).
 */
export function buildIgCoverPrompt(input: {
  headline: string;
  badge?: string;
  hero?: IgCoverHero;
  style?: IgStyle;
  /** Wear the M-cap (default true) or generate bare-headed. */
  cap?: boolean;
}): string {
  const badge = input.badge?.trim() || "Built with AI";
  const scene = heroScene(input.hero || "notebook");
  const identity = input.cap === false ? IDENTITY_NOCAP : IDENTITY_CAP;
  const { subject, composition } = styleBlocks(normalizeStyle(input.style), scene, identity);
  return `Photorealistic 1:1 square Instagram post image, editorial photography quality.

${subject}

${composition}

TEXT OVERLAYS — render EXACTLY these strings, nothing else:

1. HEADLINE — large bold serif typography (Playfair / Garamond feel), wrapped over up to 3 lines, placed for legibility per the composition above:
"${input.headline.trim()}"

2. BADGE — a small bright orange six-point asterisk star (Anthropic-style spark) followed by small text: "${badge}"

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
  input: { headline: string; badge?: string; hero?: IgCoverHero; style?: IgStyle; cap?: boolean; quality?: "low" | "medium" | "high" },
  deps?: { fetch?: FetchLike; now?: () => number; rand?: () => string },
): Promise<IgCoverResult> {
  const key = openaiKey();
  if (!key) throw new Error("OpenAI API key not configured (set OPENAI_API_KEY or ~/.config/openai-image/credentials.json)");
  // Pick the reference set that matches the requested headwear so identity
  // locks correctly (capped refs vs the bare-headed person set).
  const [ref1, ref2] = input.cap === false ? [NOCAP_REF_1, NOCAP_REF_2] : [REF_1, REF_2];
  if (!existsSync(ref1) || !existsSync(ref2)) {
    throw new Error(`Markus reference photos not found (${ref1}, ${ref2})`);
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
  form.append("image[]", new Blob([readFileSync(ref1)], { type: "image/jpeg" }), "ref1.jpeg");
  form.append("image[]", new Blob([readFileSync(ref2)], { type: "image/jpeg" }), "ref2.jpeg");

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
