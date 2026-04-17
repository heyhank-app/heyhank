// ─── URL Validation ──────────────────────────────────────────────────────────
// SSRF protection: reject baseUrl values that point to internal/private networks
// unless they are known safe provider domains.

const KNOWN_PROVIDER_HOSTS = new Set([
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.anthropic.com",
  "api.together.xyz",
  "api.groq.com",
  "api.mistral.ai",
  "api.deepseek.com",
  "api.fireworks.ai",
  "api.perplexity.ai",
  "api.cohere.com",
]);

/**
 * Check if a base URL is safe to make requests to.
 * Rejects URLs pointing to internal/private IP ranges unless the host
 * is a known LLM provider domain or localhost (for Ollama).
 */
export function isAllowedBaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow known provider domains
  if (KNOWN_PROVIDER_HOSTS.has(hostname)) return true;

  // Allow localhost / 127.0.0.1 (for Ollama and local services)
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;

  // Allow Tailscale domains (.ts.net)
  if (hostname.endsWith(".ts.net")) return true;

  // Block internal/private IP ranges
  if (isPrivateHostname(hostname)) return false;

  // Allow all other public hostnames
  return true;
}

function isPrivateHostname(hostname: string): boolean {
  // IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") return true;

  // Check if it looks like an IP address
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    // 127.x.x.x (loopback — already allowed above for localhost, but block raw IPs other than 127.0.0.1)
    if (a === 127) return true;
    // 10.x.x.x (private)
    if (a === 10) return true;
    // 172.16.0.0 - 172.31.255.255 (private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x (private)
    if (a === 192 && b === 168) return true;
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0
    if (a === 0) return true;
  }

  // IPv6 private ranges (simplified check for common patterns)
  if (hostname.startsWith("[")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (inner.startsWith("fc") || inner.startsWith("fd")) return true; // ULA
    if (inner.startsWith("fe80")) return true; // link-local
    if (inner === "::1") return true;
    if (inner === "::") return true;
  }

  return false;
}
