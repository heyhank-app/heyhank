import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { atomicWriteFileSync } from "./fs-utils.js";
import type { Team } from "./team-types.js";

const TEAMS_DIR = join(HEYHANK_HOME, "teams");

function ensureDir(): void {
  mkdirSync(TEAMS_DIR, { recursive: true });
}

function filePath(id: string): string {
  return join(TEAMS_DIR, `${id}.json`);
}

export function createTeam(team: Team): void {
  ensureDir();
  atomicWriteFileSync(filePath(team.id), JSON.stringify(team, null, 2));
}

export function getTeam(teamId: string): Team | null {
  ensureDir();
  try {
    const raw = readFileSync(filePath(teamId), "utf-8");
    return JSON.parse(raw) as Team;
  } catch {
    return null;
  }
}

export function updateTeam(teamId: string, updates: Partial<Team>): Team | null {
  const existing = getTeam(teamId);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  atomicWriteFileSync(filePath(teamId), JSON.stringify(updated, null, 2));
  return updated;
}

export function listTeams(): Team[] {
  ensureDir();
  try {
    const files = readdirSync(TEAMS_DIR).filter((f) => f.endsWith(".json"));
    const teams: Team[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(TEAMS_DIR, file), "utf-8");
        teams.push(JSON.parse(raw));
      } catch {
        // Skip corrupt files
      }
    }
    teams.sort((a, b) => b.createdAt - a.createdAt);
    return teams;
  } catch {
    return [];
  }
}

export function deleteTeam(teamId: string): boolean {
  ensureDir();
  if (!existsSync(filePath(teamId))) return false;
  try {
    unlinkSync(filePath(teamId));
    return true;
  } catch {
    return false;
  }
}
