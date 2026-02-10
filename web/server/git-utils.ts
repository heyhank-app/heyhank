import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GitRepoInfo {
  repoRoot: string;
  repoName: string;
  currentBranch: string;
  defaultBranch: string;
  isWorktree: boolean;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  worktreePath: string | null;
  ahead: number;
  behind: number;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMainWorktree: boolean;
  isDirty: boolean;
}

export interface WorktreeCreateResult {
  worktreePath: string;
  branch: string;
  isNew: boolean;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const WORKTREES_BASE = join(homedir(), ".companion", "worktrees");

function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, "--");
}

function worktreeDir(repoName: string, branch: string): string {
  return join(WORKTREES_BASE, repoName, sanitizeBranch(branch));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitSafe(cmd: string, cwd: string): string | null {
  try {
    return git(cmd, cwd);
  } catch {
    return null;
  }
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function getRepoInfo(cwd: string): GitRepoInfo | null {
  const repoRoot = gitSafe("rev-parse --show-toplevel", cwd);
  if (!repoRoot) return null;

  const currentBranch = gitSafe("rev-parse --abbrev-ref HEAD", cwd) || "HEAD";
  const gitDir = gitSafe("rev-parse --git-dir", cwd) || "";
  // A linked worktree's .git dir is inside the main repo's .git/worktrees/
  const isWorktree = gitDir.includes("/worktrees/");

  const defaultBranch = resolveDefaultBranch(repoRoot);

  return {
    repoRoot,
    repoName: basename(repoRoot),
    currentBranch,
    defaultBranch,
    isWorktree,
  };
}

function resolveDefaultBranch(repoRoot: string): string {
  // Try origin HEAD
  const originRef = gitSafe("symbolic-ref refs/remotes/origin/HEAD", repoRoot);
  if (originRef) {
    return originRef.replace("refs/remotes/origin/", "");
  }
  // Fallback: check if main or master exists
  const branches = gitSafe("branch --list main master", repoRoot) || "";
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  // Last resort
  return "main";
}

export function listBranches(repoRoot: string): GitBranchInfo[] {
  // Get worktree mappings first
  const worktrees = listWorktrees(repoRoot);
  const worktreeByBranch = new Map<string, string>();
  for (const wt of worktrees) {
    if (wt.branch) worktreeByBranch.set(wt.branch, wt.path);
  }

  const result: GitBranchInfo[] = [];

  // Local branches
  const localRaw = gitSafe(
    "for-each-ref '--format=%(refname:short)%09%(HEAD)' refs/heads/",
    repoRoot,
  );
  if (localRaw) {
    for (const line of localRaw.split("\n")) {
      if (!line.trim()) continue;
      const [name, head] = line.split("\t");
      const isCurrent = head?.trim() === "*";
      const { ahead, behind } = getBranchStatus(repoRoot, name);
      result.push({
        name,
        isCurrent,
        isRemote: false,
        worktreePath: worktreeByBranch.get(name) || null,
        ahead,
        behind,
      });
    }
  }

  // Remote branches (only those without a local counterpart)
  const localNames = new Set(result.map((b) => b.name));
  const remoteRaw = gitSafe(
    "for-each-ref '--format=%(refname:short)' refs/remotes/origin/",
    repoRoot,
  );
  if (remoteRaw) {
    for (const line of remoteRaw.split("\n")) {
      const full = line.trim();
      if (!full || full === "origin/HEAD") continue;
      const name = full.replace("origin/", "");
      if (localNames.has(name)) continue;
      result.push({
        name,
        isCurrent: false,
        isRemote: true,
        worktreePath: null,
        ahead: 0,
        behind: 0,
      });
    }
  }

  return result;
}

export function listWorktrees(repoRoot: string): GitWorktreeInfo[] {
  const raw = gitSafe("worktree list --porcelain", repoRoot);
  if (!raw) return [];

  const worktrees: GitWorktreeInfo[] = [];
  let current: Partial<GitWorktreeInfo> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current as GitWorktreeInfo);
      }
      current = { path: line.slice(9), isDirty: false, isMainWorktree: false };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.isMainWorktree = true;
    } else if (line === "") {
      // End of entry — check if main worktree (first one is always main)
      if (worktrees.length === 0 && current.path) {
        current.isMainWorktree = true;
      }
    }
  }
  // Push last entry
  if (current.path) {
    if (worktrees.length === 0) current.isMainWorktree = true;
    worktrees.push(current as GitWorktreeInfo);
  }

  // Check dirty status for each worktree
  for (const wt of worktrees) {
    wt.isDirty = isWorktreeDirty(wt.path);
  }

  return worktrees;
}

