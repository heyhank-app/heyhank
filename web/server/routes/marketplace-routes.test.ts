import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
// The marketplace module reads/writes the filesystem and fetches GitHub.
// We mock both so the tests run hermetically.

const mockExistsSync = vi.hoisted(() => vi.fn((_path: string) => false));
const mockMkdir = vi.hoisted(() => vi.fn(async (_path: string, _opts?: unknown) => {}));
const mockWriteFile = vi.hoisted(() =>
  vi.fn(async (_path: string, _content: unknown, _enc?: unknown) => {}),
);
const mockReadFile = vi.hoisted(() => vi.fn(async (_path: string, _enc?: unknown) => ""));
const mockRm = vi.hoisted(() => vi.fn(async (_path: string, _opts?: unknown) => {}));
const mockRename = vi.hoisted(() => vi.fn(async (_a: string, _b: string) => {}));

vi.mock("node:fs", () => ({ existsSync: mockExistsSync }));
vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  rm: mockRm,
  rename: mockRename,
}));
vi.mock("node:os", () => ({ homedir: () => "/mock-home" }));

import { Hono } from "hono";
import { registerMarketplaceRoutes } from "./marketplace-routes.js";

const SKILLS_DIR = "/mock-home/.claude/skills";

let app: Hono;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue("");
  mockRm.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);

  originalFetch = globalThis.fetch;
  app = new Hono();
  registerMarketplaceRoutes(app);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Helper: make a fetch mock with response map keyed by URL substring.
function mockFetchMap(map: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, value] of Object.entries(map)) {
      if (url.includes(pattern)) {
        if (value instanceof Error) {
          return { ok: false, status: 502 } as Response;
        }
        const isObj = typeof value === "object" && value !== null;
        return {
          ok: true,
          status: 200,
          async json() {
            return value;
          },
          async text() {
            return typeof value === "string" ? value : JSON.stringify(value);
          },
          async arrayBuffer() {
            const text = typeof value === "string" ? value : JSON.stringify(value);
            return new TextEncoder().encode(text).buffer;
          },
          headers: { get: () => (isObj ? "application/json" : "text/plain") },
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404 } as Response;
  }) as unknown as typeof globalThis.fetch;
}

// ─── GET /marketplace/sources ───────────────────────────────────────────────

describe("GET /marketplace/sources", () => {
  it("returns the built-in marketplace source list", async () => {
    const res = await app.request("/marketplace/sources");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
    // Charlie's repo ships as the first built-in
    expect(json[0]).toMatchObject({
      id: "charlie947-social-media-skills",
      url: "https://github.com/charlie947/social-media-skills",
    });
    expect(json[0].name).toBeTruthy();
    expect(json[0].description).toBeTruthy();
  });
});

// ─── GET /marketplace/sources/:id/skills ────────────────────────────────────

describe("GET /marketplace/sources/:id/skills", () => {
  it("returns 404 for an unknown source", async () => {
    const res = await app.request("/marketplace/sources/does-not-exist/skills");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Source not found");
  });

  it("lists skills with frontmatter parsed from each SKILL.md", async () => {
    // GitHub Contents API returns a list of dirs; raw URLs return SKILL.md bodies.
    mockFetchMap({
      "/contents/skills?": [
        { name: "post-writer", path: "skills/post-writer", type: "dir", download_url: null, sha: "a" },
        { name: "voice-builder", path: "skills/voice-builder", type: "dir", download_url: null, sha: "b" },
      ],
      "skills/post-writer/SKILL.md":
        '---\nname: "Post Writer"\ndescription: "Writes LinkedIn posts"\n---\nbody',
      "skills/voice-builder/SKILL.md":
        '---\nname: "Voice Builder"\ndescription: "Defines brand voice"\n---\nbody',
    });

    const res = await app.request(
      "/marketplace/sources/charlie947-social-media-skills/skills",
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    // Both should be present with parsed name + description
    const slugs = json.map((s: { slug: string }) => s.slug).sort();
    expect(slugs).toEqual(["post-writer", "voice-builder"]);
    const post = json.find((s: { slug: string }) => s.slug === "post-writer");
    expect(post.name).toBe("Post Writer");
    expect(post.description).toBe("Writes LinkedIn posts");
    expect(post.sourceId).toBe("charlie947-social-media-skills");
  });

  it("returns 502 when the GitHub API fails", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof globalThis.fetch;

    const res = await app.request(
      "/marketplace/sources/charlie947-social-media-skills/skills",
    );
    expect(res.status).toBe(502);
  });

  it("falls back to slug as name when SKILL.md has no frontmatter", async () => {
    mockFetchMap({
      "/contents/skills?": [
        { name: "raw-skill", path: "skills/raw-skill", type: "dir", download_url: null, sha: "x" },
      ],
      "skills/raw-skill/SKILL.md": "# Raw\nNo frontmatter at all.",
    });

    const res = await app.request(
      "/marketplace/sources/charlie947-social-media-skills/skills",
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json[0].name).toBe("raw-skill");
    expect(json[0].description).toBe("");
  });
});

