// ─── LLM Provider Routes ─────────────────────────────────────────────────────
// REST API for calling non-CLI LLM providers (Ollama, OpenRouter, Gemini)

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  callLLM,
  streamOllama,
  listOllamaModels,
  pullOllamaModel,
} from "../llm-providers.js";
import type { LLMProviderConfig, LLMMessage } from "../llm-providers.js";

export function registerLLMRoutes(api: Hono): void {
  /** Call an LLM provider (non-streaming) */
  api.post("/llm/chat", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    if (!body.messages || !body.provider || !body.model) {
      return c.json(
        { error: "messages, provider, and model are required" },
        400,
      );
    }

    const config: LLMProviderConfig = {
      provider: body.provider,
      model: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    };

    try {
      const response = await callLLM(body.messages as LLMMessage[], config);
      return c.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Stream from Ollama via SSE */
  api.post("/llm/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        await stream.writeSSE({ data: JSON.stringify({ error: "Invalid JSON" }) });
        return;
      }

      if (!body.messages || !body.model) {
        await stream.writeSSE({
          data: JSON.stringify({ error: "messages and model required" }),
        });
        return;
      }

      const config: LLMProviderConfig = {
        provider: (body.provider as LLMProviderConfig["provider"]) || "ollama",
        model: body.model as string,
        baseUrl: body.baseUrl as string | undefined,
        temperature: body.temperature as number | undefined,
        maxTokens: body.maxTokens as number | undefined,
      };

      try {
        if (config.provider === "ollama") {
          for await (const chunk of streamOllama(
            body.messages as LLMMessage[],
            config,
          )) {
            await stream.writeSSE({
              data: JSON.stringify(chunk),
            });
            if (chunk.done) break;
          }
        } else {
          // Non-streaming fallback for other providers
          const response = await callLLM(
            body.messages as LLMMessage[],
            config,
          );
          await stream.writeSSE({
            data: JSON.stringify({ content: response.content, done: true }),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({ data: JSON.stringify({ error: message }) });
      }
    });
  });

  /** List available Ollama models */
  api.get("/llm/ollama/models", async (c) => {
    const models = await listOllamaModels();
    return c.json({ models });
  });

  /** Pull an Ollama model */
  api.post("/llm/ollama/pull", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.model) {
      return c.json({ error: "model is required" }, 400);
    }
    try {
      await pullOllamaModel(body.model);
      return c.json({ ok: true, model: body.model });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** Get available providers and their status */
  api.get("/llm/providers", async (c) => {
    const providers = [];

    // Check Ollama
    try {
      const models = await listOllamaModels();
      providers.push({
        name: "ollama",
        status: "available",
        models: models.map((m) => m.name),
        endpoint: "http://localhost:11434",
      });
    } catch {
      providers.push({ name: "ollama", status: "unavailable", models: [] });
    }

    // Check OpenRouter
    providers.push({
      name: "openrouter",
      status: process.env.OPENROUTER_API_KEY ? "configured" : "needs_api_key",
      endpoint: "https://openrouter.ai/api/v1",
    });

    // Check Gemini
    providers.push({
      name: "gemini",
      status: process.env.GEMINI_API_KEY ? "configured" : "needs_api_key",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
    });

    // Claude (always via CLI)
    providers.push({
      name: "claude",
      status: "available",
      note: "Uses Claude CLI (Max subscription)",
    });

    // Codex (always via CLI)
    providers.push({
      name: "codex",
      status: "available",
      note: "Uses Codex CLI",
    });

    return c.json({ providers });
  });
}
