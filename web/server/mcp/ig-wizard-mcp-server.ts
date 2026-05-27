#!/usr/bin/env bun
// Stdio MCP server exposing the `ig_wizard_generate` tool.
// Launched as a subprocess by the Claude Code CLI when the content-agent
// session starts; MCP traffic flows over stdin/stdout JSON-RPC.
//
// CRITICAL: stdout is RESERVED for JSON-RPC. Any log/diagnostic output MUST
// go to stderr. A stray console.log here will corrupt the protocol and the
// agent will fail to call the tool.
//
// Runtime: invoked via `bun run` so we can import the TypeScript modules
// directly. Stays inside the same /opt/agentplatform/web/server tree so it
// shares ig-wizard.ts, internal-ai.ts, settings-manager.ts with the HTTP
// route — single source of truth for prompt + parsing.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateIgWizard, normalizeLanguage, normalizeNiche } from "../ig-wizard.js";

const server = new McpServer({
  name: "heyhank-ig-wizard",
  version: "0.1.0",
});

server.registerTool(
  "ig_wizard_generate",
  {
    title: "IG Wizard Generate",
    description:
      "Generate 20 viral Instagram hooks and 30 CTAs (10 Engagement, 10 Leads, 10 Growth) for a given niche. The Leads CTAs include ALL-CAPS trigger keywords that map directly to HeyHank Auto-DM rules — use them to build the comment-keyword → DM funnel. Call this BEFORE drafting any IG Reel, Photo Post, or Carousel so your hook + CTA selection comes from a tested pool, not improvised.",
    inputSchema: {
      niche: z
        .string()
        .max(200)
        .describe(
          'The IG niche / topic to generate for. Keep it broad enough for mass appeal (e.g. "AI productivity for solopreneurs") rather than micro-niche.',
        ),
      language: z
        .enum(["en", "de"])
        .default("en")
        .describe('Output language. "en" for Instagram/Facebook posts (the international tone). "de" for LinkedIn DACH or any German-speaking-target post.'),
    },
  },
  async (args) => {
    const niche = normalizeNiche(args.niche);
    const lang = normalizeLanguage(args.language);
    const out = await generateIgWizard(niche, lang);

    if (!out.ok) {
      // MCP convention: tool errors are surfaced as isError=true with a text
      // explanation so the calling model can react gracefully (retry, switch
      // providers, ask the user) rather than crashing the session.
      return {
        isError: true,
        content: [{ type: "text" as const, text: `ig_wizard_generate failed (status ${out.status}): ${out.error}` }],
      };
    }

    // Return the full result as JSON text so the model can parse + cite it.
    // We deliberately don't pre-filter (e.g. "top 5 hooks") — the agent
    // decides which hook + CTA combination fits the specific brief.
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(out.result, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr so it shows up in the parent's stderr capture but does NOT
// pollute the JSON-RPC stream on stdout.
console.error("[ig-wizard-mcp] connected");
