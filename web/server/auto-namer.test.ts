import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock callInternalAI so tests don't depend on real provider config
const mockCallInternalAI = vi.hoisted(() => vi.fn());
vi.mock("./internal-ai.js", () => ({
  callInternalAI: mockCallInternalAI,
}));

import { generateSessionTitle } from "./auto-namer.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSessionTitle", () => {
  it("returns parsed title from AI response", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "Fix Auth Flow",
      ok: true,
    });

    const title = await generateSessionTitle("Fix login", "claude-sonnet-4-6");

    expect(title).toBe("Fix Auth Flow");
  });

  it("returns null when no AI provider is configured", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "",
      ok: false,
      error: "No AI provider configured for internal features",
    });

    const title = await generateSessionTitle("Fix login", "claude-sonnet-4-6");

    expect(title).toBeNull();
  });

  it("truncates message to 500 chars", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "Short Title",
      ok: true,
    });

    await generateSessionTitle("X".repeat(1000), "claude-sonnet-4-6");

    // callInternalAI should have been called with a userPrompt containing at most 500 X's
    const callArgs = mockCallInternalAI.mock.calls[0][0] as { userPrompt: string };
    expect(callArgs.userPrompt).toContain("X".repeat(500));
    expect(callArgs.userPrompt).not.toContain("X".repeat(501));
  });

  it("returns null when AI response is non-ok", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "",
      ok: false,
      error: "Anthropic API error: 401",
    });

    const title = await generateSessionTitle("Fix login", "claude-sonnet-4-6");

    expect(title).toBeNull();
  });

  it("propagates error when callInternalAI rejects", async () => {
    // generateSessionTitle does not wrap callInternalAI in try/catch,
    // so a rejected promise will propagate to the caller.
    mockCallInternalAI.mockRejectedValueOnce(new Error("network"));

    await expect(generateSessionTitle("Fix login", "claude-sonnet-4-6")).rejects.toThrow("network");
  });

  it("strips surrounding quotes from returned title", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: '"Refactor API Layer"',
      ok: true,
    });

    const title = await generateSessionTitle("Refactor API", "ignored");
    expect(title).toBe("Refactor API Layer");
  });

  it("returns null for titles >= 100 chars", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "A".repeat(100),
      ok: true,
    });

    const title = await generateSessionTitle("Do a thing", "ignored");
    expect(title).toBeNull();
  });

  it("passes maxTokens and temperature to callInternalAI", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "Title",
      ok: true,
    });

    await generateSessionTitle("Fix login", "ignored");

    const callArgs = mockCallInternalAI.mock.calls[0][0] as {
      maxTokens: number;
      temperature: number;
    };
    expect(callArgs.maxTokens).toBe(256);
    expect(callArgs.temperature).toBe(0.2);
  });

  it("includes the user prompt with 'Request:' prefix", async () => {
    mockCallInternalAI.mockResolvedValueOnce({
      text: "Title",
      ok: true,
    });

    await generateSessionTitle("Fix login", "ignored");

    const callArgs = mockCallInternalAI.mock.calls[0][0] as { userPrompt: string };
    expect(callArgs.userPrompt).toContain("Request:");
    expect(callArgs.userPrompt).toContain("Fix login");
  });
});
