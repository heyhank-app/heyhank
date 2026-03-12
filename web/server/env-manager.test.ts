import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let envManager: typeof import("./env-manager.js");

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
  tempDir = mkdtempSync(join(tmpdir(), "env-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  envManager = await import("./env-manager.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper to get the envs directory path used by the module
// ---------------------------------------------------------------------------
function envsDir(): string {
  return join(tempDir, ".companion", "envs");
}

// ===========================================================================
// Slugification (tested indirectly via createEnv)
// ===========================================================================
describe("slugification via createEnv", () => {
  it("converts spaces to hyphens and lowercases", async () => {
    const env = envManager.createEnv("My App");
    expect(env.slug).toBe("my-app");
  });

  it("strips special characters", async () => {
    const env = envManager.createEnv("Hello World! @#$%");
    expect(env.slug).toBe("hello-world");
  });

  it("collapses consecutive hyphens", async () => {
    const env = envManager.createEnv("a   ---  b");
    expect(env.slug).toBe("a-b");
  });

  it("trims leading and trailing hyphens", async () => {
    const env = envManager.createEnv(" -cool env- ");
    expect(env.slug).toBe("cool-env");
  });

  it("throws when name is empty string", () => {
    expect(() => envManager.createEnv("")).toThrow("Environment name is required");
  });

  it("throws when name is only whitespace", () => {
    expect(() => envManager.createEnv("   ")).toThrow("Environment name is required");
  });

  it("throws when name contains no alphanumeric characters", () => {
    expect(() => envManager.createEnv("@#$%^&")).toThrow(
      "Environment name must contain alphanumeric characters",
    );
  });
});

// ===========================================================================
// listEnvs
// ===========================================================================
describe("listEnvs", () => {
  it("returns empty array when no envs exist", () => {
    const result = envManager.listEnvs();
    expect(result).toEqual([]);
  });

  it("returns envs sorted alphabetically by name", () => {
    envManager.createEnv("Zebra");
    envManager.createEnv("Alpha");
    envManager.createEnv("Mango");

    const result = envManager.listEnvs();
    expect(result.map((e) => e.name)).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("skips corrupt JSON files", () => {
    // Create a valid env first
    envManager.createEnv("Valid");

    // Write a corrupt file directly into the envs directory
    writeFileSync(join(envsDir(), "corrupt.json"), "NOT VALID JSON{{{", "utf-8");

    const result = envManager.listEnvs();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Valid");
  });
});

// ===========================================================================
// getEnv
// ===========================================================================
describe("getEnv", () => {
  it("returns the env when it exists", () => {
    envManager.createEnv("My Service", { PORT: "3000" });

    const result = envManager.getEnv("my-service");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("My Service");
    expect(result!.slug).toBe("my-service");
    expect(result!.variables).toEqual({ PORT: "3000" });
  });

  it("returns null when the env does not exist", () => {
    const result = envManager.getEnv("nonexistent");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// createEnv
// ===========================================================================
describe("createEnv", () => {
  it("returns an env with correct structure and timestamps", () => {
    const before = Date.now();
    const env = envManager.createEnv("Production", { NODE_ENV: "production" });
    const after = Date.now();

    expect(env.name).toBe("Production");
    expect(env.slug).toBe("production");
    expect(env.variables).toEqual({ NODE_ENV: "production" });
    expect(env.createdAt).toBeGreaterThanOrEqual(before);
    expect(env.createdAt).toBeLessThanOrEqual(after);
    expect(env.updatedAt).toBe(env.createdAt);
  });

  it("persists the env to disk as JSON", () => {
    envManager.createEnv("Disk Check");

    const raw = readFileSync(join(envsDir(), "disk-check.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("Disk Check");
    expect(parsed.slug).toBe("disk-check");
  });

  it("defaults variables to empty object", () => {
    const env = envManager.createEnv("No Vars");
    expect(env.variables).toEqual({});
  });

  it("throws when creating a duplicate slug", () => {
    envManager.createEnv("My App");
    expect(() => envManager.createEnv("My App")).toThrow(
      'An environment with a similar name already exists ("my-app")',
    );
  });

  it("trims the name before saving", () => {
    const env = envManager.createEnv("  Spaced Out  ");
    expect(env.name).toBe("Spaced Out");
    expect(env.slug).toBe("spaced-out");
  });
});

// ===========================================================================
// updateEnv
// ===========================================================================
describe("updateEnv", () => {
  it("updates name and variables", () => {
    envManager.createEnv("Original", { KEY: "old" });

    const updated = envManager.updateEnv("original", {
      name: "Renamed",
      variables: { KEY: "new" },
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.slug).toBe("renamed");
    expect(updated!.variables).toEqual({ KEY: "new" });
  });

  it("renames the file on disk when slug changes", () => {
    envManager.createEnv("Old Name");

    envManager.updateEnv("old-name", { name: "New Name" });

    // Old file should be gone, new file should exist
    const oldPath = join(envsDir(), "old-name.json");
    const newPath = join(envsDir(), "new-name.json");

    expect(() => readFileSync(oldPath, "utf-8")).toThrow();
    const parsed = JSON.parse(readFileSync(newPath, "utf-8"));
    expect(parsed.name).toBe("New Name");
    expect(parsed.slug).toBe("new-name");
  });

  it("throws on slug collision during rename", () => {
    envManager.createEnv("Alpha");
    envManager.createEnv("Beta");

    expect(() => envManager.updateEnv("alpha", { name: "Beta" })).toThrow(
      'An environment with a similar name already exists ("beta")',
    );
  });

  it("returns null for a non-existent slug", () => {
    const result = envManager.updateEnv("ghost", { name: "New" });
    expect(result).toBeNull();
  });

  it("preserves createdAt and advances updatedAt", async () => {
    const env = envManager.createEnv("Timestamps");
    const originalCreatedAt = env.createdAt;

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    const updated = envManager.updateEnv("timestamps", { variables: { A: "1" } });

    expect(updated).not.toBeNull();
    expect(updated!.createdAt).toBe(originalCreatedAt);
    expect(updated!.updatedAt).toBeGreaterThan(originalCreatedAt);
  });

  it("keeps existing variables when only name is updated", () => {
    envManager.createEnv("Keep Vars", { SECRET: "abc" });

    const updated = envManager.updateEnv("keep-vars", { name: "Kept Vars" });
    expect(updated!.variables).toEqual({ SECRET: "abc" });
  });
});

// ===========================================================================
// getEffectiveImage
// ===========================================================================
describe("getEffectiveImage", () => {
  it("returns null when the env does not exist", () => {
    // Non-existent slug should return null without throwing
    const result = envManager.getEffectiveImage("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when env has neither imageTag nor baseImage", () => {
    // An env created without any docker options has no image fields
    envManager.createEnv("Plain Env");
    const result = envManager.getEffectiveImage("plain-env");
    expect(result).toBeNull();
  });

  it("returns baseImage when only baseImage is set", () => {
    // baseImage acts as the fallback when no custom image has been built
    envManager.createEnv("Base Only", {}, { baseImage: "ubuntu:22.04" });
    const result = envManager.getEffectiveImage("base-only");
    expect(result).toBe("ubuntu:22.04");
  });

  it("returns imageTag when only imageTag is set", () => {
    // imageTag is set after a successful docker build; here we simulate
    // that by creating an env then updating it with an imageTag
    envManager.createEnv("Tagged Only");
    envManager.updateEnv("tagged-only", { imageTag: "companion-env-tagged:latest" });

    const result = envManager.getEffectiveImage("tagged-only");
    expect(result).toBe("companion-env-tagged:latest");
  });

  it("returns imageTag over baseImage when both are set (imageTag takes priority)", () => {
    // The function documents priority: imageTag > baseImage > null.
    // When both are present, imageTag should win.
    envManager.createEnv("Both Images", {}, { baseImage: "ubuntu:22.04" });
    envManager.updateEnv("both-images", { imageTag: "companion-env-both:v2" });

    const result = envManager.getEffectiveImage("both-images");
    expect(result).toBe("companion-env-both:v2");
  });
});

// ===========================================================================
// updateBuildStatus
// ===========================================================================
describe("updateBuildStatus", () => {
  it("returns null for a non-existent slug", () => {
    // Should gracefully return null rather than throwing
    const result = envManager.updateBuildStatus("ghost", "building");
    expect(result).toBeNull();
  });

  it("sets buildStatus to 'building'", () => {
    envManager.createEnv("Build Test");
    const result = envManager.updateBuildStatus("build-test", "building");

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("building");
  });

  it("sets buildStatus to 'error' with an error message via opts", () => {
    // When a build fails, both status and error message should be recorded
    envManager.createEnv("Error Test");
    const result = envManager.updateBuildStatus("error-test", "error", {
      error: "Dockerfile syntax error on line 5",
    });

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("error");
    expect(result!.buildError).toBe("Dockerfile syntax error on line 5");
  });

  it("sets imageTag via opts when provided", () => {
    // After a build completes, the imageTag is stored so it can be used later
    envManager.createEnv("Tag Test");
    const result = envManager.updateBuildStatus("tag-test", "building", {
      imageTag: "companion-env-tag:latest",
    });

    expect(result).not.toBeNull();
    expect(result!.imageTag).toBe("companion-env-tag:latest");
  });

  it("clears buildError and sets lastBuiltAt on 'success' status", () => {
    // Simulate a failed build followed by a successful one.
    // The success status should clear the previous error and record the build timestamp.
    envManager.createEnv("Success Flow");
    envManager.updateBuildStatus("success-flow", "error", {
      error: "previous failure",
    });

    const before = Date.now();
    const result = envManager.updateBuildStatus("success-flow", "success");
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result!.buildStatus).toBe("success");
    expect(result!.buildError).toBeUndefined();
    expect(result!.lastBuiltAt).toBeGreaterThanOrEqual(before);
    expect(result!.lastBuiltAt).toBeLessThanOrEqual(after);
  });

  it("persists updated build status to disk", () => {
    // Verify that the status change is actually written to the JSON file on disk
    envManager.createEnv("Persist Check");
    envManager.updateBuildStatus("persist-check", "building");

    const raw = readFileSync(join(envsDir(), "persist-check.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.buildStatus).toBe("building");
  });

  it("advances updatedAt timestamp", async () => {
    envManager.createEnv("Timestamp Check");
    const original = envManager.getEnv("timestamp-check")!;
    const originalUpdatedAt = original.updatedAt;

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    const result = envManager.updateBuildStatus("timestamp-check", "building");
    expect(result).not.toBeNull();
    expect(result!.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });
});

// ===========================================================================
// createEnv with docker options
// ===========================================================================
describe("createEnv with docker options", () => {
  it("stores dockerfile content when provided", () => {
    const dockerfile = "FROM node:20\nRUN npm install";
    const env = envManager.createEnv("Docker App", {}, { dockerfile });

    expect(env.dockerfile).toBe(dockerfile);
  });

  it("stores baseImage when provided", () => {
    const env = envManager.createEnv("Based App", {}, { baseImage: "python:3.12" });

    expect(env.baseImage).toBe("python:3.12");
  });

  it("stores ports array when provided", () => {
    const env = envManager.createEnv("Port App", {}, { ports: [3000, 8080] });

    expect(env.ports).toEqual([3000, 8080]);
  });

  it("stores volumes array when provided", () => {
    const volumes = ["/host/data:/container/data:ro", "/tmp:/tmp"];
    const env = envManager.createEnv("Volume App", {}, { volumes });

    expect(env.volumes).toEqual(volumes);
  });

  it("stores initScript when provided", () => {
    const initScript = "#!/bin/bash\napt-get update && apt-get install -y curl";
    const env = envManager.createEnv("Init App", {}, { initScript });

    expect(env.initScript).toBe(initScript);
  });

  it("stores all docker options together", () => {
    // All docker options can be provided simultaneously
    const docker = {
      dockerfile: "FROM alpine\nRUN apk add git",
      baseImage: "alpine:latest",
      ports: [443, 8443],
      volumes: ["/data:/data"],
      initScript: "echo hello",
    };
    const env = envManager.createEnv("Full Docker", { API_KEY: "secret" }, docker);

    expect(env.name).toBe("Full Docker");
    expect(env.variables).toEqual({ API_KEY: "secret" });
    expect(env.dockerfile).toBe(docker.dockerfile);
    expect(env.baseImage).toBe(docker.baseImage);
    expect(env.ports).toEqual(docker.ports);
    expect(env.volumes).toEqual(docker.volumes);
    expect(env.initScript).toBe(docker.initScript);
  });

  it("persists docker options to disk as JSON", () => {
    envManager.createEnv("Disk Docker", {}, {
      dockerfile: "FROM busybox",
      ports: [9090],
    });

    const raw = readFileSync(join(envsDir(), "disk-docker.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.dockerfile).toBe("FROM busybox");
    expect(parsed.ports).toEqual([9090]);
  });

  it("does not set docker fields when docker param is omitted", () => {
    // Ensures that creating an env without the docker param leaves
    // all docker-related fields undefined
    const env = envManager.createEnv("No Docker");

    expect(env.dockerfile).toBeUndefined();
    expect(env.baseImage).toBeUndefined();
    expect(env.imageTag).toBeUndefined();
    expect(env.ports).toBeUndefined();
    expect(env.volumes).toBeUndefined();
    expect(env.initScript).toBeUndefined();
  });

  it("does not set docker fields when docker param is an empty object", () => {
    // An empty docker object should not create any docker fields
    const env = envManager.createEnv("Empty Docker", {}, {});

    expect(env.dockerfile).toBeUndefined();
    expect(env.baseImage).toBeUndefined();
    expect(env.ports).toBeUndefined();
    expect(env.volumes).toBeUndefined();
    expect(env.initScript).toBeUndefined();
  });
});

// ===========================================================================
// deleteEnv
// ===========================================================================
describe("deleteEnv", () => {
  it("deletes an existing env and returns true", () => {
    envManager.createEnv("To Delete");
    const result = envManager.deleteEnv("to-delete");
    expect(result).toBe(true);

    // Confirm it is gone
    expect(envManager.getEnv("to-delete")).toBeNull();
  });

  it("returns false when the env does not exist", () => {
    const result = envManager.deleteEnv("missing");
    expect(result).toBe(false);
  });
});