export function ensureWorktree(
  repoRoot: string,
  branchName: string,
  options?: { baseBranch?: string; createBranch?: boolean },
): WorktreeCreateResult {
  const repoName = basename(repoRoot);
  const targetPath = worktreeDir(repoName, branchName);

  // Check if a worktree already exists for this branch
  const existing = listWorktrees(repoRoot);
  const found = existing.find((wt) => wt.branch === branchName);
  if (found) {
    return { worktreePath: found.path, branch: branchName, isNew: false };
  }

  // Ensure parent directory exists
  mkdirSync(join(WORKTREES_BASE, repoName), { recursive: true });

  // Check if branch already exists locally or on remote
  const branchExists =
    gitSafe(`rev-parse --verify refs/heads/${branchName}`, repoRoot) !== null;
  const remoteBranchExists =
    gitSafe(`rev-parse --verify refs/remotes/origin/${branchName}`, repoRoot) !== null;

  if (branchExists) {
    // Worktree add with existing local branch
    git(`worktree add "${targetPath}" ${branchName}`, repoRoot);
    return { worktreePath: targetPath, branch: branchName, isNew: false };
  }

  if (remoteBranchExists) {
    // Create local tracking branch from remote
    git(`worktree add -b ${branchName} "${targetPath}" origin/${branchName}`, repoRoot);
    return { worktreePath: targetPath, branch: branchName, isNew: false };
  }

  if (options?.createBranch !== false) {
    // Create new branch from base
    const base = options?.baseBranch || resolveDefaultBranch(repoRoot);
    git(`worktree add -b ${branchName} "${targetPath}" ${base}`, repoRoot);
    return { worktreePath: targetPath, branch: branchName, isNew: true };
  }

  throw new Error(`Branch "${branchName}" does not exist and createBranch is false`);
}

export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  options?: { force?: boolean },
): { removed: boolean; reason?: string } {
  if (!existsSync(worktreePath)) {
    // Already gone, clean up git's reference
    gitSafe("worktree prune", repoRoot);
    return { removed: true };
  }

  if (!options?.force && isWorktreeDirty(worktreePath)) {
    return {
      removed: false,
      reason: "Worktree has uncommitted changes. Use force to remove anyway.",
    };
  }

  try {
    const forceFlag = options?.force ? " --force" : "";
    git(`worktree remove "${worktreePath}"${forceFlag}`, repoRoot);
    return { removed: true };
  } catch (e: unknown) {
    return {
      removed: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export function isWorktreeDirty(worktreePath: string): boolean {
  if (!existsSync(worktreePath)) return false;
  const status = gitSafe("status --porcelain", worktreePath);
  return status !== null && status.length > 0;
}

export function gitFetch(cwd: string): { success: boolean; output: string } {
  try {
    const output = git("fetch --prune", cwd);
    return { success: true, output };
  } catch (e: unknown) {
    return { success: false, output: e instanceof Error ? e.message : String(e) };
  }
}

export function gitPull(
  cwd: string,
): { success: boolean; output: string } {
  try {
    const output = git("pull", cwd);
    return { success: true, output };
  } catch (e: unknown) {
    return { success: false, output: e instanceof Error ? e.message : String(e) };
  }
}


export function checkoutBranch(cwd: string, branchName: string): void {
  git(`checkout ${branchName}`, cwd);
}

export function getBranchStatus(
  repoRoot: string,
  branchName: string,
): { ahead: number; behind: number } {
  const raw = gitSafe(
    `rev-list --left-right --count origin/${branchName}...${branchName}`,
    repoRoot,
  );
  if (!raw) return { ahead: 0, behind: 0 };
  const [behind, ahead] = raw.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}
