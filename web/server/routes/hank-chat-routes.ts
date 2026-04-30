// ─── Hank Chat Routes ───────────────────────────────────────────────────────
// POST /api/hank/chat — SSE streaming chat with server-side tool loop
// GET /api/hank/chat/config — Returns available providers + tool declarations

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSettings } from "../settings-manager.js";
import { buildSystemPrompt, getToolDeclarationsOpenAI, getToolDeclarationsGemini } from "../hank-tools.js";
import type { AgentInfo } from "../hank-tools.js";
import { executeHankTool } from "../hank-tool-executor.js";
import { streamClaude, streamOpenAI, streamGeminiText } from "../llm-providers-streaming.js";
import type { ChatMessage, ContentPart, StreamEvent, StreamProviderConfig } from "../llm-providers-streaming.js";
import { listAgents } from "../agent-store.js";
import * as assistantStore from "../assistant-store.js";
import { nodeManager } from "../federation/node-manager.js";
import { getContextForMessage, detectMemorableFacts, addMemory } from "../memory-service.js";
import { callLLM } from "../llm-providers.js";
import { heyHankBus } from "../event-bus.js";
import { listPending, markConsumed, getById } from "../hank-notifications-store.js";
import { randomUUID } from "node:crypto";
import { isAllowedBaseUrl } from "../url-validator.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const MAX_TOOL_ROUNDS = 10;

