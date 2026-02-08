// ─── Inbox ───────────────────────────────────────────────────────────────────

export interface InboxMessage {
  from: string;
  text: string;
  timestamp: string; // ISO date string
  color?: string;
  read: boolean;
  summary?: string;
}

// Structured message types that can appear inside InboxMessage.text as JSON
export type StructuredMessage =
  | TaskAssignmentMessage
  | TaskCompletedMessage
  | ShutdownRequestMessage
  | ShutdownApprovedMessage
  | IdleNotificationMessage
  | PlanApprovalRequestMessage
  | PlanApprovalResponseMessage
  | PermissionRequestMessage
  | PermissionResponseMessage
  | SandboxPermissionRequestMessage
  | SandboxPermissionResponseMessage
  | PlainTextMessage;

export interface TaskAssignmentMessage {
  type: "task_assignment";
  taskId: string;
  subject: string;
  description: string;
  assignedBy: string;
  timestamp: string;
}

export interface ShutdownRequestMessage {
  type: "shutdown_request";
  requestId: string;
  from: string;
  reason?: string;
  timestamp: string;
}

export interface ShutdownApprovedMessage {
  type: "shutdown_approved";
  requestId: string;
  from: string;
  timestamp: string;
  paneId?: string;
  backendType?: string;
}

export interface IdleNotificationMessage {
  type: "idle_notification";
  from: string;
  timestamp: string;
  idleReason: string;
  summary?: string;
  completedTaskId?: string;
  completedStatus?: string;
  failureReason?: string;
}

export interface PlanApprovalRequestMessage {
  type: "plan_approval_request";
  requestId: string;
  from: string;
  planContent?: string;
  timestamp: string;
}

export interface PlanApprovalResponseMessage {
  type: "plan_approval_response";
  requestId: string;
  from: string;
  approved: boolean;
  feedback?: string;
  timestamp: string;
}

export interface PermissionRequestMessage {
  type: "permission_request";
  requestId: string;
  from: string;
  toolName: string;
  toolUseId?: string;
  description: string;
  input?: unknown;
  permissionSuggestions?: string[];
  timestamp: string;
}

export interface PermissionResponseMessage {
  type: "permission_response";
  requestId: string;
  from: string;
  approved: boolean;
  timestamp: string;
}

export interface TaskCompletedMessage {
  type: "task_completed";
  from: string;
  taskId: string;
  taskSubject: string;
  timestamp: string;
}

export interface SandboxPermissionRequestMessage {
  type: "sandbox_permission_request";
  requestId: string;
  workerId: string;
  workerName: string;
  workerColor?: string;
  hostPattern: string;
  timestamp: string;
}

export interface SandboxPermissionResponseMessage {
  type: "sandbox_permission_response";
  requestId: string;
  host: string;
  allow: boolean;
  timestamp: string;
}

export interface PlainTextMessage {
  type: "plain_text";
  text: string;
}

// ─── StatusLine ──────────────────────────────────────────────────────────────

/** JSON data sent by Claude Code to the statusLine command via stdin. */
export interface StatusLineData {
  model?: {
    id?: string;
    display_name?: string;
  };
  session_id?: string;
  context_window?: {
    used_percentage?: number;
    remaining_percentage?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
  };
  cwd?: string;
  agent?: {
    name?: string;
  };
  vim?: {
    mode?: string;
  };
  output_style?: {
    name?: string;
  };
}

// ─── Team ────────────────────────────────────────────────────────────────────

export interface TeamConfig {
  name: string;
  description?: string;
  createdAt: number; // epoch ms
  leadAgentId: string; // format: name@teamName
  leadSessionId: string; // UUID
  members: TeamMember[];
}

export interface TeamMember {
  agentId: string; // format: name@teamName
  name: string;
  agentType: string;
  model?: string;
  prompt?: string;
  color?: string;
  planModeRequired?: boolean;
  joinedAt: number; // epoch ms
  tmuxPaneId?: string;
  cwd: string;
  subscriptions?: string[];
  backendType?: string; // "in-process" | "tmux" | "iterm2"
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface TaskFile {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
}

export type TaskStatus = "pending" | "in_progress" | "completed";

// ─── Controller Options ──────────────────────────────────────────────────────

export type AgentType =
  | "general-purpose"
  | "Bash"
  | "Explore"
  | "Plan"
  | "claude-code-guide"
  | "statusline-setup"
  | string;

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "delegate";

export interface SpawnAgentOptions {
  name: string;
  type?: AgentType;
  model?: string; // "sonnet" | "opus" | "haiku" | full model id
  cwd?: string;
  prompt?: string;
  permissions?: string[]; // e.g. ["Bash", "Read", "Write"]
  permissionMode?: PermissionMode;
  /** Environment variables to inject into the agent's process */
  env?: Record<string, string>;
}

export interface ControllerOptions {
  teamName?: string;
  cwd?: string;
  claudeBinary?: string; // path to claude binary, default "claude"
  logger?: Logger;
  /** Default environment variables for all spawned agents */
  env?: Record<string, string>;
}

export interface ReceiveOptions {
  timeout?: number; // ms, default 60_000
  pollInterval?: number; // ms, default 500
  /** If true, return all unread messages, not just the first one */
  all?: boolean;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ControllerEvents {
  message: [agentName: string, message: InboxMessage];
  idle: [agentName: string, details: IdleNotificationMessage];
  "shutdown:approved": [agentName: string, message: ShutdownApprovedMessage];
  "plan:approval_request": [agentName: string, message: PlanApprovalRequestMessage];
  "permission:request": [agentName: string, message: PermissionRequestMessage];
  "task:completed": [task: TaskFile];
  "agent:spawned": [agentName: string, pid: number];
  "agent:exited": [agentName: string, code: number | null];
  "agent:statusline": [agentName: string, data: StatusLineData];
  error: [error: Error];
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}
