// Smoke test for the IG Wizard MCP stdio server.
//
// Spawns the server as a real subprocess and exchanges MCP JSON-RPC messages
// over stdin/stdout. Validates the two messages our agent code path uses in
// production: `initialize` and `tools/list` — that's enough to prove the
// server (a) registers correctly, (b) responds with our tool definition, and
// (c) doesn't crash on the boilerplate handshake.
//
// We deliberately don't test `tools/call` here because that would require a
// live AI provider; the underlying logic is already covered by
// ig-wizard.test.ts (shared module) and ig-wizard-routes.test.ts (HTTP route).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "ig-wizard-mcp-server.ts",
);

/**
 * Tiny stdio MCP client: writes one JSON-RPC request and waits for the
 * matching response (by id). Stops at the first matching line — no SSE,
 * no chunked transfers in stdio MCP.
 */
async function sendMcp(child: ChildProcess, req: unknown, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reqId = (req as { id?: unknown }).id;
    const stdout = child.stdout;
    if (!stdout) {
      reject(new Error("child has no stdout"));
      return;
    }
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === reqId) {
            stdout.off("data", onData);
            clearTimeout(t);
            resolve(msg);
            return;
          }
        } catch {
          // Not a JSON line — ignore (server may emit nothing else but be safe).
        }
      }
    };
    const t = setTimeout(() => {
      stdout.off("data", onData);
      reject(new Error(`MCP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    stdout.on("data", onData);
    child.stdin?.write(JSON.stringify(req) + "\n");
  });
}

// Skip the entire suite when `bun` isn't on PATH (e.g. running tests through
// raw `vitest` in CI without bun). The MCP server is shebanged for bun
// because that's how the agent launches it in production.
import { execSync } from "node:child_process";
let hasBun = false;
try {
  execSync("which bun", { stdio: "ignore" });
  hasBun = true;
} catch {
  hasBun = false;
}

describe.skipIf(!hasBun)("ig-wizard-mcp-server (subprocess smoke)", () => {
  let child: ChildProcess;

  beforeEach(() => {
    child = spawn("bun", ["run", SERVER_PATH], { stdio: ["pipe", "pipe", "pipe"] });
  });

  afterEach(() => {
    if (child.pid && !child.killed) child.kill("SIGTERM");
  });

  it("responds to initialize", async () => {
    const res = (await sendMcp(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0" },
      },
    })) as { result?: { serverInfo?: { name?: string } } };
    expect(res.result?.serverInfo?.name).toBe("heyhank-ig-wizard");
  }, 15000);

  it("lists the ig_wizard_generate tool", async () => {
    // Must initialize first or some MCP servers reject other calls.
    await sendMcp(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0" },
      },
    });
    // Notify initialized — some servers gate tools/list on this.
    child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const res = (await sendMcp(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })) as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } };

    expect(Array.isArray(res.result?.tools)).toBe(true);
    expect(res.result?.tools).toHaveLength(1);
    const tool = res.result!.tools![0];
    expect(tool.name).toBe("ig_wizard_generate");
    expect(tool.description).toMatch(/hook/i);
    expect(tool.inputSchema).toBeTruthy();
  }, 15000);
});
