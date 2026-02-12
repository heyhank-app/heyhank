import { useEffect, useState } from "react";
import { api } from "../api.js";

export function SettingsPage() {
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("openrouter/free");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setConfigured(s.openrouterApiKeyConfigured);
        setOpenrouterModel(s.openrouterModel || "openrouter/free");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const nextKey = openrouterApiKey.trim();
      const payload: { openrouterApiKey?: string; openrouterModel: string } = {
        openrouterModel: openrouterModel.trim() || "openrouter/free",
      };
      if (nextKey) {
        payload.openrouterApiKey = nextKey;
      }

      const res = await api.updateSettings(payload);
      setConfigured(res.openrouterApiKeyConfigured);
      setOpenrouterApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-[100dvh] bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h1 className="text-lg font-semibold">Settings</h1>
          <button
            onClick={() => {
              window.location.hash = "";
            }}
            className="px-3 py-1.5 rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            Back
          </button>
        </div>

        <form
          onSubmit={onSave}
          className="bg-cc-card border border-cc-border rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="openrouter-key">
              OpenRouter API Key
            </label>
            <input
              id="openrouter-key"
              type="password"
              value={openrouterApiKey}
              onChange={(e) => setOpenrouterApiKey(e.target.value)}
              placeholder={configured ? "Configured. Enter a new key to replace." : "sk-or-v1-..."}
              className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
            />
            <p className="mt-1.5 text-xs text-cc-muted">
              Automatic session renaming is disabled until this key is configured.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="openrouter-model">
              OpenRouter Model
            </label>
            <input
              id="openrouter-model"
              type="text"
              value={openrouterModel}
              onChange={(e) => setOpenrouterModel(e.target.value)}
              placeholder="openrouter/free"
              className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {error}
            </div>
          )}

          {saved && (
            <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
              Settings saved.
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-cc-muted">
              {loading ? "Loading..." : configured ? "OpenRouter key configured" : "OpenRouter key not configured"}
            </span>
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
        </form>
      </div>
    </div>
  );
}
