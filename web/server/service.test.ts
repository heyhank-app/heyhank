import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let service: typeof import("./service.js");

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => { dir = d; },
  };
});

const mockExecSync = vi.hoisted(() => {
  return vi.fn<(cmd: string, opts?: object) => string>();
});

const mockPlatform = vi.hoisted(() => {
  let platform = "darwin";
  return {
    get: () => platform,
    set: (p: string) => { platform = p; },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: mockExecSync,
  };
});

// Mock process.platform
const originalPlatform = process.platform;
beforeEach(() => {
  Object.defineProperty(process, "platform", {
    value: mockPlatform.get(),
    writable: true,
    configurable: true,
  });
});

afterAll(() => {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    writable: true,
    configurable: true,
  });
});

// ─── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "service-test-"));
  mockHomedir.set(tempDir);
  mockPlatform.set("darwin");
  mockExecSync.mockReset();

  // Mock process.exit to throw instead of exiting
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit(${code})`);
  });

  vi.resetModules();
  service = await import("./service.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function plistPath(): string {
  return join(tempDir, "Library", "LaunchAgents", "sh.thecompanion.app.plist");
}

function oldPlistPath(): string {
  return join(tempDir, "Library", "LaunchAgents", "co.thevibecompany.companion.plist");
}

function logDir(): string {
  return join(tempDir, ".companion", "logs");
}

// ===========================================================================
// generatePlist
// ===========================================================================
describe("generatePlist", () => {
  it("generates valid XML with the correct label", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<string>sh.thecompanion.app</string>");
  });

  it("includes RunAtLoad true", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
  });

  it("includes KeepAlive with SuccessfulExit false", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
  });

  it("uses the provided binary path in ProgramArguments", () => {
    const plist = service.generatePlist({ binPath: "/opt/homebrew/bin/the-companion" });
    expect(plist).toContain("<string>/opt/homebrew/bin/the-companion</string>");
    expect(plist).toContain("<string>start</string>");
  });

  it("uses the default production port when none specified", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("<key>PORT</key>");
    expect(plist).toContain("<string>3456</string>");
  });

  it("uses a custom port when specified", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion", port: 8080 });
    expect(plist).toContain("<string>8080</string>");
  });

  it("includes NODE_ENV production", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("<key>NODE_ENV</key>");
    expect(plist).toContain("<string>production</string>");
  });

  it("includes PATH with homebrew and bun directories", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("/opt/homebrew/bin");
    expect(plist).toContain(".bun/bin");
  });

  it("includes ThrottleInterval", () => {
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" });
    expect(plist).toContain("<key>ThrottleInterval</key>");
    expect(plist).toContain("<integer>5</integer>");
  });
});

// ===========================================================================
// install
// ===========================================================================
describe("install", () => {
  it("creates log directory and writes plist file", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });

    await service.install();

    expect(existsSync(logDir())).toBe(true);
    expect(existsSync(plistPath())).toBe(true);

    const content = readFileSync(plistPath(), "utf-8");
    expect(content).toContain("sh.thecompanion.app");
  });

  it("calls launchctl load with the plist path", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });

    await service.install();

    const launchctlCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === "string" && cmd.startsWith("launchctl load"),
    );
    expect(launchctlCall).toBeDefined();
    expect(launchctlCall![0]).toContain(plistPath());
  });

  it("exits with error if already installed", async () => {
    // First install
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl")) return "";
      return "";
    });
    await service.install();

    // Second install should fail
    vi.resetModules();
    service = await import("./service.js");
    await expect(service.install()).rejects.toThrow("process.exit(1)");
  });

  it("exits with error if binary not found globally", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) throw new Error("not found");
      return "";
    });

    await expect(service.install()).rejects.toThrow("process.exit(1)");
  });

  it("uses custom port when provided", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl")) return "";
      return "";
    });

    await service.install({ port: 9000 });

    const content = readFileSync(plistPath(), "utf-8");
    expect(content).toContain("<string>9000</string>");
  });

  it("cleans up plist if launchctl load fails", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) throw new Error("launchctl failed");
      return "";
    });

    await expect(service.install()).rejects.toThrow("process.exit(1)");
    expect(existsSync(plistPath())).toBe(false);
  });

  it("migrates old launchd label before installing", async () => {
    const oldPath = oldPlistPath();
    const launchAgentsDir = join(tempDir, "Library", "LaunchAgents");
    rmSync(launchAgentsDir, { recursive: true, force: true });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl unload")) return "";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });

    // Create a legacy plist to simulate pre-rename installs
    const plist = service.generatePlist({ binPath: "/usr/local/bin/the-companion" })
      .replaceAll("sh.thecompanion.app", "co.thevibecompany.companion");
    mkdirSync(launchAgentsDir, { recursive: true });
    writeFileSync(oldPath, plist, "utf-8");

    await service.install();

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(plistPath())).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining(`launchctl unload -w "${oldPath}"`),
      expect.any(Object),
    );
  });
});

// ===========================================================================
// uninstall
// ===========================================================================
describe("uninstall", () => {
  it("calls launchctl unload and removes plist", async () => {
    // Install first
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl")) return "";
      return "";
    });
    await service.install();

    vi.resetModules();
    service = await import("./service.js");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation(() => "");

    await service.uninstall();

    const unloadCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === "string" && cmd.startsWith("launchctl unload"),
    );
    expect(unloadCall).toBeDefined();
    expect(existsSync(plistPath())).toBe(false);
  });

  it("handles not-installed gracefully", async () => {
    // Should not throw
    await service.uninstall();
  });

  it("uninstalls old launchd label when only legacy plist exists", async () => {
    const oldPath = oldPlistPath();
    const launchAgentsDir = join(tempDir, "Library", "LaunchAgents");
    mkdirSync(launchAgentsDir, { recursive: true });
    writeFileSync(oldPath, "<plist/>", "utf-8");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation(() => "");

    await service.uninstall();

    expect(existsSync(oldPath)).toBe(false);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining(`launchctl unload -w "${oldPath}"`),
      expect.any(Object),
    );
  });
});

// ===========================================================================
// status
// ===========================================================================
describe("status", () => {
  it("returns installed: false when no plist exists", async () => {
    const result = await service.status();
    expect(result).toEqual({ installed: false, running: false });
  });

  it("returns installed: true, running: true with PID", async () => {
    // Install first
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });
    await service.install();

    vi.resetModules();
    service = await import("./service.js");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("launchctl list")) {
        return `{\n\t"PID" = 12345;\n\t"Label" = "sh.thecompanion.app";\n}`;
      }
      return "";
    });

    const result = await service.status();
    expect(result.installed).toBe(true);
    expect(result.running).toBe(true);
    expect(result.pid).toBe(12345);
    expect(result.port).toBe(3456);
  });

  it("returns installed: true, running: false when service is loaded but not running", async () => {
    // Install first
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });
    await service.install();

    vi.resetModules();
    service = await import("./service.js");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("launchctl list")) {
        return `{\n\t"Label" = "sh.thecompanion.app";\n}`;
      }
      return "";
    });

    const result = await service.status();
    expect(result.installed).toBe(true);
    expect(result.running).toBe(false);
  });

  it("reports legacy launchd label as installed and running", async () => {
    const oldPath = oldPlistPath();
    const launchAgentsDir = join(tempDir, "Library", "LaunchAgents");
    mkdirSync(launchAgentsDir, { recursive: true });
    writeFileSync(
      oldPath,
      `
