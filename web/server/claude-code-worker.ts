// ─── Claude Code Headless Worker ─────────────────────────────────────────────
// One-shot LLM call via the locally-installed Claude Code CLI in --print mode.
// Uses the Claude Code Subscription (no Anthropic API charges) instead of
// `callInternalAI`. Tools are disabled (`--tools ""`) so the call behaves as a
// pure completion endpoint. Session persistence is off so we don't pollute the
// user's local Claude Code history.

import { spawn } from "node:child_process";

interface HeadlessOpts {
  systemPrompt: string;
  userPrompt: string;
  /** "sonnet" | "opus" | "haiku" | full model id. Defaults to "sonnet". */
  model?: string;
  /** Total wall-clock timeout. Defaults to 120s. */
  timeoutMs?: number;
}

type HeadlessResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** Spawn `claude -p` and return its stdout. */
export function callClaudeCodeHeadless(opts: HeadlessOpts): Promise<HeadlessResult> {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--tools", "",
      "--no-session-persistence",
      "--model", opts.model ?? "sonnet",
      "--system-prompt", opts.systemPrompt,
      opts.userPrompt,
    ];

    let child;
    try {
      // Unset CLAUDECODE so the headless invocation isn't refused as a "nested
      // session" if our own process happens to be running inside Claude Code.
      // PM2-managed prod doesn't have it; dev under Claude Code does.
      const childEnv: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
      delete childEnv.CLAUDECODE;
      delete childEnv.CLAUDE_CODE_ENTRYPOINT;

      child = spawn("claude", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
    } catch (e) {
      resolve({ ok: false, error: `spawn failed: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, error: `claude headless timeout after ${opts.timeoutMs ?? 120_000}ms` });
    }, opts.timeoutMs ?? 120_000);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `claude spawn error: ${err.message}` });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, text: stdout.trim() });
      } else {
        const tail = stderr.trim().slice(-500) || stdout.trim().slice(-500);
        resolve({ ok: false, error: `claude exit ${code}: ${tail || "no output"}` });
      }
    });
  });
}
