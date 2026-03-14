import { AgentIcon } from "./AgentIcon.js";
import type { AgentInfo } from "../api.js";
import { timeAgo } from "../utils/time-ago.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function humanizeSchedule(expression: string, recurring: boolean): string {
  if (!recurring) return "One-time";
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;
  const [minute, hour, , , dayOfWeek] = parts;
  if (expression === "* * * * *") return "Every minute";
  if (hour === "*" && minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  if (minute === "0" && hour === "*") return "Every hour";
  if (minute === "0" && hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }
  if (minute !== "*" && hour !== "*" && !hour.includes("/") && !hour.includes(",")) {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayMin = m.toString().padStart(2, "0");
      const timeStr = `${displayHour}:${displayMin} ${period}`;
      if (dayOfWeek === "*") return `Daily at ${timeStr}`;
      if (dayOfWeek === "1-5") return `Weekdays at ${timeStr}`;
    }
  }
  return expression;
}

export function getWebhookUrl(agent: AgentInfo, publicUrl: string): string {
  const base = publicUrl || window.location.origin;
  return `${base}/api/agents/${encodeURIComponent(agent.id)}/webhook/${agent.triggers?.webhook?.secret || ""}`;
}

// ─── Agent Card ─────────────────────────────────────────────────────────────

export function AgentCard({
  agent,
  publicUrl,
  onEdit,
  onDelete,
  onToggle,
  onRun,
  onExport,
  onCopyWebhook,
  onRegenerateSecret,
  copiedWebhook,
}: {
  agent: AgentInfo;
  publicUrl: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onRun: () => void;
  onExport: () => void;
  onCopyWebhook: () => void;
  onRegenerateSecret: () => void;
  copiedWebhook: string | null;
}) {
  const triggers: string[] = ["Manual"];
  if (agent.triggers?.webhook?.enabled) triggers.push("Webhook");
  if (agent.triggers?.schedule?.enabled) {
    triggers.push(humanizeSchedule(
      agent.triggers.schedule.expression,
      agent.triggers.schedule.recurring,
    ));
  }
  if (agent.triggers?.linear?.enabled) triggers.push("Linear Agent");

  return (
    <div className="rounded-xl border border-cc-border bg-cc-card p-4 hover:border-cc-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 text-cc-primary">
            <AgentIcon icon={agent.icon || "bot"} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-cc-fg truncate">{agent.name}</h3>
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${agent.enabled ? "bg-cc-success/15 text-cc-success" : "bg-cc-muted/15 text-cc-muted"}`}>
                {agent.enabled ? "Enabled" : "Disabled"}
              </span>
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cc-hover text-cc-muted">
                {agent.backendType === "codex" ? "Codex" : "Claude"}
              </span>
            </div>
            {agent.description && (
              <p className="text-xs text-cc-muted mt-0.5 truncate">{agent.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          <button
            onClick={onRun}
            className="px-2.5 py-1 text-xs rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
            title="Run agent"
          >
            Run
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            title="Edit"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61z" />
            </svg>
          </button>
          <button
            onClick={onExport}
            className="p-1.5 rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            title="Export JSON"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M3.5 13a.5.5 0 01-.5-.5V11h1v1h8v-1h1v1.5a.5.5 0 01-.5.5h-9zM8 2a.5.5 0 01.5.5v6.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 01.708-.708L7.5 9.293V2.5A.5.5 0 018 2z" />
            </svg>
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            title={agent.enabled ? "Disable" : "Enable"}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              {agent.enabled ? (
                <path d="M5 3a5 5 0 000 10h6a5 5 0 000-10H5zm6 3a2 2 0 110 4 2 2 0 010-4z" />
              ) : (
                <path d="M11 3a5 5 0 010 10H5A5 5 0 015 3h6zM5 6a2 2 0 100 4 2 2 0 000-4z" />
              )}
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-cc-muted hover:text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer"
            title="Delete"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M5.5 5.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm-7-3A1.5 1.5 0 015 1h6a1.5 1.5 0 011.5 1.5H14a.5.5 0 010 1h-.554L12.2 14.118A1.5 1.5 0 0110.706 15H5.294a1.5 1.5 0 01-1.494-.882L2.554 3.5H2a.5.5 0 010-1h1.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Trigger badges + stats */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-cc-border/50">
        <div className="flex items-center gap-1.5 flex-wrap">
          {triggers.map((t, i) => (
            <span key={i} className="px-2 py-0.5 text-[10px] rounded-full bg-cc-hover text-cc-muted">
              {t}
            </span>
          ))}
          {agent.triggers?.webhook?.enabled && (
            <button
              onClick={onCopyWebhook}
              className="px-2 py-0.5 text-[10px] rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
              title="Copy webhook URL"
            >
              {copiedWebhook === agent.id ? "Copied!" : "Copy URL"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-cc-muted">
          {agent.totalRuns > 0 && <span>{agent.totalRuns} run{agent.totalRuns !== 1 ? "s" : ""}</span>}
          {agent.lastRunAt && <span>Last: {timeAgo(agent.lastRunAt)}</span>}
          {agent.nextRunAt && <span>Next: {timeAgo(agent.nextRunAt)}</span>}
        </div>
      </div>
    </div>
  );
}
