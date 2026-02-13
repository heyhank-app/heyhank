import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("CLI help output", () => {
  it("lists stop and restart commands", () => {
    const cliPath = fileURLToPath(new URL("../bin/cli.ts", import.meta.url));
    const result = spawnSync("bun", [cliPath, "--help"], { encoding: "utf-8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stop        Stop the background service");
    expect(result.stdout).toContain("restart     Restart the background service");
    expect(result.stdout).toContain("help        Show this help message");
  });
});
