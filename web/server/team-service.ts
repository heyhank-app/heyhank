import { randomUUID } from "crypto";
import * as teamStore from "./team-store.js";
import * as agentStore from "./agent-store.js";
import type { Team, TeamStatus, TeamState } from "./team-types.js";

const COORDINATOR_SYSTEM_PROMPT = `You are the Team Coordinator for HeyHank. You coordinate parallel agent teams to accomplish complex goals.

## Your Goal
{{goal}}

## Team Info
- Team ID: {{teamId}}
- Repo: {{repoRoot}}
- Base branch: {{baseBranch}}
- Team branch: {{teamBranch}}
- Suggested agents: {{suggestedAgents}}

## Available Agents
{{availableAgents}}

## API Reference
Base URL: {{apiBase}}
All requests need: Authorization: Bearer {{authToken}}

### List agents
curl -s -H "Authorization: Bearer {{authToken}}" {{apiBase}}/api/agents | jq '.[] | {id, name, description}'

### Create a new agent
curl -s -X POST -H "Authorization: Bearer {{authToken}}" -H "Content-Type: application/json" {{apiBase}}/api/agents -d '{
  "name": "Agent Name",
  "description": "What this agent does",
  "backendType": "claude",
  "model": "claude-sonnet-4-20250514",
  "prompt": "Your system prompt here",
  "cwd": "/path/to/worktree",
  "permissionMode": "bypassPermissions"
}'

### Run an agent (start a task)
curl -s -X POST -H "Authorization: Bearer {{authToken}}" -H "Content-Type: application/json" {{apiBase}}/api/agents/{agentId}/run -d '{
  "input": "The task description",
  "cwd": "/path/to/worktree"
}'
Response: { "sessionId": "..." }

### Monitor an agent session
curl -s -H "Authorization: Bearer {{authToken}}" {{apiBase}}/api/sessions/{sessionId}/agent-status
Response: { "isCompleted": bool, "isWorking": bool, "needsInput": bool, "recentActivity": [...] }

### Update team task status
curl -s -X PUT -H "Authorization: Bearer {{authToken}}" -H "Content-Type: application/json" {{apiBase}}/api/teams/{{teamId}}/tasks/{taskId} -d '{
  "state": "running|completed|failed",
  "sessionId": "...",
  "agentId": "...",
  "agentName": "..."
}'

### Complete team
curl -s -X POST -H "Authorization: Bearer {{authToken}}" -H "Content-Type: application/json" {{apiBase}}/api/teams/{{teamId}}/complete -d '{
  "result": "Summary of what was accomplished"
}'

### Fail team
curl -s -X POST -H "Authorization: Bearer {{authToken}}" -H "Content-Type: application/json" {{apiBase}}/api/teams/{{teamId}}/fail -d '{
  "error": "What went wrong"
}'

## Your Workflow

### Step 1: PLAN
Analyze the goal. Break it into independent, parallelizable tasks. Consider:
- What needs to be done?
- Which tasks can run in parallel vs which have dependencies?
- Which existing agent fits each task? If none fits, create a new specialized agent.

### Step 2: PREPARE
For each task, create a git worktree for isolation:
\`\`\`bash
cd {{repoRoot}}
git worktree add -b task-{taskId} .worktrees/task-{taskId} {{baseBranch}}
\`\`\`

### Step 3: ASSIGN & START
For each task:
1. Choose or create an agent
2. Start the agent with cwd set to the worktree path
3. Update the task status via the API
4. Record the sessionId

### Step 4: MONITOR
Poll each running session every 10 seconds:
\`\`\`bash
curl -s -H "Authorization: Bearer {{authToken}}" {{apiBase}}/api/sessions/{sessionId}/agent-status
\`\`\`
- If \`needsInput\` is true: check what the agent needs, provide it via send_message
- If \`isCompleted\` is true: mark task as completed
- If there's an error: mark task as failed

### Step 5: MERGE
When all tasks are completed:
\`\`\`bash
cd {{repoRoot}}
git checkout {{baseBranch}}
git checkout -b {{teamBranch}}
# Merge each task branch
git merge --no-ff task-{taskId1} -m "Merge task: {description}"
git merge --no-ff task-{taskId2} -m "Merge task: {description}"
# If merge conflict: attempt to resolve, or report in team failure
\`\`\`

### Step 6: CLEANUP & REPORT
\`\`\`bash
# Remove worktrees
git worktree remove .worktrees/task-{taskId1}
git worktree remove .worktrees/task-{taskId2}
# Delete task branches
git branch -d task-{taskId1}
git branch -d task-{taskId2}
\`\`\`
Then call the complete endpoint with a summary of what was accomplished.

## Important Rules
- Always use worktrees for isolation — never let two agents edit the same working directory
- Create new agents when no existing agent fits a task — don't force a mismatch
- Monitor agents actively — check every 10 seconds
- If an agent fails, try to recover (restart or reassign) before failing the team
- Keep the team status updated via the API so Hank can monitor progress
- After merging, verify the result compiles/builds if applicable
`;

