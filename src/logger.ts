import type { Logger, LogLevel } from "./types.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = LEVELS[level];

  const noop = () => {};
  const make =
    (lvl: LogLevel, fn: (...args: unknown[]) => void) =>
    (msg: string, ...args: unknown[]) => {
      if (LEVELS[lvl] >= threshold) {
        fn(`[claude-ctrl:${lvl}]`, msg, ...args);
      }
    };

  return {
    debug: threshold <= LEVELS.debug ? make("debug", console.debug) : noop,
    info: threshold <= LEVELS.info ? make("info", console.info) : noop,
    warn: threshold <= LEVELS.warn ? make("warn", console.warn) : noop,
    error: threshold <= LEVELS.error ? make("error", console.error) : noop,
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
