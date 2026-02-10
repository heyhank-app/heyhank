import { describe, it, expect } from "bun:test";
import { getRepoInfo, listBranches } from "../git-utils.js";
import { execSync } from "node:child_process";

// Use the actual repo we're running in for tests
const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

describe("getRepoInfo", () => {
  it("returns repo info for a valid git repo", () => {
    const info = getRepoInfo(REPO_ROOT);
    expect(info).not.toBeNull();
    expect(info!.repoRoot).toBe(REPO_ROOT);
    expect(info!.repoName).toBe("claude-code-api");
    expect(info!.currentBranch).toBeTypeOf("string");
    expect(info!.currentBranch.length).toBeGreaterThan(0);
    expect(info!.defaultBranch).toBeTypeOf("string");
    expect(typeof info!.isWorktree).toBe("boolean");
  });

  it("returns null for a non-git directory", () => {
    const info = getRepoInfo("/tmp");
    expect(info).toBeNull();
  });
});

describe("listBranches", () => {
  it("returns a non-empty array of branches", () => {
    const branches = listBranches(REPO_ROOT);
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.length).toBeGreaterThan(0);
  });

  it("includes the current branch marked as isCurrent", () => {
    const branches = listBranches(REPO_ROOT);
    const current = branches.find((b) => b.isCurrent);
    expect(current).toBeDefined();
    expect(current!.isRemote).toBe(false);
  });

  it("includes the main branch", () => {
    const branches = listBranches(REPO_ROOT);
    const main = branches.find((b) => b.name === "main");
    expect(main).toBeDefined();
    expect(main!.isRemote).toBe(false);
  });

  it("each branch has the expected shape", () => {
    const branches = listBranches(REPO_ROOT);
    for (const b of branches.slice(0, 5)) {
      expect(b.name).toBeTypeOf("string");
      expect(b.name.length).toBeGreaterThan(0);
      expect(typeof b.isCurrent).toBe("boolean");
      expect(typeof b.isRemote).toBe("boolean");
      expect(typeof b.ahead).toBe("number");
      expect(typeof b.behind).toBe("number");
    }
  });

  it("separates local and remote branches", () => {
    const branches = listBranches(REPO_ROOT);
    const local = branches.filter((b) => !b.isRemote);
    const remote = branches.filter((b) => b.isRemote);
    // Should have at least some local branches
    expect(local.length).toBeGreaterThan(0);
    // Remote branches should not duplicate local branch names
    const localNames = new Set(local.map((b) => b.name));
    for (const r of remote) {
      expect(localNames.has(r.name)).toBe(false);
    }
  });
});
