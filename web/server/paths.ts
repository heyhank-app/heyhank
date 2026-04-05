import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Base directory for all HeyHank configuration and state.
 * Defaults to ~/.heyhank/ for self-hosted installs.
 * Override with HEYHANK_HOME env var for managed deployments
 * (e.g. HEYHANK_HOME=/data/heyhank on Fly.io volumes).
 * Falls back to COMPANION_HOME for backward compatibility.
 */
export const HEYHANK_HOME =
  process.env.HEYHANK_HOME || process.env.COMPANION_HOME || join(homedir(), ".heyhank");

