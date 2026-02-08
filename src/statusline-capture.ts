import { EventEmitter } from "node:events";
import { watch, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger, StatusLineData } from "./types.js";
import { teamDir } from "./paths.js";

/**
 * Directory where statusLine JSON logs are written per agent.
 */
export function statusLineDir(teamName: string): string {
  return join(teamDir(teamName), "statusline");
}

export function statusLineLogPath(teamName: string, agentName: string): string {
  return join(statusLineDir(teamName), `${agentName}.jsonl`);
}

export interface StatusLineEvent {
  agentName: string;
  data: StatusLineData;
  timestamp: string;
}

export interface StatusLineCaptureEvents {
  update: [event: StatusLineEvent];
  error: [error: Error];
}

/**
 * Generates the statusLine capture script.
 * This script receives JSON from Claude Code via stdin and appends it to a log file.
 * It also outputs a minimal display for the TUI statusline bar.
 */
export function buildStatusLineCommand(logFilePath: string): string {
  // Python script reads JSON from stdin, appends as JSONL to log file, prints model name.
  // Uses python3 which is already a dependency (PTY wrapper).
  const escapedPath = logFilePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return [
    "python3 -c",
    `'import sys,json;`,
    `d=json.load(sys.stdin);`,
    `open("${escapedPath}","a").write(json.dumps(d)+"\\n");`,
    `print(d.get("model",{}).get("display_name",""))'`,
  ].join(" ");
}

/**
 * Generates the settings.local.json content with statusLine configuration.
 */
export function buildStatusLineSettings(logFilePath: string): Record<string, unknown> {
  return {
    statusLine: {
      type: "command",
      command: buildStatusLineCommand(logFilePath),
    },
  };
}

/**
 * Watches statusLine log files for a team and emits parsed events.
 */
export class StatusLineWatcher extends EventEmitter<StatusLineCaptureEvents> {
  private teamName: string;
  private log: Logger;
  private watchers = new Map<string, ReturnType<typeof watch>>();
  private fileOffsets = new Map<string, number>();
  private stopped = false;

  constructor(teamName: string, logger: Logger) {
    super();
    this.teamName = teamName;
    this.log = logger;
  }

  /**
   * Ensure the statusline directory exists.
   */
  ensureDir(): void {
    const dir = statusLineDir(this.teamName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Start watching a specific agent's statusLine log file.
   */
  watchAgent(agentName: string): void {
    if (this.stopped) return;

    const filePath = statusLineLogPath(this.teamName, agentName);

    // Create the file if it doesn't exist so the watcher can attach
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "");
    }

    // Track current file size to only read new data
    try {
      const stats = readFileSync(filePath);
      this.fileOffsets.set(filePath, stats.length);
    } catch {
      this.fileOffsets.set(filePath, 0);
    }

    try {
      const watcher = watch(filePath, (eventType) => {
        if (eventType === "change") {
          this.readNewLines(agentName, filePath);
        }
      });

      this.watchers.set(agentName, watcher);
      this.log.debug(`Watching statusLine for agent "${agentName}" at ${filePath}`);
    } catch (err) {
      this.log.error(`Failed to watch statusLine for "${agentName}": ${err}`);
    }
  }

  /**
   * Stop watching a specific agent.
   */
  unwatchAgent(agentName: string): void {
    const watcher = this.watchers.get(agentName);
    if (watcher) {
      watcher.close();
      this.watchers.delete(agentName);
    }
    const filePath = statusLineLogPath(this.teamName, agentName);
    this.fileOffsets.delete(filePath);
  }

  /**
   * Stop all watchers.
   */
  stop(): void {
    this.stopped = true;
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    this.fileOffsets.clear();
  }

  /**
   * Read new lines appended to the log file since last read.
   */
  private readNewLines(agentName: string, filePath: string): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      const offset = this.fileOffsets.get(filePath) ?? 0;
      const newContent = content.slice(offset);
      this.fileOffsets.set(filePath, content.length);

      if (!newContent.trim()) return;

      const lines = newContent.trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as StatusLineData;
          const event: StatusLineEvent = {
            agentName,
            data,
            timestamp: new Date().toISOString(),
          };
          this.emit("update", event);
        } catch (parseErr) {
          this.log.debug(`Failed to parse statusLine JSON: ${line}`);
        }
      }
    } catch (err) {
      // File may have been deleted
      this.log.debug(`Error reading statusLine file: ${err}`);
    }
  }
}
