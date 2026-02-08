import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import type { Logger } from "./types.js";

export interface SpawnOptions {
  teamName: string;
  agentName: string;
  agentId: string;
  agentType?: string;
  model?: string;
  cwd?: string;
  parentSessionId?: string;
  color?: string;
  claudeBinary?: string;
  permissions?: string[];
  permissionMode?: string;
  teammateMode?: "auto" | "tmux" | "in-process";
  /** Extra environment variables to inject into the agent process */
  env?: Record<string, string>;
}

/**
 * Manages Claude Code agent processes.
 * Spawns agents inside a Python-based PTY wrapper since the Claude Code TUI
 * binary requires a real terminal to function.
 */
export class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  /**
   * Spawn a new claude CLI process in teammate mode.
   * Uses a Python PTY wrapper to provide the terminal the TUI needs.
   */
  spawn(opts: SpawnOptions): ChildProcess {
    let binary = opts.claudeBinary || "claude";
    if (!binary.startsWith("/")) {
      try {
        binary = execSync(`which ${binary}`, { encoding: "utf-8" }).trim();
      } catch {
        // fall through
      }
    }

    const claudeArgs: string[] = [
      "--teammate-mode",
      opts.teammateMode || "auto",
      "--agent-id",
      opts.agentId,
      "--agent-name",
      opts.agentName,
      "--team-name",
      opts.teamName,
    ];

    if (opts.agentType) {
      claudeArgs.push("--agent-type", opts.agentType);
    }
    if (opts.color) {
      claudeArgs.push("--agent-color", opts.color);
    }
    if (opts.parentSessionId) {
      claudeArgs.push("--parent-session-id", opts.parentSessionId);
    }
    if (opts.model) {
      claudeArgs.push("--model", opts.model);
    }
    if (opts.permissionMode) {
      claudeArgs.push("--permission-mode", opts.permissionMode);
    }
    if (opts.permissions) {
      for (const perm of opts.permissions) {
        claudeArgs.push("--allowedTools", perm);
      }
    }

    this.log.info(
      `Spawning agent "${opts.agentName}": ${binary} ${claudeArgs.join(" ")}`
    );

    // Python PTY wrapper — provides a real terminal to the claude TUI binary.
    // We pass the command as JSON to avoid shell escaping issues.
    const cmdJson = JSON.stringify([binary, ...claudeArgs]);
    const pythonScript = `
import pty, os, sys, json, signal, select

cmd = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
else:
    signal.signal(signal.SIGTERM, lambda *a: (os.kill(pid, signal.SIGTERM), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (os.kill(pid, signal.SIGTERM), sys.exit(0)))
    buf = b""
    trust_sent = False
    try:
        while True:
            r, _, _ = select.select([fd, 0], [], [], 1.0)
            if fd in r:
                try:
                    data = os.read(fd, 4096)
                    if not data:
                        break
                    os.write(1, data)
                    if not trust_sent:
                        buf += data
                        if b"Yes" in buf and b"trust" in buf:
                            os.write(fd, b"\\r")
                            trust_sent = True
                            buf = b""
                except OSError:
                    break
            if 0 in r:
                try:
                    data = os.read(0, 4096)
                    if not data:
                        break
                    os.write(fd, data)
                except OSError:
                    break
    except:
        pass
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except:
            pass
        _, status = os.waitpid(pid, 0)
        sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
`;

    const proc = spawn("python3", ["-c", pythonScript, cmdJson], {
      cwd: opts.cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDECODE: "1",
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        ...opts.env,
      },
    });

    this.processes.set(opts.agentName, proc);

    proc.on("exit", (code, signal) => {
      this.log.info(
        `Agent "${opts.agentName}" exited (code=${code}, signal=${signal})`
      );
      this.processes.delete(opts.agentName);
    });

    proc.on("error", (err) => {
      this.log.error(`Agent "${opts.agentName}" process error: ${err.message}`);
      this.processes.delete(opts.agentName);
    });

    return proc;
  }

  /**
   * Register a callback for when an agent process exits.
   */
  onExit(name: string, callback: (code: number | null) => void): void {
    const proc = this.processes.get(name);
    if (proc) proc.on("exit", (code) => callback(code));
  }

  /**
   * Get the process for a named agent.
   */
  get(name: string): ChildProcess | undefined {
    return this.processes.get(name);
  }

  /**
   * Check if an agent process is still running.
   */
  isRunning(name: string): boolean {
    const proc = this.processes.get(name);
    return proc !== undefined && proc.exitCode === null && !proc.killed;
  }

  /**
   * Get the PID of a running agent.
   */
  getPid(name: string): number | undefined {
    return this.processes.get(name)?.pid;
  }

  /**
   * Kill a specific agent process.
   */
  async kill(name: string, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const proc = this.processes.get(name);
    if (!proc) return;

    proc.kill(signal);

    await Promise.race([
      new Promise<void>((resolve) => proc.on("exit", () => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (this.processes.has(name)) {
            this.log.warn(`Force-killing agent "${name}" with SIGKILL`);
            try {
              proc.kill("SIGKILL");
            } catch {
              // May already be dead
            }
          }
          resolve();
        }, 5_000)
      ),
    ]);

    this.processes.delete(name);
  }

  /**
   * Kill all agent processes.
   */
  async killAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.all(names.map((name) => this.kill(name)));
  }

  /**
   * Get all running agent names.
   */
  runningAgents(): string[] {
    return [...this.processes.keys()].filter((n) => this.isRunning(n));
  }
}
