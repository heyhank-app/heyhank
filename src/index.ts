// Simplified API (recommended)
export { claude, Agent, Session } from "./claude.js";
export type {
  ClaudeOptions,
  AskOptions,
  SessionOptions,
  SessionAgentOptions,
  PermissionPreset,
  PermissionRequestInfo,
  PlanRequestInfo,
  AgentEvents,
} from "./claude.js";

// Full API (advanced usage)
export { ClaudeCodeController } from "./controller.js";
export { AgentHandle } from "./agent-handle.js";

// Managers (for advanced usage)
export { TeamManager } from "./team-manager.js";
export { TaskManager } from "./task-manager.js";
export { ProcessManager } from "./process-manager.js";
export { InboxPoller } from "./inbox-poller.js";

// Low-level inbox operations
export { writeInbox, readInbox, readUnread, parseMessage } from "./inbox.js";

// Path utilities
export * from "./paths.js";

// Logger
export { createLogger, silentLogger } from "./logger.js";

// Types
export type {
  InboxMessage,
  StructuredMessage,
  TaskAssignmentMessage,
  ShutdownRequestMessage,
  ShutdownApprovedMessage,
  IdleNotificationMessage,
  PlanApprovalRequestMessage,
  PlanApprovalResponseMessage,
  PermissionRequestMessage,
  PermissionResponseMessage,
  PlainTextMessage,
  TeamConfig,
  TeamMember,
  TaskFile,
  TaskStatus,
  AgentType,
  PermissionMode,
  SpawnAgentOptions,
  ControllerOptions,
  ReceiveOptions,
  ControllerEvents,
  LogLevel,
  Logger,
} from "./types.js";
