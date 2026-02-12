import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { DEFAULT_PORT_PROD } from "./constants.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

const LABEL = "sh.thecompanion.app";
const OLD_LABEL = "co.thevibecompany.companion";
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);
const OLD_PLIST_PATH = join(PLIST_DIR, `${OLD_LABEL}.plist`);
const COMPANION_DIR = join(homedir(), ".companion");
const LOG_DIR = join(COMPANION_DIR, "logs");
const STDOUT_LOG = join(LOG_DIR, "companion.log");
const STDERR_LOG = join(LOG_DIR, "companion.error.log");

// ─── Platform check ────────────────────────────────────────────────────────────

function ensureMacOS(): void {
  if (process.platform !== "darwin") {
    console.error("Service management is only supported on macOS (launchd).");
    console.error("Linux systemd support is planned for a future release.");
    process.exit(1);
  }
}

// ─── Plist generation ──────────────────────────────────────────────────────────

interface PlistOptions {
  binPath: string;
  port?: number;
}

export function generatePlist(opts: PlistOptions): string {
  const port = opts.port ?? DEFAULT_PORT_PROD;
  const home = homedir();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${opts.binPath}</string>
        <string>start</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${home}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>${STDOUT_LOG}</string>

    <key>StandardErrorPath</key>
    <string>${STDERR_LOG}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>${port}</string>
        <key>HOME</key>
        <string>${home}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${home}/.bun/bin</string>
    </dict>

    <key>ProcessType</key>
    <string>Interactive</string>

    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>`;
}

// ─── Binary resolution ─────────────────────────────────────────────────────────

function resolveBinPath(): string {
  try {
    const binPath = execSync("which the-companion", { encoding: "utf-8" }).trim();
    if (binPath) return binPath;
  } catch {
    // not found globally
  }

  console.error("the-companion must be installed globally for service mode.");
  console.error("");
  console.error("  bun install -g the-companion");
  console.error("");
  console.error("Then retry:");
  console.error("");
  console.error("  the-companion install");
  process.exit(1);
}

function unloadService(plistPath: string): void {
  try {
    execSync(`launchctl unload -w "${plistPath}"`, { stdio: "pipe" });
  } catch {
    // Service may already be unloaded — that's fine
  }
}

function removePlist(plistPath: string): void {
  try {
    unlinkSync(plistPath);
  } catch {
    // Already gone
  }
}

function migrateLegacyInstallIfNeeded(): void {
  if (!existsSync(OLD_PLIST_PATH)) return;

  console.log("Found legacy The Vibe Companion service. Migrating...");
  unloadService(OLD_PLIST_PATH);
  removePlist(OLD_PLIST_PATH);
}

function getInstalledService():
  | { label: string; plistPath: string }
  | undefined {
  if (existsSync(PLIST_PATH)) return { label: LABEL, plistPath: PLIST_PATH };
  if (existsSync(OLD_PLIST_PATH)) {
    return { label: OLD_LABEL, plistPath: OLD_PLIST_PATH };
  }
  return undefined;
}

// ─── Install ───────────────────────────────────────────────────────────────────

export async function install(opts?: { port?: number }): Promise<void> {
  ensureMacOS();

  migrateLegacyInstallIfNeeded();

  if (existsSync(PLIST_PATH)) {
    console.error("The Companion is already installed as a service.");
    console.error("Run 'the-companion uninstall' first to reinstall.");
    process.exit(1);
  }

  const binPath = resolveBinPath();
  const port = opts?.port ?? DEFAULT_PORT_PROD;

  // Create log directory
  mkdirSync(LOG_DIR, { recursive: true });

  // Generate and write plist
  const plist = generatePlist({ binPath, port });
  mkdirSync(PLIST_DIR, { recursive: true });
  writeFileSync(PLIST_PATH, plist, "utf-8");

  // Load the service
  try {
    execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: "pipe" });
  } catch (err: unknown) {
    console.error("Failed to load the service with launchctl:");
    console.error(err instanceof Error ? err.message : String(err));
    // Clean up the plist on failure
    try { unlinkSync(PLIST_PATH); } catch { /* ok */ }
    process.exit(1);
  }

  console.log("The Companion has been installed as a background service.");
  console.log("");
  console.log(`  URL:    http://localhost:${port}`);
  console.log(`  Logs:   ${LOG_DIR}`);
  console.log(`  Plist:  ${PLIST_PATH}`);
  console.log("");
  console.log("The service will start automatically on login.");
  console.log("Use 'the-companion status' to check if it's running.");
}

// ─── Uninstall ─────────────────────────────────────────────────────────────────

export async function uninstall(): Promise<void> {
  ensureMacOS();

  const installedService = getInstalledService();
  if (!installedService) {
    console.log("The Companion is not installed as a service.");
    return;
  }

  unloadService(installedService.plistPath);
  removePlist(installedService.plistPath);

  console.log("The Companion service has been removed.");
  console.log(`Logs are preserved at ${LOG_DIR}`);
}

// ─── Status ────────────────────────────────────────────────────────────────────

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  port?: number;
}

/**
 * Safe check for whether the current process is running as a launchd service.
 * Unlike status(), this never calls process.exit() and works on all platforms.
 */
export function isRunningAsService(): boolean {
  if (process.platform !== "darwin") return false;
  const installedService = getInstalledService();
  if (!installedService) return false;
  try {
    const output = execSync(`launchctl list "${installedService.label}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return /"PID"\s*=\s*\d+/.test(output);
  } catch {
    return false;
  }
}

export async function status(): Promise<ServiceStatus> {
  ensureMacOS();

  const installedService = getInstalledService();
  if (!installedService) {
    return { installed: false, running: false };
  }

  // Read port from the plist
  let port = DEFAULT_PORT_PROD;
  try {
    const plistContent = readFileSync(installedService.plistPath, "utf-8");
    const portMatch = plistContent.match(/<key>PORT<\/key>\s*<string>(\d+)<\/string>/);
    if (portMatch) port = Number(portMatch[1]);
  } catch { /* use default */ }

  // Check if service is running via launchctl
  try {
    const output = execSync(`launchctl list "${installedService.label}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse PID from the launchctl list output
    const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
    if (pidMatch) {
      return { installed: true, running: true, pid: Number(pidMatch[1]), port };
    }

    // Service is loaded but not running (no PID)
    return { installed: true, running: false, port };
  } catch {
    // launchctl list fails if service is not loaded
    return { installed: true, running: false, port };
  }
}
