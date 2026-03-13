import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let sandboxManager: typeof import("./sandbox-manager.js");

// Redirect homedir() to a temporary directory so the module writes to an
// isolated location instead of the real ~/.companion/sandboxes/.
const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => {
      dir = d;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "sandbox-test-"));
  mockHomedir.set(tempDir);
  // Reset the module so module-level constants (SANDBOXES_DIR) pick up
  // the new homedir value.
  vi.resetModules();
  sandboxManager = await import("./sandbox-manager.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper to get the sandboxes directory path used by the module
// ---------------------------------------------------------------------------
function sandboxesDir(): string {
  return join(tempDir, ".companion", "sandboxes");
}

// ===========================================================================
// Slugification (tested indirectly via createSandbox)
// ===========================================================================
describe("slugification via createSandbox", () => {
  it("converts spaces to hyphens and lowercases", () => {
    // Validates that human-readable names are transformed into URL-safe slugs
    const sandbox = sandboxManager.createSandbox("My Project");
    expect(sandbox.slug).toBe("my-project");
  });

  it("strips special characters", () => {
    // Non-alphanumeric characters (except hyphens) should be removed
    const sandbox = sandboxManager.createSandbox("Hello World! @#$%");
    expect(sandbox.slug).toBe("hello-world");
  });

  it("collapses consecutive hyphens", () => {
    // Multiple spaces or hyphens in a row should become a single hyphen
    const sandbox = sandboxManager.createSandbox("a   ---  b");
    expect(sandbox.slug).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    // Slugs should not start or end with a hyphen
    const sandbox = sandboxManager.createSandbox(" -cool sandbox- ");
    expect(sandbox.slug).toBe("cool-sandbox");
  });

  it("throws when name is empty string", () => {
    // An empty name is not a valid sandbox identifier
    expect(() => sandboxManager.createSandbox("")).toThrow(
      "Sandbox name is required",
    );
  });

  it("throws when name is only whitespace", () => {
    // Whitespace-only names should be rejected just like empty strings
    expect(() => sandboxManager.createSandbox("   ")).toThrow(
      "Sandbox name is required",
    );
  });

  it("throws when name contains no alphanumeric characters", () => {
    // Names like "@#$" produce an empty slug which is invalid
    expect(() => sandboxManager.createSandbox("@#$%^&")).toThrow(
      "Sandbox name must contain alphanumeric characters",
    );
  });
});

// ===========================================================================
// listSandboxes
// ===========================================================================
describe("listSandboxes", () => {
  it("returns empty array when no sandboxes exist", () => {
    // A fresh installation should have no sandboxes
    const result = sandboxManager.listSandboxes();
    expect(result).toEqual([]);
  });

  it("returns sandboxes sorted alphabetically by name", () => {
    // Ensures deterministic ordering regardless of creation order
    sandboxManager.createSandbox("Zebra");
    sandboxManager.createSandbox("Alpha");
    sandboxManager.createSandbox("Mango");

    const result = sandboxManager.listSandboxes();
    expect(result.map((s) => s.name)).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("skips corrupt JSON files gracefully", () => {
    // The module should be resilient to manually-edited or corrupted files
    sandboxManager.createSandbox("Valid");

    // Write a corrupt file directly into the sandboxes directory
    writeFileSync(
      join(sandboxesDir(), "corrupt.json"),
      "NOT VALID JSON{{{",
      "utf-8",
    );

    const result = sandboxManager.listSandboxes();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Valid");
  });

  it("ignores non-JSON files in the sandboxes directory", () => {
    // Only .json files should be loaded; other files (e.g. .bak) are ignored
    sandboxManager.createSandbox("Real");

    writeFileSync(
      join(sandboxesDir(), "notes.txt"),
      "some random notes",
      "utf-8",
    );

    const result = sandboxManager.listSandboxes();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Real");
  });
});

// ===========================================================================
// getSandbox
// ===========================================================================
describe("getSandbox", () => {
  it("returns the sandbox when it exists", () => {
    // Validates round-trip: create then retrieve by slug
    sandboxManager.createSandbox("My Service", {
      dockerfile: "FROM node:20",
    });

    const result = sandboxManager.getSandbox("my-service");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("My Service");
    expect(result!.slug).toBe("my-service");
    expect(result!.dockerfile).toBe("FROM node:20");
  });

  it("returns null when the sandbox does not exist", () => {
    // Querying a non-existent slug should return null, not throw
    const result = sandboxManager.getSandbox("nonexistent");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// createSandbox
// ===========================================================================
describe("createSandbox", () => {
  it("returns a sandbox with correct structure and timestamps", () => {
    // Validates the shape of the returned object and that timestamps
    // fall within the expected range
    const before = Date.now();
    const sandbox = sandboxManager.createSandbox("Production", {
      dockerfile: "FROM ubuntu:22.04",
      initScript: "apt-get update",
    });
    const after = Date.now();

    expect(sandbox.name).toBe("Production");
    expect(sandbox.slug).toBe("production");
    expect(sandbox.dockerfile).toBe("FROM ubuntu:22.04");
    expect(sandbox.initScript).toBe("apt-get update");
    expect(sandbox.createdAt).toBeGreaterThanOrEqual(before);
    expect(sandbox.createdAt).toBeLessThanOrEqual(after);
    expect(sandbox.updatedAt).toBe(sandbox.createdAt);
  });

  it("persists the sandbox to disk as JSON", () => {
    // The file must be readable and parseable outside the module
    sandboxManager.createSandbox("Disk Check");

    const raw = readFileSync(
      join(sandboxesDir(), "disk-check.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("Disk Check");
    expect(parsed.slug).toBe("disk-check");
  });

  it("omits dockerfile and initScript when not provided", () => {
    // Optional fields should not be present if not supplied
    const sandbox = sandboxManager.createSandbox("Bare");
    expect(sandbox.dockerfile).toBeUndefined();
    expect(sandbox.initScript).toBeUndefined();
  });

  it("includes dockerfile when provided", () => {
    const sandbox = sandboxManager.createSandbox("With Docker", {
      dockerfile: "FROM alpine",
    });
    expect(sandbox.dockerfile).toBe("FROM alpine");
    expect(sandbox.initScript).toBeUndefined();
  });

  it("includes initScript when provided", () => {
    const sandbox = sandboxManager.createSandbox("With Init", {
      initScript: "echo hello",
    });
    expect(sandbox.initScript).toBe("echo hello");
    expect(sandbox.dockerfile).toBeUndefined();
  });

  it("throws when creating a duplicate slug", () => {
    // Duplicate detection prevents accidental overwrites
    sandboxManager.createSandbox("My App");
    expect(() => sandboxManager.createSandbox("My App")).toThrow(
      'A sandbox with a similar name already exists ("my-app")',
    );
  });

  it("detects duplicates even with different casing or spacing", () => {
    // "My App" and "my app" both slugify to "my-app"
    sandboxManager.createSandbox("My App");
    expect(() => sandboxManager.createSandbox("my app")).toThrow(
      'A sandbox with a similar name already exists ("my-app")',
    );
  });

  it("trims the name before saving", () => {
    // Leading/trailing whitespace in the name should be stripped
    const sandbox = sandboxManager.createSandbox("  Spaced Out  ");
    expect(sandbox.name).toBe("Spaced Out");
    expect(sandbox.slug).toBe("spaced-out");
  });
});

// ===========================================================================
// updateSandbox
// ===========================================================================
describe("updateSandbox", () => {
  it("updates name and renames slug accordingly", () => {
    // When the name changes, the slug and on-disk filename should update too
    sandboxManager.createSandbox("Original");

    const updated = sandboxManager.updateSandbox("original", {
      name: "Renamed",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.slug).toBe("renamed");
  });

  it("updates dockerfile and initScript fields", () => {
    sandboxManager.createSandbox("Configurable");

    const updated = sandboxManager.updateSandbox("configurable", {
      dockerfile: "FROM python:3.12",
      initScript: "pip install flask",
    });

    expect(updated).not.toBeNull();
    expect(updated!.dockerfile).toBe("FROM python:3.12");
    expect(updated!.initScript).toBe("pip install flask");
  });

  it("updates imageTag field", () => {
    sandboxManager.createSandbox("Tagged");

    const updated = sandboxManager.updateSandbox("tagged", {
      imageTag: "companion-sandbox-tagged:v2",
    });

    expect(updated).not.toBeNull();
    expect(updated!.imageTag).toBe("companion-sandbox-tagged:v2");
  });

  it("renames the file on disk when slug changes", () => {
    // The old file should be removed and a new one created
    sandboxManager.createSandbox("Old Name");

    sandboxManager.updateSandbox("old-name", { name: "New Name" });

    const oldPath = join(sandboxesDir(), "old-name.json");
    const newPath = join(sandboxesDir(), "new-name.json");

    expect(() => readFileSync(oldPath, "utf-8")).toThrow();
    const parsed = JSON.parse(readFileSync(newPath, "utf-8"));
    expect(parsed.name).toBe("New Name");
    expect(parsed.slug).toBe("new-name");
  });

  it("throws on slug collision during rename", () => {
    // Renaming to a name that would collide with another sandbox is not allowed
    sandboxManager.createSandbox("Alpha");
    sandboxManager.createSandbox("Beta");

    expect(() =>
      sandboxManager.updateSandbox("alpha", { name: "Beta" }),
    ).toThrow('A sandbox with a similar name already exists ("beta")');
  });

  it("returns null for a non-existent slug", () => {
    // Updating a sandbox that does not exist should return null
    const result = sandboxManager.updateSandbox("ghost", { name: "New" });
    expect(result).toBeNull();
  });

  it("preserves createdAt and advances updatedAt", async () => {
    // createdAt should be immutable; updatedAt should reflect the latest change
    const sandbox = sandboxManager.createSandbox("Timestamps");
    const originalCreatedAt = sandbox.createdAt;

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    const updated = sandboxManager.updateSandbox("timestamps", {
      dockerfile: "FROM node:22",
    });

    expect(updated).not.toBeNull();
    expect(updated!.createdAt).toBe(originalCreatedAt);
    expect(updated!.updatedAt).toBeGreaterThan(originalCreatedAt);
  });

  it("keeps existing fields when only a subset is updated", () => {
    // Fields not included in the update payload should remain unchanged
    sandboxManager.createSandbox("Partial", {
      dockerfile: "FROM alpine",
      initScript: "echo setup",
    });

    const updated = sandboxManager.updateSandbox("partial", {
      name: "Partial Updated",
    });

    expect(updated!.dockerfile).toBe("FROM alpine");
    expect(updated!.initScript).toBe("echo setup");
  });

  it("allows same-slug update without collision error", () => {
    // Updating a sandbox without changing the name should not trigger
    // the duplicate slug check
    sandboxManager.createSandbox("Stable");

    const updated = sandboxManager.updateSandbox("stable", {
      dockerfile: "FROM debian:12",
    });

    expect(updated).not.toBeNull();
    expect(updated!.slug).toBe("stable");
    expect(updated!.dockerfile).toBe("FROM debian:12");
  });
});

// ===========================================================================
// deleteSandbox
// ===========================================================================
describe("deleteSandbox", () => {
  it("deletes an existing sandbox and returns true", () => {
    sandboxManager.createSandbox("To Delete");
    const result = sandboxManager.deleteSandbox("to-delete");
    expect(result).toBe(true);

    // Confirm it is gone
    expect(sandboxManager.getSandbox("to-delete")).toBeNull();
  });

  it("returns false when the sandbox does not exist", () => {
    // Deleting a non-existent sandbox should be a no-op that returns false
    const result = sandboxManager.deleteSandbox("missing");
    expect(result).toBe(false);
  });

  it("does not affect other sandboxes", () => {
    // Deleting one sandbox should leave others intact
    sandboxManager.createSandbox("Keep");
    sandboxManager.createSandbox("Remove");

    sandboxManager.deleteSandbox("remove");

    expect(sandboxManager.getSandbox("keep")).not.toBeNull();
    expect(sandboxManager.listSandboxes()).toHaveLength(1);
  });
});

// ===========================================================================
// getEffectiveImage
// ===========================================================================
describe("getEffectiveImage", () => {
  it("returns the imageTag when one has been set", () => {
    // When a custom image has been built, getEffectiveImage should return it
    sandboxManager.createSandbox("Custom");
    sandboxManager.updateSandbox("custom", {
      imageTag: "companion-sandbox-custom:latest",
    });

    const image = sandboxManager.getEffectiveImage("custom");
    expect(image).toBe("companion-sandbox-custom:latest");
  });

  it('returns "the-companion:latest" when no imageTag is set', () => {
    // Sandboxes without a custom build should fall back to the default image
    sandboxManager.createSandbox("Default");

    const image = sandboxManager.getEffectiveImage("default");
    expect(image).toBe("the-companion:latest");
  });

  it('returns "the-companion:latest" for a non-existent sandbox', () => {
    // Even if the sandbox does not exist, we should get the default image
    const image = sandboxManager.getEffectiveImage("does-not-exist");
    expect(image).toBe("the-companion:latest");
  });

  it('returns "the-companion:latest" when imageTag is an empty string', () => {
    // An empty string imageTag should be treated as "not set"
    sandboxManager.createSandbox("EmptyTag");
    sandboxManager.updateSandbox("emptytag", { imageTag: "" });

    const image = sandboxManager.getEffectiveImage("emptytag");
    expect(image).toBe("the-companion:latest");
  });
});

// ===========================================================================
// updateBuildStatus
// ===========================================================================
describe("updateBuildStatus", () => {
  it("sets buildStatus to 'building'", () => {
    // Transition to the building state at the start of a Docker build
    sandboxManager.createSandbox("Builder");

    const result = sandboxManager.updateBuildStatus("builder", "building");

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("building");
  });

  it("sets buildStatus to 'success' and records lastBuiltAt", () => {
    // On successful build, lastBuiltAt should be set and any previous
    // buildError should be cleared
    sandboxManager.createSandbox("Success");

    const before = Date.now();
    const result = sandboxManager.updateBuildStatus("success", "success");
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("success");
    expect(result!.lastBuiltAt).toBeGreaterThanOrEqual(before);
    expect(result!.lastBuiltAt).toBeLessThanOrEqual(after);
    expect(result!.buildError).toBeUndefined();
  });

  it("clears buildError when status transitions to 'success'", () => {
    // If a previous build failed, a successful build should clear the error
    sandboxManager.createSandbox("Recovery");

    // Simulate a failed build first
    sandboxManager.updateBuildStatus("recovery", "error", {
      error: "Build failed: OOM",
    });

    // Now succeed
    const result = sandboxManager.updateBuildStatus("recovery", "success");
    expect(result!.buildError).toBeUndefined();
    expect(result!.buildStatus).toBe("success");
  });

  it("sets buildStatus to 'error' with an error message", () => {
    // Build failures should store the error message for display in the UI
    sandboxManager.createSandbox("Failure");

    const result = sandboxManager.updateBuildStatus("failure", "error", {
      error: "Dockerfile syntax error on line 5",
    });

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("error");
    expect(result!.buildError).toBe("Dockerfile syntax error on line 5");
  });

  it("stores imageTag when provided alongside status update", () => {
    // The imageTag can be set at the same time as the status (e.g. after
    // a successful docker build that tags the image)
    sandboxManager.createSandbox("Tagged Build");

    const result = sandboxManager.updateBuildStatus(
      "tagged-build",
      "success",
      { imageTag: "companion-sandbox-tagged-build:abc123" },
    );

    expect(result).not.toBeNull();
    expect(result!.imageTag).toBe("companion-sandbox-tagged-build:abc123");
    expect(result!.buildStatus).toBe("success");
  });

  it("returns null for a non-existent sandbox", () => {
    // Updating build status of a non-existent sandbox should return null
    const result = sandboxManager.updateBuildStatus("ghost", "building");
    expect(result).toBeNull();
  });

  it("advances updatedAt on each status change", async () => {
    // Each status update should bump the updatedAt timestamp
    sandboxManager.createSandbox("Timestamp Check");
    const original = sandboxManager.getSandbox("timestamp-check")!;

    await new Promise((r) => setTimeout(r, 10));

    const updated = sandboxManager.updateBuildStatus(
      "timestamp-check",
      "building",
    );

    expect(updated).not.toBeNull();
    expect(updated!.updatedAt).toBeGreaterThan(original.updatedAt);
  });

  it("persists status changes to disk", () => {
    // Build status must survive a re-read from disk (no in-memory-only state)
    sandboxManager.createSandbox("Persist Status");
    sandboxManager.updateBuildStatus("persist-status", "building");

    const raw = readFileSync(
      join(sandboxesDir(), "persist-status.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.buildStatus).toBe("building");
  });

  it("transitions through idle -> building -> success lifecycle", () => {
    // Full lifecycle test: idle (default) -> building -> success
    const sandbox = sandboxManager.createSandbox("Lifecycle");
    expect(sandbox.buildStatus).toBeUndefined(); // default is undefined (idle)

    sandboxManager.updateBuildStatus("lifecycle", "building");
    const building = sandboxManager.getSandbox("lifecycle")!;
    expect(building.buildStatus).toBe("building");

    sandboxManager.updateBuildStatus("lifecycle", "success", {
      imageTag: "companion-sandbox-lifecycle:v1",
    });
    const success = sandboxManager.getSandbox("lifecycle")!;
    expect(success.buildStatus).toBe("success");
    expect(success.imageTag).toBe("companion-sandbox-lifecycle:v1");
    expect(success.lastBuiltAt).toBeDefined();
  });

  it("transitions through idle -> building -> error lifecycle", () => {
    // Full lifecycle test: idle (default) -> building -> error
    sandboxManager.createSandbox("Error Lifecycle");

    sandboxManager.updateBuildStatus("error-lifecycle", "building");
    sandboxManager.updateBuildStatus("error-lifecycle", "error", {
      error: "Step 3/5: COPY failed",
    });

    const errored = sandboxManager.getSandbox("error-lifecycle")!;
    expect(errored.buildStatus).toBe("error");
    expect(errored.buildError).toBe("Step 3/5: COPY failed");
    expect(errored.lastBuiltAt).toBeUndefined();
  });
});
