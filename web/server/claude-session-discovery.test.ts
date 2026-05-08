import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deleteClaudeSessionTranscript, discoverClaudeSessions } from "./claude-session-discovery.js";

const tempRoots: string[] = [];

function createTempProjectsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "claude-projects-test-"));
  tempRoots.push(root);
  return root;
}

function writeSessionFile(
  projectsRoot: string,
  projectDirName: string,
  fileName: string,
  payload: {
    sessionId: string;
    cwd: string;
    gitBranch?: string;
    slug?: string;
  },
  mtimeMs: number,
) {
  const projectDir = join(projectsRoot, projectDirName);
  mkdirSync(projectDir, { recursive: true });
  const filePath = join(projectDir, fileName);
  const content = `${JSON.stringify({ type: "file-history-snapshot" })}\n${JSON.stringify(payload)}\n`;
  writeFileSync(filePath, content, "utf-8");
  const mtime = new Date(mtimeMs);
  utimesSync(filePath, mtime, mtime);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("discoverClaudeSessions", () => {
  it("discovers persisted Claude sessions with cwd/branch metadata", () => {
    const root = createTempProjectsRoot();
    // Validate that a normal JSONL session file is parsed into resumable metadata.
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a.jsonl",
      {
        sessionId: "session-a",
        cwd: "/Users/test/repo",
        gitBranch: "main",
        slug: "curious-babbage",
      },
      1000,
    );

    const sessions = discoverClaudeSessions({ projectsRoot: root, limit: 10 });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "session-a",
      cwd: "/Users/test/repo",
      gitBranch: "main",
      slug: "curious-babbage",
    });
  });

  it("deduplicates by sessionId and keeps the most recently active record", () => {
    const root = createTempProjectsRoot();
    // Validate that when the same session appears in multiple files, the newest one wins.
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a-old.jsonl",
      {
        sessionId: "session-a",
        cwd: "/Users/test/repo",
        gitBranch: "main",
      },
      1000,
    );
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a-new.jsonl",
      {
        sessionId: "session-a",
        cwd: "/Users/test/repo",
        gitBranch: "feature/new-ui",
      },
      2000,
    );

    const sessions = discoverClaudeSessions({ projectsRoot: root, limit: 10 });

    expect(sessions).toHaveLength(1);
    expect(sessions[0].gitBranch).toBe("feature/new-ui");
    expect(sessions[0].lastActivityAt).toBe(2000);
  });

  it("applies the requested limit after sorting by recency", () => {
    const root = createTempProjectsRoot();
    // Validate that callers can bound result size for responsive UI pickers.
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-1.jsonl",
      { sessionId: "session-1", cwd: "/Users/test/repo-1" },
      1000,
    );
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-2.jsonl",
      { sessionId: "session-2", cwd: "/Users/test/repo-2" },
      2000,
    );
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-3.jsonl",
      { sessionId: "session-3", cwd: "/Users/test/repo-3" },
      3000,
    );

    const sessions = discoverClaudeSessions({ projectsRoot: root, limit: 2 });

    expect(sessions.map((s) => s.sessionId)).toEqual(["session-3", "session-2"]);
  });
});

describe("deleteClaudeSessionTranscript", () => {
  // Validates the happy path: the on-disk transcript is removed so the
  // session no longer surfaces in the "Branch from session" picker.
  it("removes the matching .jsonl transcript file", () => {
    const root = createTempProjectsRoot();
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a.jsonl",
      { sessionId: "session-a", cwd: "/Users/test/repo" },
      1000,
    );
    const filePath = join(root, "-Users-test-repo", "session-a.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const result = deleteClaudeSessionTranscript("session-a", { projectsRoot: root });

    expect(result.deleted).toContain(filePath);
    expect(existsSync(filePath)).toBe(false);
    // Sibling sessions must remain untouched.
    expect(discoverClaudeSessions({ projectsRoot: root })).toHaveLength(0);
  });

  // Claude Code occasionally creates a sidecar `<sessionId>/` dir next to the
  // transcript (e.g. for cached attachments) — make sure both are nuked.
  it("removes the sidecar directory if one exists alongside the transcript", () => {
    const root = createTempProjectsRoot();
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a.jsonl",
      { sessionId: "session-a", cwd: "/Users/test/repo" },
      1000,
    );
    const sidecarDir = join(root, "-Users-test-repo", "session-a");
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(join(sidecarDir, "blob.bin"), "x");

    const result = deleteClaudeSessionTranscript("session-a", { projectsRoot: root });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(result.deleted.some((p) => p.endsWith("session-a"))).toBe(true);
  });

  // No-op for sessions that never produced a transcript (e.g. Codex sessions
  // routed here defensively, or sessions deleted twice).
  it("returns empty deleted list when nothing matches", () => {
    const root = createTempProjectsRoot();
    writeSessionFile(
      root,
      "-Users-test-repo",
      "session-a.jsonl",
      { sessionId: "session-a", cwd: "/Users/test/repo" },
      1000,
    );

    const result = deleteClaudeSessionTranscript("session-missing", { projectsRoot: root });

    expect(result.deleted).toEqual([]);
    // Other transcripts left alone.
    expect(existsSync(join(root, "-Users-test-repo", "session-a.jsonl"))).toBe(true);
  });

  // Safety: empty/non-string sessionId must never walk the projects root.
  it("returns empty result for invalid sessionId without scanning disk", () => {
    const result = deleteClaudeSessionTranscript("", { projectsRoot: "/nonexistent" });
    expect(result.deleted).toEqual([]);
  });

  // Same sessionId can show up under multiple encoded-cwd dirs if the cwd was
  // renamed mid-session — verify both copies are removed.
  it("removes transcripts across multiple project subdirs", () => {
    const root = createTempProjectsRoot();
    writeSessionFile(
      root,
      "-Users-test-repo-old",
      "session-a.jsonl",
      { sessionId: "session-a", cwd: "/Users/test/repo-old" },
      1000,
    );
    writeSessionFile(
      root,
      "-Users-test-repo-new",
      "session-a.jsonl",
      { sessionId: "session-a", cwd: "/Users/test/repo-new" },
      2000,
    );

    const result = deleteClaudeSessionTranscript("session-a", { projectsRoot: root });

    expect(result.deleted).toHaveLength(2);
    expect(existsSync(join(root, "-Users-test-repo-old", "session-a.jsonl"))).toBe(false);
    expect(existsSync(join(root, "-Users-test-repo-new", "session-a.jsonl"))).toBe(false);
  });
});
