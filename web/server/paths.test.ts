import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

describe("paths", () => {
  const originalEnv = process.env.HEYHANK_HOME;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.HEYHANK_HOME;
    } else {
      process.env.HEYHANK_HOME = originalEnv;
    }
  });

  it("defaults to ~/.heyhank/ when HEYHANK_HOME is not set", async () => {
    delete process.env.HEYHANK_HOME;
    // Dynamic import to pick up env change (module is already cached, so we
    // test the value computed at import time — which uses the env at startup)
    const { HEYHANK_HOME } = await import("./paths.js");
    // When env var is unset at module load time, it should be ~/.heyhank
    expect(HEYHANK_HOME).toBe(join(homedir(), ".heyhank"));
  });

  it("exports a string path", async () => {
    const { HEYHANK_HOME } = await import("./paths.js");
    expect(typeof HEYHANK_HOME).toBe("string");
    expect(HEYHANK_HOME.length).toBeGreaterThan(0);
  });
});
