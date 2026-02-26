import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => ""));
const mockExistsSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => false));
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

import { ContainerManager } from "./container-manager.js";

function createMockProc(exitCode: number, stderrText = "") {
  return {
    exited: Promise.resolve(exitCode),
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderrText));
        controller.close();
      },
    }),
    kill: vi.fn(),
  };
}

vi.stubGlobal("Bun", { spawn: mockSpawn });

describe("ContainerManager git auth seeding", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    // Default: existsSync returns false (no host files)
    mockExistsSync.mockReturnValue(false);
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

describe("ContainerManager git identity seeding from host .gitconfig", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  it("copies user.name and user.email from /companion-host-gitconfig into container global config", () => {
    // The host .gitconfig is mounted read-only at /companion-host-gitconfig.
    // seedGitAuth should read identity from that file and write it into the
    // container's writable /root/.gitconfig via git config --global.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("gh auth token")) throw new Error("no token");
      return "";
    });

    const manager = new ContainerManager();
    manager.reseedGitAuth("container123");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    // The seeding command should reference the staged host gitconfig path
    const identityCmd = commands.find((cmd) => cmd.includes("companion-host-gitconfig"));
    expect(identityCmd).toBeDefined();
    // It should use git config -f to read from the mounted file
    expect(identityCmd).toContain("git config -f /companion-host-gitconfig user.name");
    expect(identityCmd).toContain("git config -f /companion-host-gitconfig user.email");
    // It should write user.name and user.email via git config --global
    expect(identityCmd).toContain("git config --global user.name");
    expect(identityCmd).toContain("git config --global user.email");
  });

  it("disables gpgsign in writable global config (not the read-only mount)", () => {
    // With the host .gitconfig mounted at /companion-host-gitconfig instead
    // of /root/.gitconfig, git config --global writes succeed in the container.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("gh auth token")) throw new Error("no token");
      return "";
    });

    const manager = new ContainerManager();
    manager.reseedGitAuth("container123");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    expect(commands.some((cmd) => cmd.includes("git config --global commit.gpgsign false"))).toBe(true);
  });

  it("marks /workspace as a safe directory to avoid dubious ownership errors", () => {
    // The workspace volume may be owned by a different uid (e.g. ubuntu)
    // than the container user (root), triggering git's ownership check.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("gh auth token")) throw new Error("no token");
      return "";
    });

    const manager = new ContainerManager();
    manager.reseedGitAuth("container123");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    expect(commands.some((cmd) => cmd.includes("safe.directory /workspace"))).toBe(true);
  });
});

describe("ContainerManager Codex file seeding", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  it("seeds Codex auth files when /companion-host-codex is available", () => {
    // seedCodexFiles is called internally during createContainer and startContainer.
    // Since we can't call createContainer in a unit test (it needs docker), we
    // test the seeding indirectly via a restart (startContainer).
    // However startContainer also calls docker start, so we test via the public
    // reseedGitAuth path which triggers seedGitAuth but not seedCodexFiles.
    // Instead, verify the command is issued during a docker exec mock.
    mockExecSync.mockImplementation((..._args: unknown[]) => "");

    const manager = new ContainerManager();
    // Access private method via bracket notation for testing
    (manager as unknown as Record<string, (id: string) => void>)["seedCodexFiles"]("container456");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    // Should attempt to copy Codex files from bind mount
    expect(commands.some((cmd) =>
      cmd.includes("/companion-host-codex") && cmd.includes("/root/.codex"),
    )).toBe(true);
  });

  it("copies auth.json, config.toml, and directory seeds for Codex", () => {
    mockExecSync.mockImplementation((..._args: unknown[]) => "");

    const manager = new ContainerManager();
    (manager as unknown as Record<string, (id: string) => void>)["seedCodexFiles"]("container789");

    const commands = mockExecSync.mock.calls.map((call) => String(call[0] ?? ""));
    const seedCmd = commands.find((cmd) => cmd.includes("companion-host-codex"));
    expect(seedCmd).toBeDefined();
    // Verify it copies the expected files
    expect(seedCmd).toContain("auth.json");
    expect(seedCmd).toContain("config.toml");
    expect(seedCmd).toContain("models_cache.json");
    // Verify it copies directories
    expect(seedCmd).toContain("skills");
    expect(seedCmd).toContain("prompts");
    expect(seedCmd).toContain("rules");
  });

  it("does not fail when seedCodexFiles encounters an error", () => {
    // seedCodexFiles is best-effort and should not throw
    mockExecSync.mockImplementation(() => {
      throw new Error("container not running");
    });

    const manager = new ContainerManager();
    expect(() => {
      (manager as unknown as Record<string, (id: string) => void>)["seedCodexFiles"]("container999");
    }).not.toThrow();
  });
});

