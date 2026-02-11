import { describe, it, expect } from "vitest";
import {
  extractProjectKey,
  extractProjectLabel,
  groupSessionsByProject,
  type SessionItem,
} from "./project-grouping.js";

function makeItem(overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    id: "s1",
    model: "claude-sonnet-4-5-20250929",
    cwd: "/home/user/projects/myapp",
    gitBranch: "",
    isWorktree: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: false,
    status: null,
    sdkState: null,
    createdAt: 1000,
    archived: false,
    backendType: "claude",
    repoRoot: "",
    permCount: 0,
    ...overrides,
  };
}

describe("extractProjectKey", () => {
  it("uses repoRoot when available (worktree normalization)", () => {
    expect(
      extractProjectKey("/home/user/myapp-wt-1234", "/home/user/myapp"),
    ).toBe("/home/user/myapp");
  });

  it("falls back to cwd when repoRoot is undefined", () => {
    expect(extractProjectKey("/home/user/projects/myapp")).toBe(
      "/home/user/projects/myapp",
    );
  });

  it("removes trailing slashes", () => {
    expect(extractProjectKey("/home/user/myapp/")).toBe("/home/user/myapp");
  });

  it("returns / for empty cwd", () => {
    expect(extractProjectKey("")).toBe("/");
  });

  it("prefers repoRoot over cwd even when both are valid", () => {
    expect(
      extractProjectKey("/home/user/myapp/web", "/home/user/myapp"),
    ).toBe("/home/user/myapp");
  });
});

describe("extractProjectLabel", () => {
  it("returns last path component for normal paths", () => {
    expect(extractProjectLabel("/home/user/projects/myapp")).toBe("myapp");
  });

  it("returns / for root path", () => {
    expect(extractProjectLabel("/")).toBe("/");
  });

  it("handles single component path", () => {
    expect(extractProjectLabel("/myapp")).toBe("myapp");
  });

  it("handles deep nested paths", () => {
    expect(extractProjectLabel("/a/b/c/d/e")).toBe("e");
  });
});

describe("groupSessionsByProject", () => {
  it("groups sessions sharing the same cwd into one group", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/home/user/myapp" }),
      makeItem({ id: "s2", cwd: "/home/user/myapp" }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[0].label).toBe("myapp");
  });

  it("groups worktree sessions with their parent repo", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/home/user/myapp", repoRoot: "/home/user/myapp" }),
      makeItem({ id: "s2", cwd: "/home/user/myapp-wt-1234", repoRoot: "/home/user/myapp", isWorktree: true }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("sorts groups alphabetically by label", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/a/zebra", createdAt: 200 }),
      makeItem({ id: "s2", cwd: "/a/alpha", createdAt: 100 }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups[0].label).toBe("alpha");
    expect(groups[1].label).toBe("zebra");
  });

  it("sorts sessions within group: running first, then by createdAt desc", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/a/app", createdAt: 300, status: null }),
      makeItem({ id: "s2", cwd: "/a/app", createdAt: 100, status: "running" }),
      makeItem({ id: "s3", cwd: "/a/app", createdAt: 200, status: null }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
  });

  it("handles sessions with empty cwd as a separate group", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/a/app" }),
      makeItem({ id: "s2", cwd: "" }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups).toHaveLength(2);
  });

  it("computes aggregate runningCount and permCount", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/a/app", status: "running", permCount: 1 }),
      makeItem({ id: "s2", cwd: "/a/app", status: "running", permCount: 2 }),
      makeItem({ id: "s3", cwd: "/a/app", status: null, permCount: 0 }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups[0].runningCount).toBe(2);
    expect(groups[0].permCount).toBe(3);
  });

  it("creates separate groups for different directories", () => {
    const sessions = [
      makeItem({ id: "s1", cwd: "/a/app1" }),
      makeItem({ id: "s2", cwd: "/a/app2" }),
      makeItem({ id: "s3", cwd: "/a/app1" }),
    ];
    const groups = groupSessionsByProject(sessions);
    expect(groups).toHaveLength(2);
  });
});