export function createTeam(opts: {
  goal: string;
  repoRoot: string;
  baseBranch?: string;
  suggestedAgents?: string[];
}): Team {
  const teamId = `team-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const team: Team = {
    id: teamId,
    goal: opts.goal,
    state: "pending",
    coordinatorSessionId: null,
    tasks: [],
    suggestedAgents: opts.suggestedAgents || [],
    repoRoot: opts.repoRoot,
    baseBranch: opts.baseBranch || "main",
    teamBranch: `team/${teamId}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  teamStore.createTeam(team);
  return team;
}

export function getTeam(teamId: string): Team | null {
  return teamStore.getTeam(teamId);
}

export function listTeams(): Team[] {
  return teamStore.listTeams();
}

export function deleteTeam(teamId: string): boolean {
  return teamStore.deleteTeam(teamId);
}

export function getTeamStatus(teamId: string): TeamStatus | null {
  const team = teamStore.getTeam(teamId);
  if (!team) return null;
  return {
    id: team.id,
    goal: team.goal,
    state: team.state,
    tasksTotal: team.tasks.length,
    tasksCompleted: team.tasks.filter((t) => t.state === "completed").length,
    tasksFailed: team.tasks.filter((t) => t.state === "failed").length,
    tasksRunning: team.tasks.filter((t) => t.state === "running").length,
    tasks: team.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      agentName: t.agentName,
      state: t.state,
    })),
    result: team.result,
    error: team.error,
  };
}

export function updateTeamState(teamId: string, state: TeamState, extra?: Partial<Team>): Team | null {
  return teamStore.updateTeam(teamId, { state, updatedAt: Date.now(), ...extra });
}

export function updateTask(teamId: string, taskId: string, updates: Record<string, unknown>): Team | null {
  const team = teamStore.getTeam(teamId);
  if (!team) return null;
  const task = team.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  Object.assign(task, updates);
  team.updatedAt = Date.now();
  return teamStore.updateTeam(teamId, { tasks: team.tasks, updatedAt: team.updatedAt });
}

export function buildCoordinatorPrompt(team: Team, apiBase: string, authToken: string): string {
  const agents = agentStore.listAgents().filter((a) => a.enabled);
  const agentList = agents
    .map((a) => `- "${a.name}" (${a.backendType}): ${a.description || "no description"}`)
    .join("\n");

  return COORDINATOR_SYSTEM_PROMPT
    .replace(/\{\{teamId\}\}/g, team.id)
    .replace(/\{\{goal\}\}/g, team.goal)
    .replace(/\{\{repoRoot\}\}/g, team.repoRoot)
    .replace(/\{\{baseBranch\}\}/g, team.baseBranch)
    .replace(/\{\{teamBranch\}\}/g, team.teamBranch)
    .replace(/\{\{apiBase\}\}/g, apiBase)
    .replace(/\{\{authToken\}\}/g, authToken)
    .replace(/\{\{availableAgents\}\}/g, agentList)
    .replace(/\{\{suggestedAgents\}\}/g, team.suggestedAgents.join(", ") || "none");
}

export function ensureCoordinatorAgent(): string {
  const agents = agentStore.listAgents();
  const existing = agents.find((a) => a.name === "Team Coordinator");
  if (existing) return existing.id;

  const config = {
    name: "Team Coordinator",
    description: "Coordinates parallel agent teams. Breaks goals into tasks, creates worktrees, assigns agents, monitors progress, and merges results.",
    backendType: "claude" as const,
    model: "claude-sonnet-4-20250514",
    permissionMode: "bypassPermissions",
    prompt: "System prompt is injected at runtime via team-service.buildCoordinatorPrompt()",
    enabled: true,
    cwd: "",
    version: 1 as const,
  };
  const agent = agentStore.createAgent(config);
  return agent.id;
}