describe("ContainerManager workspace copy", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("uses tar stream + docker exec to copy workspace content", async () => {
    // Validates the fast path used for large workspaces (especially on macOS):
    // tar the host directory and stream directly into /workspace in-container.
    mockSpawn.mockReturnValue(createMockProc(0));

    const manager = new ContainerManager();
    await expect(manager.copyWorkspaceToContainer("container123", "/tmp/my-workspace")).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [args, options] = mockSpawn.mock.calls[0] as [string[], Record<string, unknown>];

    expect(args[0]).toBe("bash");
    expect(args[1]).toBe("-lc");
    expect(args[2]).toContain("set -o pipefail");
    expect(args[2]).toContain("COPYFILE_DISABLE=1 tar -C /tmp/my-workspace -cf - .");
    expect(args[2]).toContain("docker exec -i container123 tar -xf - -C /workspace");
    expect(options.stdout).toBe("pipe");
    expect(options.stderr).toBe("pipe");
  });

  it("throws a descriptive error when copy command fails", async () => {
    // Ensures stderr from the tar/docker pipeline is surfaced to users.
    mockSpawn.mockReturnValue(createMockProc(2, "tar: write error"));

    const manager = new ContainerManager();
    await expect(manager.copyWorkspaceToContainer("container123", "/tmp/my-workspace"))
      .rejects.toThrow("workspace copy failed (exit 2): tar: write error");
  });
});

describe("ContainerManager gitOpsInContainer", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it("runs fetch, checkout, and pull in sequence and reports success", () => {
    // All git commands succeed inside the container
    mockExecSync.mockReturnValue("");

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "feat/new",
      currentBranch: "main",
      defaultBranch: "main",
    });

    expect(result.fetchOk).toBe(true);
    expect(result.checkoutOk).toBe(true);
    expect(result.pullOk).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Verify commands were executed in the container
    const cmds = mockExecSync.mock.calls.map((c) => String(c[0] ?? ""));
    expect(cmds.some((c) => c.includes("git fetch --prune"))).toBe(true);
    expect(cmds.some((c) => c.includes("git checkout"))).toBe(true);
    expect(cmds.some((c) => c.includes("git pull"))).toBe(true);
  });

  it("treats fetch failure as non-fatal and continues with checkout/pull", () => {
    // git fetch fails but checkout and pull succeed
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("git fetch")) throw new Error("network unreachable");
      return "";
    });

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "feat/new",
      currentBranch: "main",
    });

    expect(result.fetchOk).toBe(false);
    expect(result.checkoutOk).toBe(true);
    expect(result.pullOk).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("fetch:");
  });

  it("reports checkout failure when branch does not exist and createBranch is false", () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("git checkout")) throw new Error("pathspec did not match");
      return "";
    });

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "nonexistent",
      currentBranch: "main",
    });

    expect(result.checkoutOk).toBe(false);
    expect(result.errors.some((e) => e.includes("does not exist"))).toBe(true);
  });

  it("creates a new branch when checkout fails and createBranch is true", () => {
    // The simple checkout should fail, then the "checkout -b" fallback should succeed.
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      // Match simple checkout (no -b flag) — the -b flag follows "checkout" directly
      if (cmd.includes("git checkout") && !cmd.includes("checkout -b")) {
        throw new Error("pathspec did not match");
      }
      return "";
    });

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "feat/new",
      currentBranch: "main",
      createBranch: true,
      defaultBranch: "main",
    });

    expect(result.checkoutOk).toBe(true);
    const cmds = mockExecSync.mock.calls.map((c) => String(c[0] ?? ""));
    expect(cmds.some((c) => c.includes("checkout -b"))).toBe(true);
  });

  it("treats pull failure as non-fatal", () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = String(args[0] ?? "");
      if (cmd.includes("git pull")) throw new Error("no tracking info");
      return "";
    });

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "feat/new",
      currentBranch: "main",
    });

    expect(result.pullOk).toBe(false);
    expect(result.checkoutOk).toBe(true);
    expect(result.errors.some((e) => e.includes("pull:"))).toBe(true);
  });

  it("skips checkout when currentBranch matches requested branch", () => {
    mockExecSync.mockReturnValue("");

    const manager = new ContainerManager();
    const result = manager.gitOpsInContainer("cid-123", {
      branch: "main",
      currentBranch: "main",
    });

    expect(result.checkoutOk).toBe(true);
    const cmds = mockExecSync.mock.calls.map((c) => String(c[0] ?? ""));
    // Should not have any checkout command
    expect(cmds.some((c) => c.includes("git checkout"))).toBe(false);
    // But should still fetch and pull
    expect(cmds.some((c) => c.includes("git fetch"))).toBe(true);
    expect(cmds.some((c) => c.includes("git pull"))).toBe(true);
  });
});
