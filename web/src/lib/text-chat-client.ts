// ─── Text Chat SSE Client ───────────────────────────────────────────────────
// Browser-side client for text-based Hank-UI providers via SSE.

export interface ContentPart {
  type: "text" | "image_url" | "document";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
  document?: { url: string; mimeType: string; name?: string };
}

export interface TextChatMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
}

export interface TextChatEvent {
  type: "text" | "tool_call" | "tool_result" | "memory_added" | "session_event" | "done" | "error";
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  tool_call_id?: string;
  result?: unknown;
  error?: string;
  id?: string;
  fact?: string;
  category?: string;
  // Session event fields
  sessionId?: string;
  event?: string;
  from?: string;
  to?: string;
  exitCode?: number;
}

export type TextChatEventHandler = (event: TextChatEvent) => void;

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("heyhank_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Send messages to the Hank chat endpoint and stream back events via SSE.
 * Returns an AbortController so the caller can cancel the stream.
 */
export function streamChat(
  messages: TextChatMessage[],
  provider: string,
  model: string,
  handler: TextChatEventHandler,
  options?: {
    apiKey?: string;
    baseUrl?: string;
  },
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch("/api/hank/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          messages,
          provider,
          model,
          apiKey: options?.apiKey,
          baseUrl: options?.baseUrl,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        handler({ type: "error", error: `Server error ${response.status}: ${text}` });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        handler({ type: "error", error: "No response body" });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data) as TextChatEvent;
            handler(event);
            if (event.type === "done" || event.type === "error") return;
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Stream ended without explicit done event
      handler({ type: "done" });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      handler({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return controller;
}
