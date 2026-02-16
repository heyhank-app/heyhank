import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => ""));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

import { ContainerManager } from "./container-manager.js";

describe("ContainerManager git auth seeding", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it("always configures gh as git credential helper when host token lookup fails", () => {
    // Regression guard: copied gh auth files in the container are still valid even
    // when `gh auth token` cannot read host keychain state.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("gh auth token")) throw new Error("host token unavailable");
      return "";
    });

    const manager = new ContainerManager();
    manager.reseedGitAuth("container123");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    expect(commands.some((cmd) => cmd.includes("gh auth setup-git"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes("gh auth login --with-token"))).toBe(false);
  });

  it("logs in with host token before running gh auth setup-git when token exists", () => {
    // Ordering matters: authenticate first, then wire git credential helper.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("gh auth token")) return "ghp_test_token";
      return "";
    });

    const manager = new ContainerManager();
    manager.reseedGitAuth("container123");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    const loginIndex = commands.findIndex((cmd) => cmd.includes("gh auth login --with-token"));
    const setupGitIndex = commands.findIndex((cmd) => cmd.includes("gh auth setup-git"));

    expect(loginIndex).toBeGreaterThan(-1);
    expect(setupGitIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeLessThan(setupGitIndex);
  });
});
