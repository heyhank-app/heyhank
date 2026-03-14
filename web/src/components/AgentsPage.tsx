import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AgentInfo, type AgentExport } from "../api.js";
import { useStore } from "../store.js";
import { PublicUrlBanner } from "./PublicUrlBanner.js";
import { WizardStepIndicator } from "./wizard/WizardStepIndicator.js";
import { WizardStepIntro } from "./wizard/WizardStepIntro.js";
import { WizardStepCredentials } from "./wizard/WizardStepCredentials.js";
import { WizardStepInstall } from "./wizard/WizardStepInstall.js";
import { WizardStepAgent } from "./wizard/WizardStepAgent.js";
import { WizardStepDone } from "./wizard/WizardStepDone.js";
import { LinearLogo } from "./LinearLogo.js";
import type { Route } from "../utils/routing.js";
import { AgentIcon } from "./AgentIcon.js";
import { AgentCard, getWebhookUrl } from "./AgentCard.js";
import { AgentEditor, type AgentFormData, EMPTY_FORM } from "./AgentEditor.js";
import { LinearAgentEditor } from "./LinearAgentEditor.js";
import { LinearAgentSection } from "./LinearAgentSection.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  route: Route;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AgentsPage({ route }: Props) {
  const publicUrl = useStore((s) => s.publicUrl);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "edit" | "edit-linear" | "setup-linear">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [runInputAgent, setRunInputAgent] = useState<AgentInfo | null>(null);
  const [runInput, setRunInput] = useState("");
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);
  const [linearOAuthConfigured, setLinearOAuthConfigured] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Linear wizard state ──
  type WizardStep = 1 | 2 | 3 | 4 | 5;
  const WIZARD_STEPS = [
    { label: "Intro" },
    { label: "Credentials" },
    { label: "Install" },
    { label: "Agent" },
    { label: "Done" },
  ];
  const WIZARD_STORAGE_KEY = "companion_linear_wizard_state";

  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [wizardCredentialsSaved, setWizardCredentialsSaved] = useState(false);
  const [wizardOauthConnected, setWizardOauthConnected] = useState(false);
  const [wizardOauthError, setWizardOauthError] = useState("");
  const [wizardAgentName, setWizardAgentName] = useState("");
  const [wizardCreatedAgentId, setWizardCreatedAgentId] = useState<string | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardEditingAgent, setWizardEditingAgent] = useState<AgentInfo | null>(null);

  // linearOAuthConfigured is derived from agents list in loadAgents below

  // Check hash for wizard entry params (OAuth return or IntegrationsPage link)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("oauth_success=true") || hash.includes("oauth_error=") || hash.includes("setup=linear")) {
      startLinearSetup();
      // Clean hash params without triggering a hashchange (which would remount and lose wizard state)
      history.replaceState(null, "", "#/agents");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load agents
  const loadAgents = useCallback(async () => {
    try {
      const list = await api.listAgents();
      setAgents(list);
      // Derive linearOAuthConfigured from agents: true if any Linear agent has an access token
      const hasLinearAgent = list.some(a => a.triggers?.linear?.enabled && a.triggers?.linear?.hasAccessToken);
      setLinearOAuthConfigured(hasLinearAgent);
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
      linearEnabled: agent.triggers?.linear?.enabled ?? false,
    });
    setError("");
    // Route Linear agents to the dedicated editor
    if (agent.triggers?.linear?.enabled) {
      setView("edit-linear");
    } else {
      setView("edit");
    }
  }

  function cancelEdit() {
    setView("list");
    setEditingId(null);
    setError("");
    window.location.hash = "#/agents";
  }

  // ── Linear wizard helpers ──

  function startLinearSetup() {
    setWizardLoading(true);
    setView("setup-linear");

    // Read hash params before they're cleaned
    const hash = window.location.hash;
    let oauthSuccess = false;
    let oauthErr = "";
    if (hash.includes("oauth_success=true")) {
      oauthSuccess = true;
    } else if (hash.includes("oauth_error=")) {
      const match = hash.match(/oauth_error=([^&]*)/);
      try {
        oauthErr = decodeURIComponent(match?.[1] || "OAuth failed");
      } catch {
        oauthErr = match?.[1] || "OAuth failed";
      }
    }

    // Check server OAuth status + determine starting step
    api.getLinearOAuthStatus().then((serverStatus) => {
      const isConnected = oauthSuccess || serverStatus.hasAccessToken;
      const hasCreds = serverStatus.configured || (serverStatus.hasClientId && serverStatus.hasClientSecret);

      setWizardOauthConnected(isConnected);
      setWizardCredentialsSaved(hasCreds);
      if (oauthErr) setWizardOauthError(oauthErr);
      if (isConnected) setLinearOAuthConfigured(true);

      // Restore persisted state from sessionStorage (for OAuth redirect return)
      let persisted: { step: WizardStep; agentName: string; createdAgentId: string | null } | null = null;
      try {
        const raw = sessionStorage.getItem(WIZARD_STORAGE_KEY);
        if (raw) persisted = JSON.parse(raw);
      } catch { /* ignore */ }

      if (persisted) {
        if (isConnected && persisted.step <= 3) {
          setWizardStep(4);
        } else {
          setWizardStep(persisted.step);
        }
        if (persisted.agentName) setWizardAgentName(persisted.agentName);
        if (persisted.createdAgentId) setWizardCreatedAgentId(persisted.createdAgentId);
        try { sessionStorage.removeItem(WIZARD_STORAGE_KEY); } catch { /* ignore */ }
      } else {
        if (isConnected) {
          setWizardStep(4);
        } else if (hasCreds) {
          setWizardStep(3);
        } else {
          setWizardStep(1);
        }
      }

      setWizardLoading(false);
    }).catch(() => {
      setWizardLoading(false);
    });
  }

  function cancelLinearSetup() {
    setView("list");
    setWizardStep(1);
    setWizardCredentialsSaved(false);
    setWizardOauthConnected(false);
    setWizardOauthError("");
    setWizardAgentName("");
    setWizardCreatedAgentId(null);
    setWizardEditingAgent(null);
    try { sessionStorage.removeItem(WIZARD_STORAGE_KEY); } catch { /* ignore */ }
  }

  const wizardCompletedSteps = new Set<number>();
  if (wizardCredentialsSaved || wizardOauthConnected) {
    wizardCompletedSteps.add(1);
    wizardCompletedSteps.add(2);
  }
  if (wizardOauthConnected) {
    wizardCompletedSteps.add(3);
  }
  if (wizardCreatedAgentId) {
    wizardCompletedSteps.add(4);
  }

  const handleWizardBeforeRedirect = useCallback(() => {
    try {
      sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
        step: 3,
        credentialsSaved: wizardCredentialsSaved,
        oauthConnected: wizardOauthConnected,
        agentName: wizardAgentName,
        createdAgentId: wizardCreatedAgentId,
      }));
    } catch { /* ignore */ }
  }, [wizardCredentialsSaved, wizardOauthConnected, wizardAgentName, wizardCreatedAgentId]);

  const handleWizardAgentCreated = useCallback((id: string, name: string) => {
    setWizardCreatedAgentId(id);
    setWizardAgentName(name);
    setWizardStep(5);
  }, []);

  const handleWizardFinish = useCallback(() => {
    try { sessionStorage.removeItem(WIZARD_STORAGE_KEY); } catch { /* ignore */ }
    setView("list");
    setWizardStep(1);
    setWizardCredentialsSaved(false);
    setWizardOauthConnected(false);
    setWizardOauthError("");
    setWizardAgentName("");
    setWizardCreatedAgentId(null);
    loadAgents();
  }, [loadAgents]);

  const handleWizardAddAnother = useCallback(() => {
    setWizardCreatedAgentId(null);
    setWizardAgentName("");
    setWizardEditingAgent(null);
    setWizardCredentialsSaved(false);
    setWizardOauthConnected(false);
    setWizardOauthError("");
    setWizardStep(1);
  }, []);

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
          linear: { enabled: form.linearEnabled },
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
      linearOAuthConfigured={linearOAuthConfigured}
    />;
  }

  if (view === "edit-linear" && editingId) {
    return <LinearAgentEditor
      form={form}
      setForm={setForm}
      editingId={editingId}
      error={error}
      saving={saving}
      onSave={handleSave}
      onCancel={cancelEdit}
      onOpenGenericEditor={() => setView("edit")}
    />;
  }

  if (view === "setup-linear") {
    if (wizardLoading) {
      return (
        <div className="h-full flex items-center justify-center bg-cc-bg">
          <div className="text-sm text-cc-muted">Loading...</div>
        </div>
      );
    }

    return (
      <main className="h-full overflow-y-auto bg-cc-bg">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <LinearLogo className="w-6 h-6 text-cc-fg" />
              <h1 className="text-xl font-semibold text-cc-fg">Linear Agent Setup</h1>
            </div>
            <button
              onClick={cancelLinearSetup}
              className="px-3 py-2 rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {/* Step indicator */}
          <WizardStepIndicator
            steps={WIZARD_STEPS}
            currentStep={wizardStep}
            completedSteps={wizardCompletedSteps}
          />

          {/* Step content */}
          <div className="bg-cc-card border border-cc-border rounded-xl p-5 sm:p-7">
            {wizardStep === 1 && (
              <WizardStepIntro onNext={() => setWizardStep(2)} />
            )}
            {wizardStep === 2 && (
              <WizardStepCredentials
                onNext={() => setWizardStep(3)}
                onBack={() => setWizardStep(1)}
                credentialsSaved={wizardCredentialsSaved}
                onCredentialsSaved={() => setWizardCredentialsSaved(true)}
              />
            )}
            {wizardStep === 3 && (
              <WizardStepInstall
                onNext={() => setWizardStep(4)}
                onBack={() => setWizardStep(2)}
                oauthConnected={wizardOauthConnected}
                oauthError={wizardOauthError}
                onBeforeRedirect={handleWizardBeforeRedirect}
              />
            )}
            {wizardStep === 4 && (
              <WizardStepAgent
                onNext={handleWizardAgentCreated}
                onBack={() => setWizardStep(3)}
                existingAgent={wizardEditingAgent ? {
                  id: wizardEditingAgent.id,
                  name: wizardEditingAgent.name,
                  prompt: wizardEditingAgent.prompt,
                  backendType: wizardEditingAgent.backendType,
                  model: wizardEditingAgent.model,
                  cwd: wizardEditingAgent.cwd,
                } : undefined}
              />
            )}
            {wizardStep === 5 && (
              <WizardStepDone
                agentName={wizardAgentName}
                onFinish={handleWizardFinish}
                onAddAnother={handleWizardAddAnother}
              />
            )}
          </div>
        </div>
      </main>
    );
  }

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
              onClick={startLinearSetup}
              className="px-3 py-1.5 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <LinearLogo className="w-3 h-3" />
              Setup Linear Agent
            </button>
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

        {/* Linear Agents section */}
        {linearOAuthConfigured && !loading && (() => {
          const linearAgents = agents.filter(a => a.triggers?.linear?.enabled);
          return linearAgents.length > 0 ? (
            <LinearAgentSection
              agents={linearAgents}
              onEdit={(agent) => startEdit(agent)}
              onRun={(agent) => handleRunClick(agent)}
              onAddNew={startLinearSetup}
              onManageCredentials={() => { window.location.hash = "#/integrations/linear"; }}
            />
          ) : null;
        })()}

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
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
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