<plist>
<dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>4567</string>
  </dict>
</dict>
</plist>
`,
      "utf-8",
    );
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("launchctl list")) {
        return `{\n\t"PID" = 12345;\n\t"Label" = "co.thevibecompany.companion";\n}`;
      }
      return "";
    });

    const result = await service.status();
    expect(result).toEqual({
      installed: true,
      running: true,
      pid: 12345,
      port: 4567,
    });
  });
});

// ===========================================================================
// isRunningAsService
// ===========================================================================
describe("isRunningAsService", () => {
  it("returns false on non-macOS platforms", async () => {
    mockPlatform.set("linux");
    Object.defineProperty(process, "platform", { value: "linux" });

    vi.resetModules();
    service = await import("./service.js");

    expect(service.isRunningAsService()).toBe(false);
  });

  it("returns false when no plist exists", () => {
    expect(service.isRunningAsService()).toBe(false);
  });

  it("returns true when plist exists and service has a PID", async () => {
    // Install first
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });
    await service.install();

    vi.resetModules();
    service = await import("./service.js");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("launchctl list")) {
        return `{\n\t"PID" = 12345;\n\t"Label" = "sh.thecompanion.app";\n}`;
      }
      return "";
    });

    expect(service.isRunningAsService()).toBe(true);
  });

  it("returns false when plist exists but no PID (not running)", async () => {
    // Install first
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("which")) return "/usr/local/bin/the-companion\n";
      if (cmd.startsWith("launchctl load")) return "";
      return "";
    });
    await service.install();

    vi.resetModules();
    service = await import("./service.js");
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("launchctl list")) {
        return `{\n\t"Label" = "sh.thecompanion.app";\n}`;
      }
      return "";
    });

    expect(service.isRunningAsService()).toBe(false);
  });
});

// ===========================================================================
// Platform check
// ===========================================================================
describe("platform check", () => {
  it("exits on non-macOS platforms", async () => {
    mockPlatform.set("linux");
    Object.defineProperty(process, "platform", { value: "linux" });

    vi.resetModules();
    service = await import("./service.js");

    await expect(service.install()).rejects.toThrow("process.exit(1)");
  });
});
