import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock sandbox-manager ─────────────────────────────────────────────────
vi.mock("../sandbox-manager.js", () => ({
  listSandboxes: vi.fn(() => []),
  getSandbox: vi.fn(() => null),
  createSandbox: vi.fn(),
  updateSandbox: vi.fn(),
  deleteSandbox: vi.fn(() => false),
  updateBuildStatus: vi.fn(),
}));

// ─── Mock container-manager ───────────────────────────────────────────────
vi.mock("../container-manager.js", () => ({
  containerManager: {
    checkDocker: vi.fn(() => true),
    buildImageStreaming: vi.fn(async () => ({ success: true, log: "Built" })),
  },
}));

import { Hono } from "hono";
import * as sandboxManager from "../sandbox-manager.js";
import { containerManager } from "../container-manager.js";
import { registerSandboxRoutes } from "./sandbox-routes.js";

// ─── Test setup ───────────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();

  app = new Hono().basePath("/api");
  registerSandboxRoutes(app);
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Minimal sandbox fixture matching the CompanionSandbox shape. */
function makeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    name: "My Sandbox",
    slug: "my-sandbox",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sandboxes
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/sandboxes", () => {
  it("returns an empty list when no sandboxes exist", async () => {
    // Validates that the endpoint returns 200 with an empty array
    // when there are no sandboxes on disk.
    vi.mocked(sandboxManager.listSandboxes).mockReturnValue([]);

    const res = await app.request("/api/sandboxes");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns a list of sandboxes", async () => {
    // Validates that multiple sandboxes are returned correctly.
    const sandboxes = [
      makeSandbox(),
      makeSandbox({ slug: "second", name: "Second" }),
    ];
    vi.mocked(sandboxManager.listSandboxes).mockReturnValue(sandboxes as any);

    const res = await app.request("/api/sandboxes");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].slug).toBe("my-sandbox");
    expect(json[1].slug).toBe("second");
  });

  it("returns 500 when listSandboxes throws", async () => {
    // Validates that internal errors in sandbox-manager are surfaced
    // as 500 responses with the error message in the body.
    vi.mocked(sandboxManager.listSandboxes).mockImplementation(() => {
      throw new Error("disk failure");
    });

    const res = await app.request("/api/sandboxes");

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("disk failure");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sandboxes/:slug
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/sandboxes/:slug", () => {
  it("returns the sandbox when it exists", async () => {
    // Validates that a single sandbox is returned by slug and that
    // getSandbox is called with the correct slug parameter.
    const sandbox = makeSandbox();
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);

    const res = await app.request("/api/sandboxes/my-sandbox");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sandbox);
    expect(sandboxManager.getSandbox).toHaveBeenCalledWith("my-sandbox");
  });

  it("returns 404 when the sandbox does not exist", async () => {
    // Validates that requesting a non-existent slug returns 404
    // with an appropriate error message.
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(null);

    const res = await app.request("/api/sandboxes/missing");

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sandboxes
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/sandboxes", () => {
  it("creates a sandbox with name, dockerfile, and initScript and returns 201", async () => {
    // Validates that a new sandbox is created with all optional fields
    // and that the response status is 201 (Created).
    const created = makeSandbox({
      dockerfile: "FROM node:20",
      initScript: "npm install",
    });
    vi.mocked(sandboxManager.createSandbox).mockReturnValue(created as any);

    const res = await app.request("/api/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My Sandbox",
        dockerfile: "FROM node:20",
        initScript: "npm install",
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    // Verify createSandbox was called with name and options object
    expect(sandboxManager.createSandbox).toHaveBeenCalledWith("My Sandbox", {
      dockerfile: "FROM node:20",
      initScript: "npm install",
    });
  });

  it("returns 400 when createSandbox throws a validation error", async () => {
    // Validates that errors thrown by createSandbox (e.g. duplicate slug)
    // are surfaced as 400 responses with the error message.
    vi.mocked(sandboxManager.createSandbox).mockImplementation(() => {
      throw new Error('A sandbox with a similar name already exists ("my-sandbox")');
    });

    const res = await app.request("/api/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Sandbox" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already exists/i);
  });

  it("returns 400 when name is missing", async () => {
    // Validates that omitting the required "name" field causes a 400 error.
    // The sandbox-manager throws "Sandbox name is required" for empty names.
    vi.mocked(sandboxManager.createSandbox).mockImplementation(() => {
      throw new Error("Sandbox name is required");
    });

    const res = await app.request("/api/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Sandbox name is required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/sandboxes/:slug
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /api/sandboxes/:slug", () => {
  it("updates an existing sandbox", async () => {
    // Validates that an existing sandbox can be updated with new fields
    // and that updateSandbox is called with the correct slug and update payload.
    const updated = makeSandbox({ name: "Updated Name" });
    vi.mocked(sandboxManager.updateSandbox).mockReturnValue(updated as any);

    const res = await app.request("/api/sandboxes/my-sandbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name", dockerfile: "FROM ubuntu" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(sandboxManager.updateSandbox).toHaveBeenCalledWith(
      "my-sandbox",
      expect.objectContaining({ name: "Updated Name", dockerfile: "FROM ubuntu" }),
    );
  });

  it("returns 404 when the sandbox does not exist", async () => {
    // Validates that updating a non-existent sandbox returns 404.
    // updateSandbox returns null when the slug is not found.
    vi.mocked(sandboxManager.updateSandbox).mockReturnValue(null);

    const res = await app.request("/api/sandboxes/missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when updateSandbox throws a slug collision error", async () => {
    // Validates that renaming a sandbox to a name that collides with
    // an existing slug results in a 400 error.
    vi.mocked(sandboxManager.updateSandbox).mockImplementation(() => {
      throw new Error('A sandbox with a similar name already exists ("other-sandbox")');
    });

    const res = await app.request("/api/sandboxes/my-sandbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Other Sandbox" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already exists/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/sandboxes/:slug
// ═══════════════════════════════════════════════════════════════════════════

describe("DELETE /api/sandboxes/:slug", () => {
  it("deletes a sandbox and returns ok", async () => {
    // Validates successful deletion returns { ok: true } and that
    // deleteSandbox is called with the correct slug.
    vi.mocked(sandboxManager.deleteSandbox).mockReturnValue(true);

    const res = await app.request("/api/sandboxes/my-sandbox", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sandboxManager.deleteSandbox).toHaveBeenCalledWith("my-sandbox");
  });

  it("returns 404 when the sandbox does not exist", async () => {
    // Validates that deleting a non-existent sandbox returns 404.
    vi.mocked(sandboxManager.deleteSandbox).mockReturnValue(false);

    const res = await app.request("/api/sandboxes/missing", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sandboxes/:slug/build
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/sandboxes/:slug/build", () => {
  it("builds the image successfully and returns the tag", async () => {
    // Validates the happy path: sandbox exists, has a dockerfile,
    // Docker is available, and buildImageStreaming succeeds.
    // Should set build status to "building" then "success".
    const sandbox = makeSandbox({ dockerfile: "FROM node:20" });
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);
    vi.mocked(containerManager.checkDocker).mockReturnValue(true);
    vi.mocked(containerManager.buildImageStreaming).mockResolvedValue({
      success: true,
      log: "Step 1/1 : FROM node:20\nSuccessfully built abc123",
    });

    const res = await app.request("/api/sandboxes/my-sandbox/build", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.imageTag).toBe("companion-sandbox-my-sandbox:latest");
    expect(json.log).toContain("Successfully built");

    // Verify build status was updated to "building" first
    expect(sandboxManager.updateBuildStatus).toHaveBeenCalledWith(
      "my-sandbox",
      "building",
    );
    // Verify build status was updated to "success" with the imageTag
    expect(sandboxManager.updateBuildStatus).toHaveBeenCalledWith(
      "my-sandbox",
      "success",
      { imageTag: "companion-sandbox-my-sandbox:latest" },
    );
  });

  it("returns 404 when the sandbox is not found", async () => {
    // Validates that trying to build a non-existent sandbox returns 404.
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(null);

    const res = await app.request("/api/sandboxes/missing/build", {
      method: "POST",
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when the sandbox has no dockerfile", async () => {
    // Validates that building a sandbox without a dockerfile configured
    // returns 400 with an appropriate error message.
    const sandbox = makeSandbox(); // no dockerfile field
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);

    const res = await app.request("/api/sandboxes/my-sandbox/build", {
      method: "POST",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no dockerfile/i);
  });

  it("returns 503 when Docker is not available", async () => {
    // Validates that the endpoint checks Docker availability and returns
    // 503 when Docker cannot be reached.
    const sandbox = makeSandbox({ dockerfile: "FROM node:20" });
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);
    vi.mocked(containerManager.checkDocker).mockReturnValue(false);

    const res = await app.request("/api/sandboxes/my-sandbox/build", {
      method: "POST",
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/docker/i);
  });

  it("returns 500 when the build fails (result.success is false)", async () => {
    // Validates that a build that completes but fails (success: false)
    // returns 500 with the build log and updates build status to "error".
    const sandbox = makeSandbox({ dockerfile: "FROM node:20" });
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);
    vi.mocked(containerManager.checkDocker).mockReturnValue(true);
    vi.mocked(containerManager.buildImageStreaming).mockResolvedValue({
      success: false,
      log: "Step 1/2 : FROM node:20\nERROR: failed to solve",
    });

    const res = await app.request("/api/sandboxes/my-sandbox/build", {
      method: "POST",
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.log).toContain("ERROR");

    // Verify build status was updated to "error" with the truncated log
    expect(sandboxManager.updateBuildStatus).toHaveBeenCalledWith(
      "my-sandbox",
      "error",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("returns 500 when buildImageStreaming throws an exception", async () => {
    // Validates that unexpected exceptions during the build process
    // are caught, and build status is updated to "error" with the
    // error message.
    const sandbox = makeSandbox({ dockerfile: "FROM node:20" });
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);
    vi.mocked(containerManager.checkDocker).mockReturnValue(true);
    vi.mocked(containerManager.buildImageStreaming).mockRejectedValue(
      new Error("Docker daemon crashed"),
    );

    const res = await app.request("/api/sandboxes/my-sandbox/build", {
      method: "POST",
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Docker daemon crashed");

    // Verify build status was updated to "error"
    expect(sandboxManager.updateBuildStatus).toHaveBeenCalledWith(
      "my-sandbox",
      "error",
      { error: "Docker daemon crashed" },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sandboxes/:slug/build-status
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/sandboxes/:slug/build-status", () => {
  it("returns build status fields for an existing sandbox", async () => {
    // Validates that the build-status endpoint returns the correct
    // build-related fields from the sandbox object.
    const sandbox = makeSandbox({
      buildStatus: "success",
      buildError: undefined,
      lastBuiltAt: 3000,
      imageTag: "companion-sandbox-my-sandbox:latest",
    });
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);

    const res = await app.request("/api/sandboxes/my-sandbox/build-status");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.buildStatus).toBe("success");
    expect(json.lastBuiltAt).toBe(3000);
    expect(json.imageTag).toBe("companion-sandbox-my-sandbox:latest");
  });

  it("defaults buildStatus to 'idle' when not set on the sandbox", async () => {
    // Validates that sandboxes without an explicit buildStatus field
    // return "idle" as the default status.
    const sandbox = makeSandbox(); // no buildStatus field
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(sandbox as any);

    const res = await app.request("/api/sandboxes/my-sandbox/build-status");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.buildStatus).toBe("idle");
  });

  it("returns 404 when the sandbox is not found", async () => {
    // Validates that checking build status for a non-existent sandbox
    // returns 404.
    vi.mocked(sandboxManager.getSandbox).mockReturnValue(null);

    const res = await app.request("/api/sandboxes/missing/build-status");

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});
