// Lightweight structured logger for the Companion server.
// Provides JSON-structured log output for operational events while
// keeping the familiar console.log interface for human-readable logs.
//
// Usage:
//   import { log } from "./logger.js";
//   log.info("ws-bridge", "Browser connected", { sessionId, browsers: 3 });
//   log.warn("orchestrator", "Git fetch failed", { sessionId, error: "..." });
//   log.error("cli-launcher", "Process crashed", { sessionId, exitCode: 1 });

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  [key: string]: unknown;
}

const STRUCTURED = process.env.COMPANION_LOG_FORMAT === "json";

function formatEntry(level: LogLevel, module: string, msg: string, data?: Record<string, unknown>): string {
  if (STRUCTURED) {
    const entry: LogEntry = {
      ...data,
      ts: new Date().toISOString(),
      level,
      module,
      msg,
    };
    return JSON.stringify(entry);
  }

  // Human-readable format (default): [module] msg key=value key=value
  let line = `[${module}] ${msg}`;
  if (data) {
    const pairs = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    if (pairs) line += ` | ${pairs}`;
  }
  return line;
}

export const log = {
  info(module: string, msg: string, data?: Record<string, unknown>): void {
    console.log(formatEntry("info", module, msg, data));
  },

  warn(module: string, msg: string, data?: Record<string, unknown>): void {
    console.warn(formatEntry("warn", module, msg, data));
  },

  error(module: string, msg: string, data?: Record<string, unknown>): void {
    console.error(formatEntry("error", module, msg, data));
  },
};