// ─── POST /marketplace/install ─────────────────────────────────────────────

describe("POST /marketplace/install", () => {
  it("returns 404 when the source does not exist", async () => {
    const res = await app.request("/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "no-such", slug: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the slug is invalid (path traversal)", async () => {
    // Spy on fetch to verify the install never reaches the network on bad input.
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const res = await app.request("/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "charlie947-social-media-skills",
        slug: "../etc",
      }),
    });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("returns 409 when the skill directory already exists (no overwrite)", async () => {
    // existsSync returns true for the final directory check
    mockExistsSync.mockReturnValue(true);
    const res = await app.request("/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "charlie947-social-media-skills",
        slug: "post-writer",
      }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already installed/i);
  });

  it("downloads SKILL.md and writes it under ~/.claude/skills/<slug>/", async () => {
    // No existing dir → install proceeds. Existence checks during install:
    //   1. final dir exists?  → false (allow install)
    //   2. SKILL.md present in staging? → true (success)
    //   3. final dir exists for cleanup? → false (skip rm)
    //   4. staging dir exists for rollback? → false
    mockExistsSync
      .mockReturnValueOnce(false) // finalDir check
      .mockReturnValueOnce(true) // SKILL.md present after download
      .mockReturnValueOnce(false) // no pre-existing finalDir to remove
      .mockReturnValue(false);

    mockFetchMap({
      "/contents/skills/post-writer?": [
        {
          name: "SKILL.md",
          path: "skills/post-writer/SKILL.md",
          type: "file",
          download_url:
            "https://raw.githubusercontent.com/charlie947/social-media-skills/main/skills/post-writer/SKILL.md",
          sha: "deadbeef",
        },
      ],
      "raw.githubusercontent.com": '---\nname: "Post Writer"\n---\nbody',
    });

    const res = await app.request("/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "charlie947-social-media-skills",
        slug: "post-writer",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.slug).toBe("post-writer");

    // The downloaded SKILL.md should have been written via fs/promises.writeFile.
    // The path will be the staging directory; we just check that some path
    // ending in /SKILL.md was written.
    const writtenPaths = mockWriteFile.mock.calls.map((c) => c[0] as string);
    expect(writtenPaths.some((p) => p.endsWith("/SKILL.md"))).toBe(true);

    // Metadata file should also be written
    expect(writtenPaths.some((p) => p.endsWith("/.heyhank-meta.json"))).toBe(true);

    // Atomic move: rename from staging → final
    expect(mockRename).toHaveBeenCalled();
    const renameCall = mockRename.mock.calls[0];
    expect(renameCall[1]).toBe(`${SKILLS_DIR}/post-writer`);
  });

  it("rolls back staging dir on download failure", async () => {
    mockExistsSync.mockReturnValueOnce(false); // finalDir absent → install starts
    // Subsequent existsSync calls (for staging cleanup) return true so the
    // rollback rm() is invoked.
    mockExistsSync.mockReturnValue(true);

    // Contents lookup succeeds but the raw download fails.
    mockFetchMap({
      "/contents/skills/post-writer?": [
        {
          name: "SKILL.md",
          path: "skills/post-writer/SKILL.md",
          type: "file",
          download_url:
            "https://raw.githubusercontent.com/charlie947/social-media-skills/main/skills/post-writer/SKILL.md",
          sha: "deadbeef",
        },
      ],
    });
    // Override fetch to fail on the raw URL specifically.
    const baseFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("raw.githubusercontent.com")) {
        return { ok: false, status: 500 } as Response;
      }
      return baseFetch(input);
    }) as unknown as typeof globalThis.fetch;

    const res = await app.request("/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "charlie947-social-media-skills",
        slug: "post-writer",
      }),
    });

    expect(res.status).toBe(500);
    // Rollback must have been attempted on the staging dir
    expect(mockRm).toHaveBeenCalled();
    const rmCall = mockRm.mock.calls[0];
    expect(String(rmCall[0])).toContain(`${SKILLS_DIR}/.post-writer.installing-`);
    // Final directory must NOT have been renamed into place
    expect(mockRename).not.toHaveBeenCalled();
  });
});

// ─── GET /marketplace/installed/:slug ──────────────────────────────────────

describe("GET /marketplace/installed/:slug", () => {
  it("returns the meta file when the skill was installed via the marketplace", async () => {
    mockExistsSync.mockReturnValue(true);
    const meta = {
      sourceId: "charlie947-social-media-skills",
      slug: "post-writer",
      ghOwner: "charlie947",
      ghRepo: "social-media-skills",
      branch: "main",
      installedAt: "2026-04-30T10:00:00Z",
    };
    mockReadFile.mockResolvedValue(JSON.stringify(meta));

    const res = await app.request("/marketplace/installed/post-writer");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(meta);
  });

  it("returns null when the skill exists but has no meta (manually installed)", async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await app.request("/marketplace/installed/manual-skill");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toBeNull();
  });

  it("returns 400 for an invalid slug", async () => {
    const res = await app.request("/marketplace/installed/..%2Fetc");
    expect(res.status).toBe(400);
  });
});
