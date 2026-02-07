import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_DIR = join(homedir(), ".claude");

export function teamsDir(): string {
  return join(CLAUDE_DIR, "teams");
}

export function teamDir(teamName: string): string {
  return join(teamsDir(), teamName);
}

export function teamConfigPath(teamName: string): string {
  return join(teamDir(teamName), "config.json");
}

export function inboxesDir(teamName: string): string {
  return join(teamDir(teamName), "inboxes");
}

export function inboxPath(teamName: string, agentName: string): string {
  return join(inboxesDir(teamName), `${agentName}.json`);
}

export function tasksBaseDir(): string {
  return join(CLAUDE_DIR, "tasks");
}

export function tasksDir(teamName: string): string {
  return join(tasksBaseDir(), teamName);
}

export function taskPath(teamName: string, taskId: string): string {
  return join(tasksDir(teamName), `${taskId}.json`);
}
