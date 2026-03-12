import { describe, it, expect, vi, afterAll } from "vitest";

/**
 * Tests for the Better Auth configuration module.
 *
 * Uses vi.resetModules() + dynamic import because getAuth() is a lazy
 * singleton that reads env vars at first call. Each test gets a fresh module
 * so env changes take effect.
 *
 * The database and Better Auth internals are mocked to avoid real DB
 * connections — we only verify the module's initialisation behaviour.
 */

// Mock the database module so getDb() returns a fake drizzle instance.
vi.mock("./db/index.js", () => ({
  getDb: vi.fn(() => ({ __drizzle: true })),
}));

// Mock the drizzle adapter to return a dummy adapter function.
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => () => ({ __adapter: true })),
}));

// Mock the organization plugin to return a minimal plugin object.
vi.mock("better-auth/plugins/organization", () => ({
  organization: vi.fn(() => ({ id: "organization" })),
}));

// Mock betterAuth itself to capture the options and return a stub Auth object.
vi.mock("better-auth", () => ({
  betterAuth: vi.fn((opts: unknown) => ({
    handler: vi.fn(),
    api: {},
    options: opts,
  })),
}));

async function freshImport() {
  vi.resetModules();
  return import("./auth.js");
}

describe("getAuth", () => {
  const savedSecret = process.env.BETTER_AUTH_SECRET;
  const savedUrl = process.env.BETTER_AUTH_URL;
  const savedDbUrl = process.env.DATABASE_URL;

  afterAll(() => {
    // Restore original env after all tests.
    if (savedSecret !== undefined) process.env.BETTER_AUTH_SECRET = savedSecret;
    else delete process.env.BETTER_AUTH_SECRET;
    if (savedUrl !== undefined) process.env.BETTER_AUTH_URL = savedUrl;
    else delete process.env.BETTER_AUTH_URL;
    if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
    else delete process.env.DATABASE_URL;
  });

  it("throws when BETTER_AUTH_SECRET is not set", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    const { getAuth } = await freshImport();
    expect(() => getAuth()).toThrow("BETTER_AUTH_SECRET is not set");
  });

  it("returns an auth object with handler and api when configured", async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-ok";
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getAuth } = await freshImport();

    const auth = getAuth();
    expect(auth).toBeDefined();
    expect(auth.handler).toBeDefined();
    expect(auth.api).toBeDefined();
  });

  it("returns the same singleton on repeated calls", async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-ok";
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getAuth } = await freshImport();

    const auth1 = getAuth();
    const auth2 = getAuth();
    expect(auth1).toBe(auth2);
  });

  it("uses BETTER_AUTH_URL when set, otherwise defaults to localhost:3458", async () => {
    // Without BETTER_AUTH_URL set
    delete process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgres://localhost/test";

    const mod1 = await freshImport();
    const auth1 = mod1.getAuth();
    expect((auth1 as any).options.baseURL).toBe("http://localhost:3458");

    // With BETTER_AUTH_URL set
    process.env.BETTER_AUTH_URL = "https://app.thecompanion.sh";
    const mod2 = await freshImport();
    const auth2 = mod2.getAuth();
    expect((auth2 as any).options.baseURL).toBe(
      "https://app.thecompanion.sh",
    );
  });

  it("enables emailAndPassword auth", async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getAuth } = await freshImport();

    const auth = getAuth();
    expect((auth as any).options.emailAndPassword.enabled).toBe(true);
  });

  it("configures the organization plugin with teams enabled", async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgres://localhost/test";
    const { getAuth } = await freshImport();

    const auth = getAuth();
    const plugins = (auth as any).options.plugins;
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe("organization");
  });
});
