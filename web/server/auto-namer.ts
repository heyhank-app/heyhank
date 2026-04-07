import { callInternalAI } from "./internal-ai.js";

function sanitizeTitle(raw: string): string | null {
  const title = raw.replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
  if (!title || title.length >= 100) return null;
  return title;
}

/**
 * Generates a short session title using the configured internal AI provider.
 * Returns null if no provider is configured or if generation fails.
 */
export async function generateSessionTitle(
  firstUserMessage: string,
  _model: string,
  options?: {
    timeoutMs?: number;
  },
): Promise<string | null> {
  const truncated = firstUserMessage.slice(0, 500);
  const userPrompt = `Generate a concise 3-5 word session title for this user request. Output only the title.\n\nRequest: ${truncated}`;

  const result = await callInternalAI({
    userPrompt,
    maxTokens: 256,
    temperature: 0.2,
    timeoutMs: options?.timeoutMs || 15_000,
  });

  if (!result.ok) {
    console.warn(`[auto-namer] Failed to generate title: ${result.error}`);
    return null;
  }

  return sanitizeTitle(result.text);
}
