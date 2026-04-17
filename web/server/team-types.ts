export type TeamState = "pending" | "planning" | "running" | "merging" | "completed" | "failed";
export type TaskState = "pending" | "assigned" | "running" | "completed" | "failed";

export interface TeamTask {
  id: string;
  description: string;
  agentId: string | null;
  agentName: string | null;
  sessionId: string | null;
  branch: string;
  worktreePath: string | null;
  state: TaskState;
  dependsOn: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface Team {
  id: string;
  goal: string;
  state: TeamState;
  coordinatorSessionId: string | null;
  tasks: TeamTask[];
  suggestedAgents: string[];
  repoRoot: string;
  baseBranch: string;
  teamBranch: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface TeamStatus {
  id: string;
  goal: string;
  state: TeamState;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksRunning: number;
  tasks: Array<{
    id: string;
    description: string;
    agentName: string | null;
    state: TaskState;
  }>;
  result?: string;
  error?: string;
}
