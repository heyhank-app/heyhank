// ─── Auto-Approve System ─────────────────────────────────────────────────────
// Agent Max 2.0 can automatically approve/deny permission requests
// for trusted agents based on risk assessment rules.

import type { AgentConfig } from "./agent-types.js";
import * as agentStore from "./agent-store.js";
import { isKilled } from "./kill-switch.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutoApproveRule {
  /** Agent ID this rule applies to ("*" for all) */
  agentId: string;
  /** Tool names to auto-approve (empty = all) */
  allowedTools: string[];
  /** Tool names to always deny */
  deniedTools: string[];
  /** Whether to auto-approve all safe verdicts */
  autoApproveSafe: boolean;
  /** Whether to auto-deny all dangerous verdicts */
  autoDenyDangerous: boolean;
  /** Max cost per action before requiring manual approval (USD) */
  maxCostPerAction?: number;
}

export interface PermissionEvaluation {
  action: "approve" | "deny" | "manual";
  reason: string;
}

// ─── Default Rules ───────────────────────────────────────────────────────────

const DEFAULT_RULES: AutoApproveRule[] = [
  {
    // Monitoring Agent: read-only, always approve
    agentId: "monitoring-agent",
    allowedTools: ["bash", "read", "glob", "grep"],
    deniedTools: ["write", "edit"],
    autoApproveSafe: true,
    autoDenyDangerous: true,
  },
  {
    // Coding Agent: full access, approve safe, manual for dangerous
    agentId: "coding-agent",
    allowedTools: [],
    deniedTools: [],
    autoApproveSafe: true,
    autoDenyDangerous: false,
  },
  {
    // Default: approve safe, deny dangerous
    agentId: "*",
    allowedTools: [],
    deniedTools: [],
    autoApproveSafe: true,
    autoDenyDangerous: true,
  },
];

// ─── Dangerous Patterns ──────────────────────────────────────────────────────

const DANGEROUS_BASH_PATTERNS = [
  /rm\s+-rf?\s+\//,       // rm -rf /
  /mkfs/,                   // format disk
  /dd\s+if=/,              // dd
  />\s*\/dev\/sd/,         // write to disk device
  /chmod\s+777/,           // world-writable
  /curl.*\|\s*(ba)?sh/,    // curl | bash
  /wget.*\|\s*(ba)?sh/,    // wget | bash
  /:(){ :\|:& };:/,       // fork bomb
  /--force.*push/,         // force push
  /git\s+push.*--force/,   // git force push
  /DROP\s+(TABLE|DATABASE)/i, // SQL drop
  /DELETE\s+FROM.*WHERE\s+1/i, // SQL mass delete
];

const SAFE_READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TaskGet", "TaskList",
]);

// ─── Evaluation ──────────────────────────────────────────────────────────────

/** Evaluate whether to auto-approve a permission request. */
export function evaluate(
  agentId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  aiVerdict?: "safe" | "dangerous" | "uncertain",
): PermissionEvaluation {
  // Kill switch overrides everything
  if (isKilled()) {
    return { action: "deny", reason: "Kill switch active" };
  }

  // Find matching rule (specific agent first, then wildcard)
  const rule =
    DEFAULT_RULES.find((r) => r.agentId === agentId) ||
    DEFAULT_RULES.find((r) => r.agentId === "*");

  if (!rule) {
    return { action: "manual", reason: "No matching rule" };
  }

  // Check denied tools
  if (rule.deniedTools.length > 0 && rule.deniedTools.includes(toolName.toLowerCase())) {
    return { action: "deny", reason: `Tool "${toolName}" is denied for agent` };
  }

  // Check allowed tools (if specified, only these are allowed)
  if (rule.allowedTools.length > 0 && !rule.allowedTools.includes(toolName.toLowerCase())) {
    return { action: "deny", reason: `Tool "${toolName}" not in allowed list` };
  }

  // Read-only tools are always safe
  if (SAFE_READ_ONLY_TOOLS.has(toolName)) {
    return { action: "approve", reason: "Read-only tool" };
  }

  // Check bash commands for dangerous patterns
  if (toolName.toLowerCase() === "bash" || toolName === "Bash") {
    const command = String(toolInput?.command || toolInput?.cmd || "");
    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return { action: "deny", reason: `Dangerous bash pattern: ${pattern}` };
      }
    }
  }

  // Use AI verdict if available
  if (aiVerdict === "safe" && rule.autoApproveSafe) {
    return { action: "approve", reason: "AI verdict: safe" };
  }
  if (aiVerdict === "dangerous" && rule.autoDenyDangerous) {
    return { action: "deny", reason: "AI verdict: dangerous" };
  }

  // Default to manual review
  return { action: "manual", reason: "Requires manual review" };
}

/** Check if an agent session should use auto-approve. */
export function shouldAutoApprove(agentId: string): boolean {
  const agent = agentStore.getAgent(agentId);
  if (!agent) return false;
  // Auto-approve for agents running with bypassPermissions
  return agent.permissionMode === "bypassPermissions";
}

/** Get all rules (for admin UI). */
export function getRules(): AutoApproveRule[] {
  return [...DEFAULT_RULES];
}
