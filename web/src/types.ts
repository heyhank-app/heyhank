export interface AgentInfo {
  name: string;
  type: string;
  model?: string;
  pid?: number;
  status: "running" | "idle" | "exited";
  exitCode?: number | null;
  spawnedAt: number;
}

export interface Approval {
  id: string;
  agent: string;
  type: "plan" | "permission";
  timestamp: string;
  planContent?: string;
  toolName?: string;
  description?: string;
}

export interface Message {
  id: string;
  from: string;
  text: string;
  timestamp: string;
  summary?: string;
  isSystem?: boolean;
}

export interface SessionInfo {
  initialized: boolean;
  teamName: string;
}
