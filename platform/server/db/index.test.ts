import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * Tests for the database connection singleton.
 *
 * Uses vi.resetModules() + dynamic import for each test because getDb() is a
 * lazy singleton that reads DATABASE_URL at first call. Resetting modules
 * ensures each test starts with a fresh singleton.
 */

// Mock @neondatabase/serverless to avoid real HTTP calls.
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => vi.fn()),
}));

// Mock drizzle-orm/neon-http to return a fake db instance.
vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: vi.fn(() => ({ __drizzle: true })),
}));

async function freshImport() {
  vi.resetModules();
  return import("./index.js");
}

describe("getDb", () => {
  const savedUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  // Restore after all tests in this describe.
  afterAll(() => {
    if (savedUrl !== undefined) {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it("throws when DATABASE_URL is not set", async () => {
    const { getDb } = await freshImport();
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
  });

  it("returns a drizzle instance when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getDb } = await freshImport();
    const db = getDb();
    expect(db).toEqual({ __drizzle: true });
  });

  it("returns the same singleton on repeated calls", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getDb } = await freshImport();
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });
});
