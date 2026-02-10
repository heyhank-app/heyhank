import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock Bun.spawn before importing the module
const mockProc = {
  exited: Promise.resolve(0),
  stdout: new ReadableStream(),
  stderr: new ReadableStream(),
  kill: vi.fn(),
};

const mockSpawn = vi.fn(() => mockProc);
vi.stubGlobal("Bun", { spawn: mockSpawn });

// Mock execSync for binary resolution
const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync }));

import { generateSessionTitle } from "./auto-namer.js";

function makeStdout(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecSync.mockReturnValue("/usr/bin/claude\n");
});

describe("generateSessionTitle", () => {
  it("returns parsed title from JSON output", async () => {
    mockProc.stdout = makeStdout(JSON.stringify({ result: "Fix Auth Flow" }));
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Fix the login bug", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBe("Fix Auth Flow");
  });

  it("strips surrounding quotes from the title", async () => {
    mockProc.stdout = makeStdout(JSON.stringify({ result: '"Refactor API Layer"' }));
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Refactor the API", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBe("Refactor API Layer");
  });

  it("returns null for empty result", async () => {
    mockProc.stdout = makeStdout(JSON.stringify({ result: "" }));
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Do something", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBeNull();
  });

  it("returns null for title exceeding 100 characters", async () => {
    const longTitle = "A".repeat(101);
    mockProc.stdout = makeStdout(JSON.stringify({ result: longTitle }));
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Do something", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBeNull();
  });

  it("falls back to raw stdout when JSON parsing fails", async () => {
    mockProc.stdout = makeStdout("Plain Text Title");
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Build the thing", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBe("Plain Text Title");
  });

  it("returns null when raw stdout is empty", async () => {
    mockProc.stdout = makeStdout("");
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Empty response", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBeNull();
  });

  it("returns null when raw stdout exceeds 100 characters", async () => {
    mockProc.stdout = makeStdout("B".repeat(101));
    mockProc.exited = Promise.resolve(0);

    const title = await generateSessionTitle("Long response", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBeNull();
  });

  it("truncates the user message to 500 characters for the prompt", async () => {
    const longMessage = "X".repeat(1000);
    mockProc.stdout = makeStdout(JSON.stringify({ result: "Short Title" }));
    mockProc.exited = Promise.resolve(0);

    await generateSessionTitle(longMessage, "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    // The prompt should contain only first 500 characters of the message
    const spawnArgs = (mockSpawn.mock.calls as unknown as string[][][])[0]?.[0];
    const promptArg = spawnArgs?.[2]; // [binary, "-p", PROMPT, ...]
    expect(promptArg).toContain("X".repeat(500));
    expect(promptArg).not.toContain("X".repeat(501));
  });

  it("passes the correct model to the CLI", async () => {
    mockProc.stdout = makeStdout(JSON.stringify({ result: "Title" }));
    mockProc.exited = Promise.resolve(0);

    await generateSessionTitle("Hello", "claude-opus-4-20250514", {
      claudeBinary: "/usr/bin/claude",
    });

    const spawnArgs = (mockSpawn.mock.calls as unknown as string[][][])[0]?.[0];
    expect(spawnArgs).toContain("--model");
    expect(spawnArgs).toContain("claude-opus-4-20250514");
  });

  it("returns null on timeout", async () => {
    // Make proc.exited never resolve so timeout wins
    mockProc.exited = new Promise(() => {});
    mockProc.stdout = makeStdout("");

    const title = await generateSessionTitle("Slow request", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
      timeoutMs: 50,
    });

    expect(title).toBeNull();
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns null when Bun.spawn throws", async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    const title = await generateSessionTitle("Crash", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    expect(title).toBeNull();
  });

  it("uses --output-format json flag", async () => {
    mockProc.stdout = makeStdout(JSON.stringify({ result: "Title" }));
    mockProc.exited = Promise.resolve(0);

    await generateSessionTitle("Hello", "claude-sonnet-4-5-20250929", {
      claudeBinary: "/usr/bin/claude",
    });

    const spawnArgs = (mockSpawn.mock.calls as unknown as string[][][])[0]?.[0];
    expect(spawnArgs).toContain("--output-format");
    expect(spawnArgs).toContain("json");
  });
});
