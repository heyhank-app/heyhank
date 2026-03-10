// ─── Linear System Prompt Builder ─────────────────────────────────────────────
//
// Builds a system prompt snippet that tells Claude Code / Codex about the
// LINEAR_API_KEY environment variable and the linked Linear issue context.
// This is injected via the `initialize` control request's `appendSystemPrompt`
// field (Claude Code) or the `instructions` field in `thread/start` (Codex).

interface LinearConnectionContext {
  workspaceName: string;
  viewerName: string;
  viewerEmail: string;
}

interface LinearIssueContext {
  identifier: string;
  title: string;
  stateName: string;
  teamName: string;
  url: string;
}

export function buildLinearSystemPrompt(
  connection: LinearConnectionContext,
  issue?: LinearIssueContext,
): string {
  const lines = [
    "You have access to the Linear API via the LINEAR_API_KEY environment variable.",
    `Connected workspace: "${connection.workspaceName}" (viewer: ${connection.viewerName}, ${connection.viewerEmail})`,
  ];
  if (issue) {
    lines.push(
      `Linked issue: ${issue.identifier} — "${issue.title}" (status: ${issue.stateName}, team: ${issue.teamName})`,
    );
    lines.push(`Issue URL: ${issue.url}`);
  }
  lines.push("");
  lines.push(
    "You can use this key to call the Linear GraphQL API at https://api.linear.app/graphql.",
  );
  lines.push(
    "Use the Authorization header: `Authorization: Bearer $LINEAR_API_KEY`",
  );
  lines.push(
    "Common operations: add comments, transition issue status, read issue details, update issue fields.",
  );
  return lines.join("\n");
}
