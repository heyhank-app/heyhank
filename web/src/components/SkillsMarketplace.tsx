import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

interface SkillsMarketplaceProps {
  embedded?: boolean;
}

interface Source {
  id: string;
  name: string;
  owner: string;
  url: string;
  description: string;
}

interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  sourceId: string;
}

interface InstalledSkill {
  slug: string;
  name: string;
  description: string;
  path: string;
}

export function SkillsMarketplace({ embedded: _embedded }: SkillsMarketplaceProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Initial load: sources + installed skills.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.marketplaceListSources(), api.listSkills()])
      .then(([srcs, inst]) => {
        if (cancelled) return;
        setSources(srcs);
        setInstalled(inst);
        if (srcs.length > 0) setActiveSourceId(srcs[0].id);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load skills when active source changes.
  useEffect(() => {
    if (!activeSourceId) return;
    let cancelled = false;
    setLoadingSkills(true);
    setError(null);
    api
      .marketplaceListSkills(activeSourceId)
      .then((s) => {
        if (!cancelled) setSkills(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  const installedSlugs = useMemo(() => new Set(installed.map((s) => s.slug)), [installed]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  async function refreshInstalled(): Promise<void> {
    try {
      const inst = await api.listSkills();
      setInstalled(inst);
    } catch {
      // best-effort
    }
  }

  async function handleInstall(skill: MarketplaceSkill, overwrite = false): Promise<void> {
    if (!activeSourceId) return;
    setBusySlug(skill.slug);
    setError(null);
    try {
      await api.marketplaceInstall(activeSourceId, skill.slug, overwrite);
      await refreshInstalled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  async function handleUninstall(slug: string): Promise<void> {
    if (!confirm(`Uninstall skill "${slug}"? This removes the folder from ~/.claude/skills/.`)) {
      return;
    }
    setBusySlug(slug);
    setError(null);
    try {
      await api.deleteSkill(slug);
      await refreshInstalled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null;

  return (
    <div className="absolute inset-0 overflow-auto bg-cc-bg text-cc-fg">
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold mb-1">Skill Marketplace</h1>
          <p className="text-sm text-cc-muted">
            Install Claude Code skills from curated GitHub repositories. Skills are downloaded to{" "}
            <code className="text-xs bg-cc-card px-1 py-0.5 rounded">~/.claude/skills/</code> and loaded
            automatically by Claude Code.
          </p>
        </header>

        {/* Source selector */}
        <section aria-labelledby="sources-heading" className="mb-6">
          <h2 id="sources-heading" className="text-sm font-semibold mb-2">
            Sources
          </h2>
          {sources.length === 0 ? (
            <div className="text-sm text-cc-muted">Loading sources…</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sources.map((src) => {
                const active = src.id === activeSourceId;
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => setActiveSourceId(src.id)}
                    className={`px-3 py-2 rounded-md border text-left text-sm transition-colors ${
                      active
                        ? "border-cc-accent bg-cc-accent/10 text-cc-fg"
                        : "border-cc-border bg-cc-card hover:bg-cc-hover text-cc-fg"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="font-medium">{src.name}</div>
                    <div className="text-xs text-cc-muted">by {src.owner}</div>
                  </button>
                );
              })}
            </div>
          )}
          {activeSource && (
            <div className="mt-3 text-xs text-cc-muted flex items-center gap-2">
              <a
                href={activeSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-cc-fg"
              >
                View source on GitHub
              </a>
              {activeSource.description && <span aria-hidden="true">·</span>}
              {activeSource.description && <span>{activeSource.description}</span>}
            </div>
          )}
        </section>

        {/* Search */}
        <div className="mb-4">
          <label className="sr-only" htmlFor="skill-search">
            Search skills
          </label>
          <input
            id="skill-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="w-full px-3 py-2 rounded-md border border-cc-border bg-cc-card text-sm focus:outline-none focus:ring-2 focus:ring-cc-accent"
          />
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="mb-4 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        {/* Skills list */}
        <section aria-labelledby="skills-heading">
          <h2 id="skills-heading" className="text-sm font-semibold mb-2">
            Available skills{loadingSkills ? " (loading…)" : ` (${filteredSkills.length})`}
          </h2>

          {loadingSkills ? (
            <div className="text-sm text-cc-muted">Fetching skills…</div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-sm text-cc-muted">No skills match your search.</div>
          ) : (
            <ul className="space-y-2">
              {filteredSkills.map((skill) => {
                const isInstalled = installedSlugs.has(skill.slug);
                const isBusy = busySlug === skill.slug;
                return (
                  <li
                    key={skill.slug}
                    className="px-3 py-3 rounded-md border border-cc-border bg-cc-card flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{skill.name}</span>
                        <code className="text-xs text-cc-muted">{skill.slug}</code>
                        {isInstalled && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                            Installed
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="text-sm text-cc-muted mt-1 line-clamp-3">{skill.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {isInstalled ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInstall(skill, true)}
                            className="px-3 py-1 text-xs rounded border border-cc-border hover:bg-cc-hover disabled:opacity-50"
                          >
                            {isBusy ? "Updating…" : "Update"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleUninstall(skill.slug)}
                            className="px-3 py-1 text-xs rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {isBusy ? "Removing…" : "Uninstall"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleInstall(skill, false)}
                          className="px-3 py-1 text-xs rounded bg-cc-accent text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {isBusy ? "Installing…" : "Install"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
