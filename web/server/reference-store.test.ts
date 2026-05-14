import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-refs-"));
  process.env.HEYHANK_HOME = tempHome;
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

/**
 * Reimport the store each test so the module-level REFERENCES_DIR picks up the
 * fresh HEYHANK_HOME from the env. vitest caches modules per test file but
 * within a single test we get a fresh evaluation when we use dynamic import
 * combined with vi.resetModules in beforeEach.
 */
import { vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  return await import("./reference-store.js");
}

describe("reference-store", () => {
  it("creates default categories on first listReferences()", async () => {
    const store = await loadStore();
    const cats = store.listReferences();
    const names = cats.map((c) => c.name);
    // Defaults should be ensured + present in listing
    expect(names).toEqual(expect.arrayContaining(["person", "logos", "products", "style"]));
    for (const cat of cats) {
      expect(cat.count).toBe(0);
      expect(cat.files).toEqual([]);
    }
  });

  it("rejects category names with path traversal or invalid characters", async () => {
    const store = await loadStore();
    expect(() => store.validateCategoryName("../etc")).toThrow();
    expect(() => store.validateCategoryName("foo/bar")).toThrow();
    expect(() => store.validateCategoryName("")).toThrow();
    expect(() => store.validateCategoryName("a".repeat(100))).toThrow();
    // Valid names pass
    expect(() => store.validateCategoryName("my-cat_1")).not.toThrow();
  });

  it("createCategory creates the dir and returns true once", async () => {
    const store = await loadStore();
    expect(store.createCategory("brand")).toBe(true);
    // Idempotent: second call returns false
    expect(store.createCategory("brand")).toBe(false);
    expect(existsSync(join(tempHome, "reference-images", "brand"))).toBe(true);
  });

  it("saveReference writes a file with a generated name and correct ext", async () => {
    const store = await loadStore();
    const saved = store.saveReference("logos", "company-logo.png", Buffer.from([1, 2, 3]));
    expect(saved.filename).toMatch(/^ref_\d+_[a-z0-9]+\.png$/);
    expect(saved.size).toBe(3);
    expect(saved.url).toContain("/api/references/file/logos/");
    expect(existsSync(saved.path)).toBe(true);
  });

  it("saveReference rejects unsupported extensions", async () => {
    const store = await loadStore();
    expect(() => store.saveReference("logos", "evil.exe", Buffer.from([0]))).toThrow(/extension/i);
  });

  it("deleteReference removes the file and is idempotent", async () => {
    const store = await loadStore();
    const saved = store.saveReference("logos", "x.png", Buffer.from([1]));
    expect(store.deleteReference("logos", saved.filename)).toBe(true);
    expect(existsSync(saved.path)).toBe(false);
    // Second call returns false (already gone)
    expect(store.deleteReference("logos", saved.filename)).toBe(false);
  });

  it("deleteCategory refuses non-empty categories", async () => {
    const store = await loadStore();
    store.createCategory("brand");
    store.saveReference("brand", "x.png", Buffer.from([1]));
    expect(() => store.deleteCategory("brand")).toThrow(/not empty/i);
    // After clearing, deletion succeeds
    const saved = store.listReferences().find((c) => c.name === "brand")!.files[0];
    store.deleteReference("brand", saved.filename);
    expect(store.deleteCategory("brand")).toBe(true);
    expect(existsSync(join(tempHome, "reference-images", "brand"))).toBe(false);
  });

  it("listReferences ignores non-image files and sorts newest first", async () => {
    const store = await loadStore();
    store.createCategory("mixed");
    const dir = join(tempHome, "reference-images", "mixed");
    // Write an unsupported file directly — should be filtered out
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const a = store.saveReference("mixed", "a.png", Buffer.from([1]));
    // Force different mtime so ordering is deterministic
    await new Promise((r) => setTimeout(r, 5));
    const b = store.saveReference("mixed", "b.jpg", Buffer.from([2]));

    const cat = store.listReferences().find((c) => c.name === "mixed")!;
    expect(cat.count).toBe(2);
    expect(cat.files[0].filename).toBe(b.filename);
    expect(cat.files[1].filename).toBe(a.filename);
    expect(readdirSync(dir)).toContain("notes.txt"); // file still on disk, just hidden from API
  });

  it("getReferencePath returns null for invalid category or missing file", async () => {
    const store = await loadStore();
    expect(store.getReferencePath("../etc", "passwd")).toBeNull();
    expect(store.getReferencePath("logos", "does-not-exist.png")).toBeNull();
  });
});