export function registerHankChatRoutes(api: Hono): void {

  // GET /hank/chat/config — Provider list + current settings
  api.get("/hank/chat/config", async (c) => {
    const settings = getSettings();
    return c.json({
      currentProvider: settings.hankChatProvider || "gemini-live",
      currentModel: settings.hankChatModel || "",
      providers: [
        { id: "gemini-live", name: "Gemini Live", type: "voice", requiresKey: "geminiApiKey" },
        { id: "claude", name: "Claude", type: "text", requiresKey: "anthropicApiKey" },
        { id: "openai", name: "OpenAI", type: "text", requiresKey: "openaiApiKey" },
        { id: "ollama", name: "Ollama", type: "text", requiresKey: null },
        { id: "openrouter", name: "OpenRouter", type: "text", requiresKey: null },
        { id: "gemini-text", name: "Gemini", type: "text", requiresKey: "geminiApiKey" },
      ],
      toolDeclarationsGemini: getToolDeclarationsGemini(),
      toolDeclarationsOpenAI: getToolDeclarationsOpenAI(),
    });
  });

  // ─── File Upload for HankChat ─────────────────────────────────────────────

  const UPLOADS_DIR = join(homedir(), ".heyhank", "uploads");

  // POST /hank/chat/upload — Accept file upload, return URL + metadata
  api.post("/hank/chat/upload", async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || typeof file === "string") {
        return c.json({ error: "file field required" }, 400);
      }
      mkdirSync(UPLOADS_DIR, { recursive: true });
      const ext = (file.name || "file").split(".").pop() || "bin";
      const id = randomUUID();
      const filename = `${id}.${ext}`;
      const filepath = join(UPLOADS_DIR, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(filepath, buffer);
      return c.json({
        url: `/api/hank/chat/media/${id}.${ext}`,
        absolutePath: filepath,
        mimeType: file.type || "application/octet-stream",
        name: file.name || filename,
        size: buffer.byteLength,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Upload failed" }, 500);
    }
  });

  // GET /hank/chat/media/:filename — Serve uploaded files
  api.get("/hank/chat/media/:filename", (c) => {
    const filename = basename(c.req.param("filename"));
    const filepath = join(UPLOADS_DIR, filename);
    if (!existsSync(filepath)) {
      return c.json({ error: "File not found" }, 404);
    }
    const data = readFileSync(filepath);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
      mp4: "video/mp4", webm: "video/webm", txt: "text/plain",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";
    return new Response(data, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" } });
  });

  // ─── Notifications (async events for HankChat, e.g. call-ended) ──────────

  // GET /hank/notifications/pending — returns unconsumed notifications
  api.get("/hank/notifications/pending", (c) => {
    return c.json({ notifications: listPending() });
  });

  // GET /hank/notifications/:id — full notification incl. transcript
  api.get("/hank/notifications/:id", (c) => {
    const id = c.req.param("id");
    const n = getById(id);
    if (!n) return c.json({ error: "Notification not found" }, 404);
    return c.json(n);
  });

  // POST /hank/notifications/:id/consume — mark as consumed
  api.post("/hank/notifications/:id/consume", (c) => {
    const id = c.req.param("id");
    const ok = markConsumed(id);
    if (!ok) return c.json({ error: "Notification not found" }, 404);
    return c.json({ success: true });
  });

  // GET /hank/notifications/stream — SSE push channel for live notifications
  api.get("/hank/notifications/stream", (c) => {
    return streamSSE(c, async (stream) => {
      // Send any currently pending notifications immediately on connect
      for (const n of listPending()) {
        await stream.writeSSE({ event: "pending", data: JSON.stringify(n) });
      }

      // Subscribe to future events
      const queue: unknown[] = [];
      let resolveNext: (() => void) | null = null;
      const unsubscribe = heyHankBus.on("telephony:call-ended", (payload) => {
        queue.push({ type: "call-ended", ...payload });
        if (resolveNext) { resolveNext(); resolveNext = null; }
      });

      const abort = c.req.raw.signal;
      const onAbort = () => {
        if (resolveNext) { resolveNext(); resolveNext = null; }
      };
      abort.addEventListener("abort", onAbort);

      try {
        while (!abort.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => { resolveNext = resolve; });
            continue;
          }
          const ev = queue.shift();
          await stream.writeSSE({ event: "call-ended", data: JSON.stringify(ev) });
        }
      } finally {
        unsubscribe();
        abort.removeEventListener("abort", onAbort);
      }
    });
  });

  // POST /hank/chat — SSE streaming with server-side tool loop
  api.post("/hank/chat", async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    const {
      messages: clientMessages,
      provider: providerName,
      model: requestedModel,
      apiKey: requestedApiKey,
      baseUrl: requestedBaseUrl,
    } = body as {
      messages: Array<{ role: string; content: string | ContentPart[] }>;
      provider: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    if (!clientMessages || !Array.isArray(clientMessages)) {
      return c.json({ error: "messages array required" }, 400);
    }

    if (requestedBaseUrl && !isAllowedBaseUrl(requestedBaseUrl)) {
      return c.json({ error: "baseUrl points to a disallowed internal address" }, 400);
    }

    const settings = getSettings();
    const authHeader = c.req.header("Authorization") || "";

    // Build system prompt with current context
    const agents: AgentInfo[] = listAgents().map(a => ({
      id: a.id, name: a.name, description: a.description, backend: a.backendType,
    }));
    const remoteAgents = nodeManager.getRemoteAgents().map(ra => ({
      id: ra.id, name: ra.name, description: ra.description || "", backend: ra.backendType || "claude",
    }));
    const recentNotes = assistantStore.listNotes("gemini-live").slice(-3);

    let activeSessions: Array<{ sessionId: string; state: string; model?: string; agentName?: string; cwd?: string }> = [];
    try {
      const port = process.env.PORT || 3100;
      const sessResp = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (sessResp.ok) {
        const all = await sessResp.json() as any[];
        activeSessions = all.filter(s => s.state !== "exited").map(s => ({
          sessionId: s.sessionId, state: s.state, model: s.model, agentName: s.agentName, cwd: s.cwd,
        }));
      }
    } catch { /* ignore */ }

    let contacts: Array<{ name: string; phone: string; notes?: string }> = [];
    try {
      const telStore = await import("../telephony/telephony-store.js");
      contacts = telStore.getContacts().map(c => ({ name: c.name, phone: c.phone, notes: c.notes }));
    } catch { /* ignore */ }

    // Inject memory context from Mem0 or local fallback
    let memoryContext = "";
    try {
      const lastUserMsg = clientMessages.filter(m => m.role === "user").pop();
      const lastUserText = typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : lastUserMsg?.content?.filter(p => p.type === "text").map(p => p.text || "").join("") || "";
      if (lastUserText) {
        memoryContext = await getContextForMessage(lastUserText);
      }
    } catch { /* ignore memory errors */ }

    let systemPrompt = buildSystemPrompt(
      settings.assistantName || "",
      [...agents, ...remoteAgents],
      recentNotes.map(n => ({ title: n.title, content: n.content })),
      activeSessions,
      settings.userName || "",
      contacts,
      settings.obsidianVaultPath || undefined,
    );

    if (memoryContext) {
      systemPrompt += `\n\nUSER MEMORY CONTEXT:\n${memoryContext}`;
    }

    // Track uploaded files from conversation for agent sessions
    const uploadedFiles: Array<{ name: string; path: string }> = [];
    for (const msg of clientMessages) {
      if (typeof msg.content !== "string" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "image_url" && part.image_url?.url?.startsWith("/api/hank/chat/media/")) {
            const filename = part.image_url.url.split("/").pop() || "";
            const absPath = join(UPLOADS_DIR, filename);
            if (existsSync(absPath)) {
              uploadedFiles.push({ name: filename, path: absPath });
            }
          }
        }
      }
    }
    if (uploadedFiles.length > 0) {
      systemPrompt += `\n\nUPLOADED FILES:\nThe user has uploaded the following files: ${uploadedFiles.map(f => `${f.name} (accessible at ${f.path})`).join(", ")}. Reference these when relevant.`;
    }

    // Resolve provider config
    const providerConfig: StreamProviderConfig = {
      provider: providerName as any,
      model: requestedModel || settings.hankChatModel || getDefaultModel(providerName),
      apiKey: requestedApiKey || getApiKey(providerName, settings),
      baseUrl: requestedBaseUrl,
      temperature: 0.7,
      maxTokens: 4096,
    };

    const tools = getToolDeclarationsOpenAI();

    // Build initial messages with system prompt
    const chatMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...clientMessages.map(m => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
      })),
    ];

    // SSE streaming response with tool loop
    return streamSSE(c, async (stream) => {
      // Subscribe to session lifecycle events and forward them to the SSE stream
      const unsubPhase = heyHankBus.on("session:phase-changed", async (payload) => {
        try {
          await stream.writeSSE({ data: JSON.stringify({
            type: "session_event",
            sessionId: payload.sessionId,
            event: "phase_changed",
            from: payload.from,
            to: payload.to,
          }) });
        } catch { /* stream may be closed */ }
      });
      const unsubExited = heyHankBus.on("session:exited", async (payload) => {
        try {
          await stream.writeSSE({ data: JSON.stringify({
            type: "session_event",
            sessionId: payload.sessionId,
            event: "exited",
            exitCode: payload.exitCode,
          }) });
        } catch { /* stream may be closed */ }
      });

      // Ensure cleanup when stream closes
      stream.onAbort(() => { unsubPhase(); unsubExited(); });

      let messages = [...chatMessages];
      let toolRound = 0;

      while (toolRound < MAX_TOOL_ROUNDS) {
        const streamFn = getStreamFunction(providerName);
        const events: StreamEvent[] = [];
        let hasToolCalls = false;

        try {
          for await (const event of streamFn(messages, tools, providerConfig)) {
            events.push(event);

            if (event.type === "text") {
              await stream.writeSSE({ data: JSON.stringify(event) });
            } else if (event.type === "tool_call") {
              hasToolCalls = true;
              await stream.writeSSE({ data: JSON.stringify(event) });
            } else if (event.type === "error") {
              await stream.writeSSE({ data: JSON.stringify(event) });
              return;
            }
          }
        } catch (err) {
          await stream.writeSSE({ data: JSON.stringify({
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          }) });
          return;
        }

        if (!hasToolCalls) {
          console.log(`[hank-chat] Round ${toolRound}: No tool calls — LLM responded with text only`);

          // Fallback: detect if user wanted agent delegation but LLM didn't call the tool
          if (toolRound === 0) {
            const lastUserMsg = clientMessages.filter(m => m.role === "user").pop();
            const lastUserText = typeof lastUserMsg?.content === "string"
              ? lastUserMsg.content.toLowerCase()
              : (lastUserMsg?.content?.filter(p => p.type === "text").map(p => (p.text || "").toLowerCase()).join(" ") || "");

            // Check if the conversation context implies agent delegation
            const prevAssistantMsgs = clientMessages.filter(m => m.role === "assistant");
            const prevAssistantText = prevAssistantMsgs.length > 0
              ? (typeof prevAssistantMsgs[prevAssistantMsgs.length - 1].content === "string"
                ? (prevAssistantMsgs[prevAssistantMsgs.length - 1].content as string).toLowerCase()
                : "")
              : "";

            const userWantsAgent = /\bagent\b|\bbeauftrag/.test(lastUserText);
            const contextSuggestsPost = /\bpost\b|\bdraft\b|\bcontent\b|\bsocial\b|\bentwu?r?f/.test(lastUserText) ||
              /\bagent.*beauftrag|\bbeauftrag.*agent|\bselbst.*erstellen.*agent/.test(prevAssistantText);

            if (userWantsAgent && (contextSuggestsPost || prevAssistantText.includes("agent"))) {
              console.log(`[hank-chat] Fallback: User wants agent delegation but LLM didn't call run_agent — triggering manually`);

              // Gather conversation context for the agent task
              const allUserTexts = clientMessages
                .filter(m => m.role === "user")
                .map(m => typeof m.content === "string" ? m.content : m.content?.filter(p => p.type === "text").map(p => p.text || "").join(" ") || "")
                .join("\n\n");

              const taskDescription = `Erstelle Social Media Posts basierend auf folgendem Kontext:\n\n${allUserTexts}\n\nErstelle plattform-optimierte Drafts (Facebook, Instagram). Generiere passende Bilder mit imagen. Speichere alles als Drafts.`;

              try {
                // Keep-alive during long-running agent execution
                const fallbackKeepAlive = setInterval(async () => {
                  try { await stream.writeSSE({ data: JSON.stringify({ type: "keep_alive" }) }); } catch {}
                }, 15_000);
                let result: unknown;
                try {
                  result = await executeHankTool("run_agent", { agent: "Content Agent", task: taskDescription }, authHeader);
                } finally {
                  clearInterval(fallbackKeepAlive);
                }
                await stream.writeSSE({ data: JSON.stringify({
                  type: "tool_call",
                  name: "run_agent",
                  args: { agent: "Content Agent", task: taskDescription },
                  tool_call_id: "fallback_agent_0",
                }) });
                await stream.writeSSE({ data: JSON.stringify({
                  type: "tool_result",
                  name: "run_agent",
                  tool_call_id: "fallback_agent_0",
                  result,
                }) });

                // Send a follow-up text message
                await stream.writeSSE({ data: JSON.stringify({
                  type: "text",
                  content: "\n\nIch habe den Content Agent gestartet. Er erstellt jetzt die Posts und generiert Bilder. Du kannst den Fortschritt auf der Agents-Seite verfolgen.",
                }) });
              } catch (err) {
                console.error(`[hank-chat] Fallback agent call failed:`, err);
                await stream.writeSSE({ data: JSON.stringify({
                  type: "text",
                  content: "\n\nIch konnte den Agent leider nicht starten. Soll ich die Posts stattdessen selbst als Drafts erstellen?",
                }) });
              }
            }
          }

          // Auto-detect memorable facts
          try {
            const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
            if (geminiKey) {
              const llmCallFn = async (sys: string, usr: string) => {
                const r = await callLLM(
                  [{ role: "system", content: sys }, { role: "user", content: usr }],
                  { provider: "gemini", model: "gemini-2.5-flash", apiKey: geminiKey, temperature: 0.3, maxTokens: 1024 },
                );
                return r.content;
              };
              const textOnlyMessages = clientMessages.map(m => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : m.content.filter(p => p.type === "text").map(p => p.text || "").join(""),
              }));
              const facts = await detectMemorableFacts(textOnlyMessages, llmCallFn);
              for (const fact of facts) {
                const memory = await addMemory(fact.fact, { category: fact.category, source: "auto-detect" });
                await stream.writeSSE({ data: JSON.stringify({ type: "memory_added", id: memory.id, fact: fact.fact, category: fact.category }) });
              }
            }
          } catch (err) {
            console.log(`[hank-chat] Memory detection failed: ${err}`);
          }
          await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
          return;
        }

        // Execute tool calls and feed results back
        const toolCallEvents = events.filter(e => e.type === "tool_call");
        console.log(`[hank-chat] Round ${toolRound}: ${toolCallEvents.length} tool call(s): ${toolCallEvents.map(t => t.name).join(", ")}`);
        const textEvents = events.filter(e => e.type === "text");
        const assistantText = textEvents.map(e => e.content || "").join("");

        // Add assistant message with tool calls
        const assistantToolCalls = toolCallEvents.map((tc, i) => ({
          id: tc.tool_call_id || `call_${toolRound}_${i}`,
          type: "function" as const,
          function: {
            name: tc.name || "",
            arguments: JSON.stringify(tc.args || {}),
          },
        }));

        messages.push({
          role: "assistant",
          content: assistantText,
          tool_calls: assistantToolCalls,
        });

        // Execute each tool call
        for (const tc of toolCallEvents) {
          const toolName = tc.name || "";
          const toolArgs = tc.args || {};
          const toolId = tc.tool_call_id || `call_${toolRound}`;

          // For long-running tools (run_agent), send SSE keep-alives to prevent browser timeout
          let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
          if (toolName === "run_agent") {
            keepAliveInterval = setInterval(async () => {
              try {
                await stream.writeSSE({ data: JSON.stringify({ type: "keep_alive" }) });
              } catch { /* stream closed */ }
            }, 15_000); // every 15s
          }

          let result: unknown;
          try {
            result = await executeHankTool(toolName, toolArgs, authHeader);
          } finally {
            if (keepAliveInterval) clearInterval(keepAliveInterval);
          }

          await stream.writeSSE({ data: JSON.stringify({
            type: "tool_result",
            name: toolName,
            tool_call_id: toolId,
            result,
          }) });

          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_call_id: toolId,
            name: toolName,
          });
        }

        toolRound++;
      }

      // Max rounds reached
      await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
    });
  });
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "claude": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "ollama": return "llama3.2";
    case "openrouter": return "anthropic/claude-sonnet-4-20250514";
    case "gemini-text": return "gemini-2.5-flash";
    default: return "";
  }
}

function getApiKey(provider: string, settings: any): string {
  switch (provider) {
    case "claude": return settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
    case "openai": return settings.openaiApiKey || process.env.OPENAI_API_KEY || "";
    case "gemini-text": return settings.geminiApiKey || process.env.GEMINI_API_KEY || "";
    case "openrouter": return process.env.OPENROUTER_API_KEY || "";
    default: return "";
  }
}

function getStreamFunction(provider: string) {
  switch (provider) {
    case "claude": return streamClaude;
    case "gemini-text": return streamGeminiText;
    case "openai":
    case "openrouter":
    case "ollama":
    default:
      return streamOpenAI;
  }
}
