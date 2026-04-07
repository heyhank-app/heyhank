import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";

interface ProviderEnvField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
}

interface ProviderWithConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  cliProviderFlag: string;
  defaultModel?: string;
  docsUrl?: string;
  envFields: ProviderEnvField[];
  configured: boolean;
  enabled: boolean;
  envConfigured: Record<string, boolean>;
  customModel?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  cloud: "Cloud Providers",
  gateway: "Gateways & Proxies",
  local: "Local / Self-Hosted",
  custom: "Custom",
};

const CATEGORY_ORDER = ["cloud", "gateway", "local", "custom"];

export function ProviderGrid() {
  const [providers, setProviders] = useState<ProviderWithConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    api.getProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-xs text-cc-muted">Loading providers...</p>;

  const filtered = filter
    ? providers.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()) || p.description.toLowerCase().includes(filter.toLowerCase()))
    : providers;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    items: filtered.filter((p) => p.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {providers.length > 10 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search providers..."
          className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
        />
      )}

      {grouped.map((group) => (
        <div key={group.category}>
          <h4 className="text-xs font-medium text-cc-muted uppercase tracking-wide mb-2">{group.label}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.items.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                expanded={expandedId === provider.id}
                onToggle={() => setExpandedId(expandedId === provider.id ? null : provider.id)}
                onUpdate={load}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  expanded,
  onToggle,
  onUpdate,
}: {
  provider: ProviderWithConfig;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadedValues, setLoadedValues] = useState(false);

  // Load non-secret values when expanding
  useEffect(() => {
    if (expanded && !loadedValues) {
      api.getProvider(provider.id).then((detail) => {
        // Pre-fill non-secret fields with their stored values
        const vals: Record<string, string> = {};
        for (const field of provider.envFields) {
          if (!field.secret && detail.envValues?.[field.key]) {
            vals[field.key] = detail.envValues[field.key];
          }
        }
        setFormValues(vals);
        setLoadedValues(true);
      }).catch(() => {});
    }
  }, [expanded, loadedValues, provider.id, provider.envFields]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Only send fields that have values
      const envValues: Record<string, string> = {};
      for (const [key, val] of Object.entries(formValues)) {
        if (val.trim()) envValues[key] = val.trim();
      }
      await api.updateProvider(provider.id, { enabled: true, envValues });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setFormValues({});
      setLoadedValues(false);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      await api.deleteProvider(provider.id);
      setFormValues({});
      setLoadedValues(false);
      onUpdate();
    } catch {}
  };

  const handleToggleEnabled = async () => {
    try {
      await api.updateProvider(provider.id, { enabled: !provider.enabled });
      onUpdate();
    } catch {}
  };

  return (
    <div className={`rounded-lg border transition-colors ${
      provider.configured && provider.enabled
        ? "border-cc-success/30 bg-cc-success/5"
        : provider.configured
          ? "border-cc-warning/30 bg-cc-warning/5"
          : "border-cc-border bg-cc-bg"
    }`}>
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-cc-fg truncate">{provider.name}</span>
            {provider.configured && provider.enabled && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-cc-success" />
            )}
            {provider.configured && !provider.enabled && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-cc-warning" />
            )}
          </div>
          <p className="text-[11px] text-cc-muted truncate">{provider.description}</p>
        </div>
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`shrink-0 w-3.5 h-3.5 text-cc-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>

      {/* Expandable form */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-cc-border/50 pt-3">
          {provider.envFields.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="block text-xs text-cc-muted" htmlFor={`prov-${provider.id}-${field.key}`}>
                {field.label}
                {field.required && <span className="text-cc-error ml-0.5">*</span>}
                {provider.envConfigured[field.key] && field.secret && (
                  <span className="ml-1 text-cc-success">(configured)</span>
                )}
              </label>
              <input
                id={`prov-${provider.id}-${field.key}`}
                type={field.secret ? "password" : "text"}
                value={formValues[field.key] ?? ""}
                onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })}
                placeholder={
                  provider.envConfigured[field.key] && field.secret
                    ? "Enter new value to replace"
                    : field.placeholder || ""
                }
                className="w-full px-2.5 py-1.5 text-sm bg-cc-input-bg rounded-md text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
              />
            </div>
          ))}

          {provider.docsUrl && (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-cc-primary hover:underline"
            >
              Documentation
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M3.75 2a.75.75 0 0 0 0 1.5h5.69L2.22 10.72a.75.75 0 1 0 1.06 1.06L10.5 4.56v5.69a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-.75-.75H3.75Z" />
              </svg>
            </a>
          )}

          {error && (
            <p className="text-xs text-cc-error">{error}</p>
          )}
          {saved && (
            <p className="text-xs text-cc-success">Saved!</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || Object.values(formValues).every((v) => !v.trim())}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                saving || Object.values(formValues).every((v) => !v.trim())
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white cursor-pointer"
              }`}
            >
              {saving ? "Saving..." : "Save"}
            </button>

            {provider.configured && (
              <>
                <button
                  type="button"
                  onClick={handleToggleEnabled}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  {provider.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
