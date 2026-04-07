import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AgentInfo, type AgentExport } from "../api.js";
import { useStore } from "../store.js";
import { PublicUrlBanner } from "./PublicUrlBanner.js";
import type { Route } from "../utils/routing.js";
import { AgentIcon } from "./AgentIcon.js";
import { AgentCard, getWebhookUrl } from "./AgentCard.js";
import { AgentEditor, type AgentFormData, EMPTY_FORM } from "./AgentEditor.js";

// ─── Filter types ────────────────────────────────────────────────────────────

type AgentFilter = "all" | "scheduled" | "webhook";

const FILTER_LABELS: Record<AgentFilter, string> = {
  all: "All",
  scheduled: "Scheduled",
  webhook: "Webhook",
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  route: Route;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AgentsPage({ route }: Props) {
  const publicUrl = useStore((s) => s.publicUrl);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "pick-template" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [runInputAgent, setRunInputAgent] = useState<AgentInfo | null>(null);
  const [runInput, setRunInput] = useState("");
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<AgentFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load agents
  const loadAgents = useCallback(async () => {
    try {
      const list = await api.listAgents();
      setAgents(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Handle route-based navigation to agent detail
  useEffect(() => {
    if (route.page === "agent-detail" && "agentId" in route) {
      const agent = agents.find((a) => a.id === route.agentId);
      if (agent) {
        startEdit(agent);
      }
    }
  }, [route, agents]);

  // ── Form helpers ──

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setView("pick-template");
  }

  function startCreateFromTemplate(template: AgentFormData) {
    setEditingId(null);
    setForm(template);
    setError("");
    setView("edit");
  }

  function startEdit(agent: AgentInfo) {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      description: agent.description,
      icon: agent.icon || "",
      backendType: agent.backendType,
      model: agent.model,
      permissionMode: agent.permissionMode,
      cwd: agent.cwd === "temp" ? "" : agent.cwd,
      prompt: agent.prompt,
      envSlug: agent.envSlug || "",
      env: agent.env
        ? Object.entries(agent.env).map(([key, value]) => ({ key, value }))
        : [],
      codexInternetAccess: agent.codexInternetAccess ?? false,
      branch: agent.branch || "",
      createBranch: agent.createBranch ?? false,
      useWorktree: agent.useWorktree ?? false,
      mcpServers: agent.mcpServers || {},
      skills: agent.skills || [],
      allowedTools: agent.allowedTools || [],
      webhookEnabled: agent.triggers?.webhook?.enabled ?? false,
      scheduleEnabled: agent.triggers?.schedule?.enabled ?? false,
      scheduleExpression: agent.triggers?.schedule?.expression || "0 8 * * *",
      scheduleRecurring: agent.triggers?.schedule?.recurring ?? true,
    });
    setError("");
    setView("edit");
  }

  function cancelEdit() {
    setView("list");
    setEditingId(null);
    setError("");
    window.location.hash = "#/agents";
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      // Build env record from key-value pairs, omitting empty keys
      const envRecord: Record<string, string> = {};
      for (const { key, value } of form.env) {
        if (key.trim()) envRecord[key.trim()] = value;
      }

      const data: Partial<AgentInfo> = {
        version: 1,
        name: form.name,
        description: form.description,
        icon: form.icon || undefined,
        backendType: form.backendType,
        model: form.model,
        permissionMode: form.permissionMode,
        cwd: form.cwd || "temp",
        prompt: form.prompt,
        envSlug: form.envSlug || undefined,
        env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        codexInternetAccess: form.backendType === "codex" ? form.codexInternetAccess : undefined,
        branch: form.branch || undefined,
        createBranch: form.branch ? form.createBranch : undefined,
        useWorktree: form.branch ? form.useWorktree : undefined,
        mcpServers: Object.keys(form.mcpServers).length > 0 ? form.mcpServers : undefined,
        skills: form.skills.length > 0 ? form.skills : undefined,
        allowedTools: form.allowedTools.length > 0 ? form.allowedTools : undefined,
        enabled: true,
        triggers: {
          webhook: { enabled: form.webhookEnabled, secret: "" },
          schedule: {
            enabled: form.scheduleEnabled,
            expression: form.scheduleExpression,
            recurring: form.scheduleRecurring,
          },
        },
      };

      if (editingId) {
        await api.updateAgent(editingId, data);
      } else {
        await api.createAgent(data);
      }

      await loadAgents();
      setView("list");
      setEditingId(null);
      window.location.hash = "#/agents";
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this agent?")) return;
    try {
      await api.deleteAgent(id);
      await loadAgents();
    } catch {
      // ignore
    }
  }

  async function handleToggle(id: string) {
    try {
      await api.toggleAgent(id);
      await loadAgents();
    } catch {
      // ignore
    }
  }

  async function handleRun(agent: AgentInfo, input?: string) {
    try {
      await api.runAgent(agent.id, input);
      setRunInputAgent(null);
      setRunInput("");
      await loadAgents();
    } catch {
      // ignore
    }
  }

  function handleRunClick(agent: AgentInfo) {
    if (agent.prompt.includes("{{input}}")) {
      setRunInputAgent(agent);
      setRunInput("");
    } else {
      handleRun(agent);
    }
  }

  async function handleExport(agent: AgentInfo) {
    try {
      const exported = await api.exportAgent(agent.id);
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${agent.id}.agent.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as AgentExport;
      await api.importAgent(data);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import agent");
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function copyWebhookUrl(agent: AgentInfo) {
    const url = getWebhookUrl(agent, publicUrl);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedWebhook(agent.id);
      setTimeout(() => setCopiedWebhook(null), 2000);
    });
  }

  async function handleRegenerateSecret(id: string) {
    if (!confirm("Regenerate webhook secret? The old URL will stop working.")) return;
    try {
      await api.regenerateAgentWebhookSecret(id);
      await loadAgents();
    } catch {
      // ignore
    }
  }

  // ── Render ──

  if (view === "pick-template") {
    return (
      <AgentTemplatePicker
        onSelect={startCreateFromTemplate}
        onBlank={() => { setForm(EMPTY_FORM); setView("edit"); }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "edit") {
    return <AgentEditor
      form={form}
      setForm={setForm}
      editingId={editingId}
      publicUrl={publicUrl}
      error={error}
      saving={saving}
      onSave={handleSave}
      onCancel={cancelEdit}
    />;
  }

  // ── Filtering ──

  const filterCounts: Record<AgentFilter, number> = {
    all: agents.length,
    scheduled: agents.filter(a => a.triggers?.schedule?.enabled).length,
    webhook: agents.filter(a => a.triggers?.webhook?.enabled).length,
  };

  const filteredAgents = agents.filter(agent => {
    switch (activeFilter) {
      case "scheduled": return agent.triggers?.schedule?.enabled === true;
      case "webhook": return agent.triggers?.webhook?.enabled === true;
      default: return true;
    }
  });

  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-cc-fg">Agents</h1>
            <p className="text-xs text-cc-muted mt-0.5">Reusable autonomous session configs. Run manually, via webhook, or on a schedule.</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Import
            </button>
            <button
              onClick={startCreate}
              className="px-3 py-1.5 text-xs rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
            >
              + New Agent
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/30 text-cc-error text-xs">
            {error}
          </div>
        )}

        <PublicUrlBanner publicUrl={publicUrl} />

        {/* Filter tabs */}
        {!loading && agents.length > 0 && (
          <div className="flex items-center gap-1 mb-4" data-testid="filter-tabs">
            {(["all", "scheduled", "webhook"] as AgentFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                  activeFilter === f
                    ? "bg-cc-fg text-cc-bg"
                    : "bg-cc-hover text-cc-muted hover:text-cc-fg"
                }`}
              >
                {FILTER_LABELS[f]} ({filterCounts[f]})
              </button>
            ))}
          </div>
        )}

        {/* Agent Cards */}
        {loading ? (
          <div className="text-sm text-cc-muted">Loading...</div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16">
            <div className="mb-3 flex justify-center text-cc-muted">
              <AgentIcon icon="bot" className="w-8 h-8" />
            </div>
            <p className="text-sm text-cc-muted">No agents yet</p>
            <p className="text-xs text-cc-muted mt-1">Create an agent to get started, or import a shared JSON config.</p>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-cc-muted">No {FILTER_LABELS[activeFilter].toLowerCase()} agents</p>
            <p className="text-xs text-cc-muted mt-1">
              {activeFilter === "scheduled" && "Create an agent with a schedule trigger to see it here."}
              {activeFilter === "webhook" && "Create an agent with a webhook trigger to see it here."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                publicUrl={publicUrl}
                onEdit={() => startEdit(agent)}
                onDelete={() => handleDelete(agent.id)}
                onToggle={() => handleToggle(agent.id)}
                onRun={() => handleRunClick(agent)}
                onExport={() => handleExport(agent)}
                onCopyWebhook={() => copyWebhookUrl(agent)}
                onRegenerateSecret={() => handleRegenerateSecret(agent.id)}
                copiedWebhook={copiedWebhook}
              />
            ))}
          </div>
        )}
      </div>

      {/* Run Input Modal */}
      {runInputAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setRunInputAgent(null)}
        >
          <div
            className="bg-cc-card rounded-[14px] shadow-2xl p-6 w-full max-w-lg border border-cc-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-cc-fg mb-1">Run {runInputAgent.name}</h3>
            <p className="text-xs text-cc-muted mb-3">This agent's prompt uses {"{{input}}"} — provide the input below.</p>
            <textarea
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              placeholder="Enter input for the agent..."
              className="w-full px-3 py-2 rounded-lg bg-cc-input-bg border border-cc-border text-cc-fg text-sm resize-none h-24 focus:outline-none focus:ring-1 focus:ring-cc-primary"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setRunInputAgent(null)}
                className="px-3 py-1.5 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRun(runInputAgent, runInput)}
                className="px-3 py-1.5 text-xs rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agent Templates ──────────────────────────────────────────────────────

interface AgentTemplate {
  name: string;
  icon: string;
  description: string;
  color: string;
  form: Partial<AgentFormData>;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "Coding Agent",
    icon: "code",
    description: "Develops features, fixes bugs, writes tests. Full file and terminal access.",
    color: "text-blue-400",
    form: {
      name: "Coding Agent",
      description: "Develops features, fixes bugs, writes tests",
      icon: "code",
      prompt: "You are a coding agent. Help the user with software development tasks: writing code, fixing bugs, refactoring, writing tests, and code reviews. Be thorough and follow best practices.",
      permissionMode: "acceptEdits",
    },
  },
  {
    name: "Monitoring Agent",
    icon: "activity",
    description: "Checks server health: CPU, RAM, disk, Docker, PM2. Great for cron schedules.",
    color: "text-green-400",
    form: {
      name: "Monitoring Agent",
      description: "Checks server health and reports issues",
      icon: "activity",
      prompt: "You are a monitoring agent. Check server health: CPU usage, RAM, disk space, running processes (PM2, Docker), and network status. Report any issues found. Be concise and actionable.",
      permissionMode: "plan",
    },
  },
  {
    name: "Content Agent",
    icon: "pen-tool",
    description: "Creates social media posts, generates images and videos via Gemini.",
    color: "text-pink-400",
    form: {
      name: "Content Agent",
      description: "Creates social media content, images, and videos",
      icon: "pen-tool",
      prompt: "You are a content creation agent. Help create social media posts, marketing copy, blog articles, and visual content. You can generate images with Imagen and videos with Veo. Be creative and on-brand.",
    },
  },
  {
    name: "Research Agent",
    icon: "search",
    description: "Researches topics, summarizes findings, gathers competitive intelligence.",
    color: "text-purple-400",
    form: {
      name: "Research Agent",
      description: "Researches topics and summarizes findings",
      icon: "search",
      prompt: "You are a research agent. Help the user research topics thoroughly: gather information, analyze data, compare options, and provide well-structured summaries with sources. Be objective and comprehensive.",
    },
  },
  {
    name: "DevOps Agent",
    icon: "server",
    description: "Manages deployments, CI/CD, Docker, Nginx, SSL certificates.",
    color: "text-orange-400",
    form: {
      name: "DevOps Agent",
      description: "Manages deployments, infrastructure, and CI/CD",
      icon: "server",
      prompt: "You are a DevOps agent. Help with server management, deployments, CI/CD pipelines, Docker, Nginx configuration, SSL certificates, and infrastructure automation. Prioritize security and reliability.",
      permissionMode: "acceptEdits",
    },
  },
  {
    name: "Data Agent",
    icon: "database",
    description: "Analyzes data, writes SQL queries, creates reports and visualizations.",
    color: "text-yellow-400",
    form: {
      name: "Data Agent",
      description: "Analyzes data and creates reports",
      icon: "database",
      prompt: "You are a data analysis agent. Help with SQL queries, data analysis, creating reports, and data visualization. Be precise with numbers and provide clear insights.",
    },
  },
];

function AgentTemplatePicker({
  onSelect,
  onBlank,
  onCancel,
}: {
  onSelect: (form: AgentFormData) => void;
  onBlank: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-cc-fg">New Agent</h1>
            <p className="text-xs text-cc-muted mt-1">Start from a template or create from scratch.</p>
          </div>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Blank agent */}
        <button
          onClick={onBlank}
          className="w-full mb-4 p-4 rounded-xl border-2 border-dashed border-cc-border hover:border-cc-primary/50 bg-cc-card hover:bg-cc-hover transition-colors text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cc-hover flex items-center justify-center text-cc-muted group-hover:text-cc-fg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-cc-fg">Blank Agent</div>
              <div className="text-xs text-cc-muted">Start with an empty configuration</div>
            </div>
          </div>
        </button>

        {/* Templates grid */}
        <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">Templates</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AGENT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              onClick={() => onSelect({ ...EMPTY_FORM, ...tpl.form })}
              className="p-4 rounded-xl border border-cc-border bg-cc-card hover:bg-cc-hover hover:border-cc-primary/30 transition-colors text-left"
            >
              <div className={`text-sm font-medium ${tpl.color}`}>{tpl.name}</div>
              <div className="text-xs text-cc-muted mt-1 line-clamp-2">{tpl.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

