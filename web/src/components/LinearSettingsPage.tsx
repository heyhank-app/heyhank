import { useEffect, useState } from "react";
import { api, type LinearWorkflowState, type LinearTeamStates } from "../api.js";
import { navigateHome, navigateToSession } from "../utils/routing.js";
import { useStore } from "../store.js";
import { LinearLogo } from "./LinearLogo.js";

interface LinearSettingsPageProps {
  embedded?: boolean;
}

export function LinearSettingsPage({ embedded = false }: LinearSettingsPageProps) {
  const [linearApiKey, setLinearApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [viewerLabel, setViewerLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [connectionNote, setConnectionNote] = useState("");

  // Auto-transition state
  const [autoTransition, setAutoTransition] = useState(false);
  const [selectedStateId, setSelectedStateId] = useState("");
  const [selectedStateName, setSelectedStateName] = useState("");
  const [teams, setTeams] = useState<LinearTeamStates[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [workflowStates, setWorkflowStates] = useState<LinearWorkflowState[]>([]);
  const [loadingStates, setLoadingStates] = useState(false);
  const [savingAutoTransition, setSavingAutoTransition] = useState(false);
  const [autoTransitionSaved, setAutoTransitionSaved] = useState(false);

  // Linear OAuth Agent App state
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthWebhookSecret, setOauthWebhookSecret] = useState("");
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [oauthHasAccessToken, setOauthHasAccessToken] = useState(false);
  const [savingOauth, setSavingOauth] = useState(false);
  const [oauthSaved, setOauthSaved] = useState(false);
  const [oauthError, setOauthError] = useState("");

  // Public URL from store (reactive — used in setup guide)
  const publicUrl = useStore((s) => s.publicUrl);

  // Archive transition state
  const [archiveTransition, setArchiveTransition] = useState(false);
  const [archiveSelectedStateId, setArchiveSelectedStateId] = useState("");
  const [archiveSelectedStateName, setArchiveSelectedStateName] = useState("");
  const [archiveSelectedTeamId, setArchiveSelectedTeamId] = useState("");
  const [archiveWorkflowStates, setArchiveWorkflowStates] = useState<LinearWorkflowState[]>([]);
  const [savingArchiveTransition, setSavingArchiveTransition] = useState(false);
  const [archiveTransitionSaved, setArchiveTransitionSaved] = useState(false);

  async function refreshConnectionStatus() {
    setCheckingConnection(true);
    setError("");
    setConnectionNote("");
    try {
      const info = await api.getLinearConnection();
      setConnected(info.connected);
      const label = info.viewerName || info.viewerEmail || "Connected account";
      const team = info.teamName ? ` \u2022 ${info.teamName}` : "";
      setViewerLabel(`${label}${team}`);
      setConnectionNote("Linear connection verified.");
    } catch (e: unknown) {
      setConnected(false);
      setViewerLabel("");
      setConnectionNote("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingConnection(false);
    }
  }

  async function fetchWorkflowStates() {
    setLoadingStates(true);
    try {
      const result = await api.getLinearStates();
      setTeams(result.teams);
      // Default to first team if none selected
      const firstTeam = result.teams[0];
      if (firstTeam && !selectedTeamId) {
        setSelectedTeamId(firstTeam.id);
        setWorkflowStates(firstTeam.states);
      }
    } catch {
      // Non-critical — states dropdown just won't populate
    } finally {
      setLoadingStates(false);
    }
  }

  useEffect(() => {
    api.getSettings()
      .then((settings) => {
        setConfigured(settings.linearApiKeyConfigured);
        setAutoTransition(settings.linearAutoTransition);
        setSelectedStateName(settings.linearAutoTransitionStateName);
        setArchiveTransition(settings.linearArchiveTransition);
        setArchiveSelectedStateName(settings.linearArchiveTransitionStateName);
        setOauthConfigured(settings.linearOAuthConfigured);
        if (settings.linearApiKeyConfigured) {
          refreshConnectionStatus().then(() => {
            fetchWorkflowStates().then(() => {
              // Once states are loaded, sync selectedStateId from the saved name
              // This is done inside the effect chain because we need the states list
            }).catch(() => {});
          }).catch(() => {});
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // Load OAuth status
    api.getLinearOAuthStatus().then((s) => {
      setOauthConfigured(s.configured);
      setOauthHasAccessToken(s.hasAccessToken);
    }).catch(() => {});

    // Check for OAuth callback success/error in URL
    const hash = window.location.hash;
    if (hash.includes("oauth_success=true")) {
      setOauthSaved(true);
      setOauthHasAccessToken(true);
      setOauthConfigured(true);
      // Clean up URL
      window.location.hash = "#/settings/linear";
      setTimeout(() => setOauthSaved(false), 3000);
    } else if (hash.includes("oauth_error=")) {
      const match = hash.match(/oauth_error=([^&]*)/);
      setOauthError(decodeURIComponent(match?.[1] || "OAuth failed"));
      window.location.hash = "#/settings/linear";
    }
  }, []);

  // Sync workflowStates when selectedTeamId changes
  useEffect(() => {
    const team = teams.find((t) => t.id === selectedTeamId);
    if (team) {
      setWorkflowStates(team.states);
    }
  }, [teams, selectedTeamId]);

  // Sync selectedStateId when workflowStates or selectedStateName changes
  useEffect(() => {
    if (workflowStates.length > 0 && selectedStateName) {
      const match = workflowStates.find((s) => s.name === selectedStateName);
      if (match) {
        setSelectedStateId(match.id);
      }
    }
  }, [workflowStates, selectedStateName]);

  // Sync archive team states when archiveSelectedTeamId changes
  useEffect(() => {
    const team = teams.find((t) => t.id === archiveSelectedTeamId);
    if (team) {
      setArchiveWorkflowStates(team.states);
    }
  }, [teams, archiveSelectedTeamId]);

  // Initialize archiveSelectedTeamId when teams load
  useEffect(() => {
    if (teams.length > 0 && !archiveSelectedTeamId) {
      setArchiveSelectedTeamId(teams[0].id);
    }
  }, [teams, archiveSelectedTeamId]);

  // Sync archiveSelectedStateId when archiveWorkflowStates or archiveSelectedStateName changes
  useEffect(() => {
    if (archiveWorkflowStates.length > 0 && archiveSelectedStateName) {
      const match = archiveWorkflowStates.find((s) => s.name === archiveSelectedStateName);
      if (match) {
        setArchiveSelectedStateId(match.id);
      }
    }
  }, [archiveWorkflowStates, archiveSelectedStateName]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = linearApiKey.trim();
    if (!trimmed) {
      setError("Please enter a Linear API key.");
      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);
    setConnectionNote("");
    try {
      const settings = await api.updateSettings({ linearApiKey: trimmed });
      setConfigured(settings.linearApiKeyConfigured);
      setLinearApiKey("");
      setSaved(true);
      await refreshConnectionStatus();
      await fetchWorkflowStates();
      setTimeout(() => setSaved(false), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDisconnect() {
    setSaving(true);
    setError("");
    setSaved(false);
    setConnectionNote("");
    try {
      const settings = await api.updateSettings({ linearApiKey: "" });
      setConfigured(settings.linearApiKeyConfigured);
      setConnected(false);
      setViewerLabel("");
      setLinearApiKey("");
      setTeams([]);
      setSelectedTeamId("");
      setWorkflowStates([]);
      setAutoTransition(false);
      setSelectedStateId("");
      setSelectedStateName("");
      setArchiveTransition(false);
      setArchiveSelectedStateId("");
      setArchiveSelectedStateName("");
      setConnectionNote("Linear disconnected.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAutoTransition() {
    setSavingAutoTransition(true);
    setAutoTransitionSaved(false);
    try {
      await api.updateSettings({
        linearAutoTransition: autoTransition,
        linearAutoTransitionStateId: selectedStateId,
        linearAutoTransitionStateName: selectedStateName,
      });
      setAutoTransitionSaved(true);
      setTimeout(() => setAutoTransitionSaved(false), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoTransition(false);
    }
  }

  async function onSaveArchiveTransition() {
    setSavingArchiveTransition(true);
    setArchiveTransitionSaved(false);
    try {
      await api.updateSettings({
        linearArchiveTransition: archiveTransition,
        linearArchiveTransitionStateId: archiveSelectedStateId,
        linearArchiveTransitionStateName: archiveSelectedStateName,
      });
      setArchiveTransitionSaved(true);
      setTimeout(() => setArchiveTransitionSaved(false), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingArchiveTransition(false);
    }
  }

  return (
    <div className={`${embedded ? "h-full" : "h-[100dvh]"} bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-cc-fg">Linear Settings</h1>
            <p className="mt-1 text-sm text-cc-muted">
              Configure Linear search and issue context injection at session start.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                window.location.hash = "#/integrations";
              }}
              className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Integrations
            </button>
            {!embedded && (
              <button
                onClick={() => {
                  const sessionId = useStore.getState().currentSessionId;
                  if (sessionId) {
                    navigateToSession(sessionId);
                  } else {
                    navigateHome();
                  }
                }}
                className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
              >
                Back
              </button>
            )}
          </div>
        </div>

        <section className="relative overflow-hidden bg-cc-card border border-cc-border rounded-xl p-4 sm:p-6 mb-4">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.1),transparent_45%)]" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-cc-border bg-cc-hover/60 text-xs text-cc-muted">
                <LinearLogo className="w-3.5 h-3.5 text-cc-fg" />
                <span>Linear Integration</span>
              </div>
              <h2 className="mt-3 text-lg sm:text-xl font-semibold text-cc-fg">
                Turn issues into concrete session context
              </h2>
              <p className="mt-1.5 text-sm text-cc-muted max-w-2xl">
                Search and attach the right Linear issue before the first prompt, so the companion starts with scope, state, and links.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-md bg-cc-hover text-cc-muted">Issue lookup on Home</span>
                <span className="px-2 py-1 rounded-md bg-cc-hover text-cc-muted">Context injection on start</span>
                <span className="px-2 py-1 rounded-md bg-cc-hover text-cc-muted">No key exposure in API responses</span>
              </div>
            </div>
            <div className="shrink-0 rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-right min-w-[170px]">
              <p className="text-[11px] text-cc-muted uppercase tracking-wide">Status</p>
              <p className={`mt-1 text-sm font-medium ${connected ? "text-cc-success" : configured ? "text-amber-500" : "text-cc-muted"}`}>
                {connected ? "Connected" : configured ? "Needs verification" : "Not connected"}
              </p>
              <p className="mt-0.5 text-[11px] text-cc-muted truncate">{viewerLabel || "No workspace linked yet"}</p>
            </div>
          </div>
        </section>

        <form onSubmit={onSave} className="bg-cc-card border border-cc-border rounded-xl p-4 sm:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-cc-fg flex items-center gap-2">
            <LinearLogo className="w-4 h-4 text-cc-fg" />
            <span>Linear Credentials</span>
          </h2>
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="linear-key">
              Linear API Key
            </label>
            <input
              id="linear-key"
              type="password"
              value={linearApiKey}
              onChange={(e) => setLinearApiKey(e.target.value)}
              placeholder={configured ? "Configured. Enter a new key to replace." : "lin_api_..."}
              className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
            />
            <p className="mt-1.5 text-xs text-cc-muted">
              Used to search Linear issues from the home page and inject issue context at session start.
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {error}
            </div>
          )}

          {connectionNote && (
            <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
              {connectionNote}
            </div>
          )}

          {saved && (
            <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
              Integration saved.
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-cc-muted">
              {loading ? "Loading..." : configured ? "Linear key configured" : "Linear key not configured"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onDisconnect}
                disabled={saving || loading || !configured}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  saving || loading || !configured
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-error/10 hover:bg-cc-error/20 text-cc-error cursor-pointer"
                }`}
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => {
                  refreshConnectionStatus().catch(() => {});
                }}
                disabled={checkingConnection || loading || !configured}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  checkingConnection || loading || !configured
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-hover hover:bg-cc-active text-cc-fg cursor-pointer"
                }`}
              >
                {checkingConnection ? "Checking..." : "Verify"}
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  saving || loading
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                }`}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </form>

        {connected && (
          <div className="mt-4 bg-cc-card border border-cc-border rounded-xl p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-semibold text-cc-fg">Auto-transition</h2>
            <p className="text-xs text-cc-muted">
              Automatically move the linked issue to a chosen status when starting a session.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={autoTransition}
                onClick={() => setAutoTransition(!autoTransition)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  autoTransition ? "bg-cc-primary" : "bg-cc-hover"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    autoTransition ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm text-cc-fg">
                {autoTransition ? "Enabled" : "Disabled"}
              </span>
            </div>

            {autoTransition && teams.length > 1 && (
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="transition-team">
                  Team
                </label>
                <select
                  id="transition-team"
                  value={selectedTeamId}
                  onChange={(e) => {
                    setSelectedTeamId(e.target.value);
                    setSelectedStateId("");
                    setSelectedStateName("");
                  }}
                  className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.key})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {autoTransition && (
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="transition-state">
                  Target status
                </label>
                {loadingStates ? (
                  <p className="text-xs text-cc-muted">Loading workflow states...</p>
                ) : workflowStates.length === 0 ? (
                  <p className="text-xs text-cc-muted">No workflow states found.</p>
                ) : (
                  <select
                    id="transition-state"
                    value={selectedStateId}
                    onChange={(e) => {
                      const state = workflowStates.find((s) => s.id === e.target.value);
                      setSelectedStateId(e.target.value);
                      setSelectedStateName(state?.name || "");
                    }}
                    className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                  >
                    <option value="">Select a status...</option>
                    {workflowStates.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {autoTransitionSaved && (
              <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
                Auto-transition settings saved.
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSaveAutoTransition}
                disabled={savingAutoTransition || (autoTransition && !selectedStateId)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  savingAutoTransition || (autoTransition && !selectedStateId)
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                }`}
              >
                {savingAutoTransition ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Archive transition settings — only when connected */}
        {connected && teams.length > 0 && (
          <div className="mt-4 bg-cc-card border border-cc-border rounded-xl p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-semibold text-cc-fg">On session archive</h2>
            <p className="text-xs text-cc-muted">
              When archiving a session linked to a Linear issue that is not done, optionally move it to a chosen status.
            </p>

            {/* Toggle */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={archiveTransition}
                onClick={() => setArchiveTransition(!archiveTransition)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  archiveTransition ? "bg-cc-primary" : "bg-cc-hover"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    archiveTransition ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm text-cc-fg">
                {archiveTransition ? "Enabled" : "Disabled"}
              </span>
            </div>

            {/* Team selector — only when multiple teams */}
            {archiveTransition && teams.length > 1 && (
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="archive-transition-team">
                  Team
                </label>
                <select
                  id="archive-transition-team"
                  value={archiveSelectedTeamId}
                  onChange={(e) => {
                    setArchiveSelectedTeamId(e.target.value);
                    setArchiveSelectedStateId("");
                    setArchiveSelectedStateName("");
                  }}
                  className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.key})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* State selector */}
            {archiveTransition && (
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="archive-transition-state">
                  Target status
                </label>
                {loadingStates ? (
                  <p className="text-xs text-cc-muted">Loading workflow states...</p>
                ) : archiveWorkflowStates.length === 0 ? (
                  <p className="text-xs text-cc-muted">No workflow states found.</p>
                ) : (
                  <select
                    id="archive-transition-state"
                    value={archiveSelectedStateId}
                    onChange={(e) => {
                      const state = archiveWorkflowStates.find((s) => s.id === e.target.value);
                      setArchiveSelectedStateId(e.target.value);
                      setArchiveSelectedStateName(state?.name || "");
                    }}
                    className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                  >
                    <option value="">Select a status...</option>
                    {archiveWorkflowStates.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {archiveTransitionSaved && (
              <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
                Archive transition settings saved.
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSaveArchiveTransition}
                disabled={savingArchiveTransition || (archiveTransition && !archiveSelectedStateId)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  savingArchiveTransition || (archiveTransition && !archiveSelectedStateId)
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                }`}
              >
                {savingArchiveTransition ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* ── Linear Agent App (OAuth) ── */}
        <div className="mt-4 bg-cc-card border border-cc-border rounded-xl p-4 sm:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-cc-fg flex items-center gap-2">
            <LinearLogo className="w-4 h-4 text-cc-fg" />
            <span>Linear Agent App</span>
            {oauthHasAccessToken && (
              <span className="ml-1 px-2 py-0.5 text-[10px] rounded-full bg-cc-success/10 text-cc-success border border-cc-success/20">
                Connected
              </span>
            )}
          </h2>
          <p className="text-xs text-cc-muted">
            Create a dedicated agent user in Linear that responds to @mentions. This uses Linear's native Agent Interaction SDK for a rich in-app experience with session activities, thoughts, and plans.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="oauth-client-id">
                Client ID
              </label>
              <input
                id="oauth-client-id"
                type="text"
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
                placeholder={oauthConfigured ? "Configured — enter new value to update" : "OAuth app client ID"}
                className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="oauth-client-secret">
                Client Secret
              </label>
              <input
                id="oauth-client-secret"
                type="password"
                value={oauthClientSecret}
                onChange={(e) => setOauthClientSecret(e.target.value)}
                placeholder={oauthConfigured ? "Configured — enter new value to update" : "OAuth app client secret"}
                className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="oauth-webhook-secret">
                Webhook Signing Secret
              </label>
              <input
                id="oauth-webhook-secret"
                type="password"
                value={oauthWebhookSecret}
                onChange={(e) => setOauthWebhookSecret(e.target.value)}
                placeholder={oauthConfigured ? "Configured — enter new value to update" : "Webhook signing secret from Linear"}
                className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
              />
            </div>
          </div>

          {oauthError && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {oauthError}
            </div>
          )}

          {oauthSaved && (
            <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
              {oauthHasAccessToken ? "Agent app connected successfully!" : "OAuth credentials saved."}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-cc-muted">
              {oauthHasAccessToken
                ? "Agent app installed — agents with the Linear trigger will respond to @mentions"
                : oauthConfigured
                  ? "Credentials saved — install the app to connect"
                  : "Not configured"}
            </span>
            <div className="flex items-center gap-2">
              {oauthHasAccessToken && (
                <button
                  type="button"
                  onClick={async () => {
                    setSavingOauth(true);
                    setOauthError("");
                    try {
                      await api.disconnectLinearOAuth();
                      setOauthHasAccessToken(false);
                      setOauthConfigured(false);
                    } catch (e: unknown) {
                      setOauthError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setSavingOauth(false);
                    }
                  }}
                  disabled={savingOauth}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    savingOauth
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-error/10 hover:bg-cc-error/20 text-cc-error cursor-pointer"
                  }`}
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  setSavingOauth(true);
                  setOauthError("");
                  setOauthSaved(false);
                  try {
                    // Save credentials first if provided
                    const patch: Record<string, string> = {};
                    if (oauthClientId.trim()) patch.linearOAuthClientId = oauthClientId.trim();
                    if (oauthClientSecret.trim()) patch.linearOAuthClientSecret = oauthClientSecret.trim();
                    if (oauthWebhookSecret.trim()) patch.linearOAuthWebhookSecret = oauthWebhookSecret.trim();
                    if (Object.keys(patch).length > 0) {
                      await api.updateSettings(patch);
                      setOauthClientId("");
                      setOauthClientSecret("");
                      setOauthWebhookSecret("");
                      setOauthSaved(true);
                      setTimeout(() => setOauthSaved(false), 1800);
                    }
                  } catch (e: unknown) {
                    setOauthError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingOauth(false);
                  }
                }}
                disabled={savingOauth || (!oauthClientId.trim() && !oauthClientSecret.trim() && !oauthWebhookSecret.trim())}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  savingOauth || (!oauthClientId.trim() && !oauthClientSecret.trim() && !oauthWebhookSecret.trim())
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                }`}
              >
                {savingOauth ? "Saving..." : "Save Credentials"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setOauthError("");
                  try {
                    const result = await api.getLinearOAuthAuthorizeUrl();
                    window.open(result.url, "_self");
                  } catch (e: unknown) {
                    setOauthError(e instanceof Error ? e.message : String(e));
                  }
                }}
                disabled={!oauthConfigured || savingOauth}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  !oauthConfigured || savingOauth
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
                }`}
              >
                Install to Workspace
              </button>
            </div>
          </div>

          {/* Setup instructions */}
          <details className="text-xs text-cc-muted">
            <summary className="cursor-pointer hover:text-cc-fg transition-colors">Setup guide</summary>
            <ol className="mt-2 ml-4 space-y-1 list-decimal">
              <li>Go to <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer" className="text-cc-primary underline">Linear &rarr; Settings &rarr; API &rarr; OAuth Applications</a> and create a new app.</li>
              <li>Enable <strong>Webhooks</strong> and subscribe to <strong>Agent session events</strong>.</li>
              <li>Add the scope <code className="px-1 py-0.5 rounded bg-cc-hover">app:mentionable</code>.</li>
              <li>Set the <strong>Redirect URI</strong> to: <code className="px-1 py-0.5 rounded bg-cc-hover text-[10px]">{`${publicUrl || window.location.origin}/api/linear/oauth/callback`}</code></li>
              <li>Set the <strong>Webhook URL</strong> to: <code className="px-1 py-0.5 rounded bg-cc-hover text-[10px]">{`${publicUrl || window.location.origin}/api/linear/agent-webhook`}</code></li>
              <li>Copy the Client ID, Client Secret, and Webhook Signing Secret into the fields above.</li>
              <li>Click <strong>Install to Workspace</strong> to create the agent user.</li>
              <li>Enable the <strong>Linear Agent</strong> trigger on an agent in the <a href="#/agents" className="text-cc-primary underline">Agents</a> page.</li>
            </ol>
          </details>
        </div>

        <section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-cc-card border border-cc-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-cc-muted">1. Configure</p>
            <p className="mt-1 text-sm text-cc-fg">Add a Linear API key and verify the connection.</p>
          </div>
          <div className="bg-cc-card border border-cc-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-cc-muted">2. Select</p>
            <p className="mt-1 text-sm text-cc-fg">From Home, search an issue by key or title in one click.</p>
          </div>
          <div className="bg-cc-card border border-cc-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-cc-muted">3. Start</p>
            <p className="mt-1 text-sm text-cc-fg">The issue details are injected as startup context.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
