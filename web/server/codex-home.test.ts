import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_HEYHANK_CODEX_HOME,
  getLegacyCodexHome,
  resolveHeyHankCodexHome,
  resolveHeyHankCodexSessionHome,
} from "./codex-home.js";

describe("codex-home", () => {
  it("DEFAULT_HEYHANK_CODEX_HOME points to ~/.heyhank/codex-home", () => {
    expect(DEFAULT_HEYHANK_CODEX_HOME).toBe(
      join(homedir(), ".heyhank", "codex-home"),
    );
  });

  it("getLegacyCodexHome returns ~/.codex", () => {
    expect(getLegacyCodexHome()).toBe(join(homedir(), ".codex"));
  });

  it("resolveHeyHankCodexHome returns default when no explicit path given", () => {
    expect(resolveHeyHankCodexHome()).toBe(DEFAULT_HEYHANK_CODEX_HOME);
  });

  it("resolveHeyHankCodexHome uses explicit path when provided", () => {
    const custom = "/tmp/my-codex-home";
    expect(resolveHeyHankCodexHome(custom)).toBe(custom);
  });

  // Regression: resolveHeyHankCodexHome must NOT read process.env.CODEX_HOME
  // because that points to the user's global ~/.codex and would break per-session isolation.
  it("resolveHeyHankCodexHome ignores process.env.CODEX_HOME", () => {
    const original = process.env.CODEX_HOME;
    try {
      process.env.CODEX_HOME = "/tmp/global-codex";
      expect(resolveHeyHankCodexHome()).toBe(DEFAULT_HEYHANK_CODEX_HOME);
    } finally {
      if (original === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = original;
      }
    }
  });

  it("resolveHeyHankCodexSessionHome appends sessionId to base", () => {
    const sessionId = "abc-123";
    expect(resolveHeyHankCodexSessionHome(sessionId)).toBe(
      join(DEFAULT_HEYHANK_CODEX_HOME, sessionId),
    );
  });

  it("resolveHeyHankCodexSessionHome uses explicit path", () => {
    const custom = "/tmp/my-codex-home";
    const sessionId = "xyz-789";
    expect(resolveHeyHankCodexSessionHome(sessionId, custom)).toBe(
      join(custom, sessionId),
    );
  });
});
