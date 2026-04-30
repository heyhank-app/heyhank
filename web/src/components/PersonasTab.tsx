// ─── PersonasTab ─────────────────────────────────────────────────────────────
// Distilled writing-style personas, one per (platform, handle). Each card shows
// the metadata of a saved StyleProfile + actions to (re-)generate, view, delete.
// Stale-detection: compares the current library post-count for the handle
// against the snapshot stored in `basedOnPostCount`. If new posts have been
// extracted since the last analysis, a yellow badge prompts re-generation.

import { useEffect, useState, useCallback } from "react";

type Platform = "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";

interface StyleProfile {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string;
  basedOnPostCount: number;
  basedOnPostIds: string[];
  averageWordCount: number;
  lengthCategory: "kompakt" | "mittel" | "lang";
  hookPatterns: Array<{ type: string; frequency: number; examples: string[] }>;
  ctaPatterns: Array<{ type: string; frequency: number; examples: string[] }>;
  emojiStyle: "keine" | "sparsam" | "moderat" | "dicht";
  emojiList: string[];
  hashtagStyle: "keine" | "wenige" | "viele";
  contentPillars: string[];
  toneOfVoice: string;
  commentEngagementPattern: string;
  visualStyle: string;
  rawAnalysis: string;
  createdAt: string;
  updatedAt: string;
}

interface LibraryPost {
  id: string;
  platform: Platform;
  author: { handle: string; displayName?: string };
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("heyhank_auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || `${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

interface Props {
  showMessage: (text: string, isError?: boolean) => void;
}

export function PersonasTab({ showMessage }: Props): React.ReactElement {
  const [profiles, setProfiles] = useState<StyleProfile[]>([]);
  const [posts, setPosts] = useState<LibraryPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null); // "<platform>:<handle>"
  const [viewing, setViewing] = useState<StyleProfile | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, postsRes] = await Promise.all([
        apiGet<{ profiles: StyleProfile[] }>("/api/socialview/style-profiles"),
        apiGet<{ posts: LibraryPost[] }>("/api/socialview/library"),
      ]);
      setProfiles(profilesRes.profiles);
      setPosts(postsRes.posts);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load personas", true);
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Group library posts by (platform, handle) → who could become a persona. */
  const handleGroups = (() => {
    const groups = new Map<string, { platform: Platform; handle: string; displayName: string; count: number }>();
    for (const p of posts) {
      const key = `${p.platform}:${p.author.handle.toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, {
          platform: p.platform,
          handle: p.author.handle,
          displayName: p.author.displayName ?? p.author.handle,
          count: 1,
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
  })();

  function findProfile(platform: Platform, handle: string): StyleProfile | undefined {
    return profiles.find(
      (p) => p.platform === platform && p.handle.toLowerCase() === handle.toLowerCase(),
    );
  }

  async function generateProfile(platform: Platform, handle: string) {
    const key = `${platform}:${handle}`;
    setAnalyzing(key);
    try {
      const res = await apiPost<{ ok: boolean; profile: StyleProfile }>(
        `/api/socialview/style-profiles/${platform}/${encodeURIComponent(handle)}/analyze`,
      );
      showMessage(`Persona erstellt für @${handle}`);
      await refresh();
      setViewing(res.profile);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Analyse fehlgeschlagen", true);
    } finally {
      setAnalyzing(null);
    }
  }

  async function deleteProfile(platform: Platform, handle: string) {
    if (!confirm(`Persona für @${handle} löschen?`)) return;
    try {
      await apiDelete(`/api/socialview/style-profiles/${platform}/${encodeURIComponent(handle)}`);
      showMessage("Persona gelöscht");
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Löschen fehlgeschlagen", true);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-cc-fg">Personas</div>
          <div className="text-[11px] text-cc-muted">
            Destillierte Schreib-Profile pro (Plattform, Handle). Werden vom Content-Agent als
            Schreib-Anweisung genutzt — Hank kennt die Handles und mappt Personennamen darauf.
          </div>
        </div>
        <button
          onClick={refresh}
          className="text-xs px-2 py-1 rounded-md bg-cc-surface border border-cc-border text-cc-fg hover:bg-cc-bg"
        >
          Refresh
        </button>
      </div>

      {loading && <div className="text-xs text-cc-muted">Lade…</div>}

      {!loading && handleGroups.length === 0 && (
        <div className="text-xs text-cc-muted border border-dashed border-cc-border rounded-md p-6 text-center">
          Noch keine extrahierten Posts. Geh in den View-Tab, öffne ein Profil eines Role-Models
          und extrahiere Posts in die Library — dann erscheinen hier Persona-Karten.
        </div>
      )}

      {/* Persona cards — one per (platform, handle) */}
      <div className="grid gap-3 sm:grid-cols-2">
        {handleGroups.map((g) => {
          const profile = findProfile(g.platform, g.handle);
          const key = `${g.platform}:${g.handle}`;
          const isAnalyzing = analyzing === key;
          // Stale = current library post-count > snapshot count at time of analysis.
          const stale = profile && g.count > profile.basedOnPostCount;
          const newPosts = stale ? g.count - profile!.basedOnPostCount : 0;

          return (
            <div
              key={key}
              className={`rounded-lg border p-3 space-y-2 ${
                profile
                  ? "border-cc-accent/30 bg-cc-accent/5"
                  : "border-cc-border bg-cc-surface"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted uppercase">
                      {g.platform}
                    </span>
                    <span className="text-sm font-semibold text-cc-fg truncate">
                      @{g.handle}
                    </span>
                  </div>
                  {g.displayName && g.displayName !== g.handle && (
                    <div className="text-xs text-cc-muted truncate mt-0.5">{g.displayName}</div>
                  )}
                </div>
                {profile && (
                  <span
                    className="text-[10px] text-green-400 shrink-0"
                    title="Persona vorhanden"
                  >
                    ✓
                  </span>
                )}
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap gap-2 text-[11px] text-cc-muted">
                <span>
                  <span className="text-cc-fg font-medium">{g.count}</span> Posts in Library
                </span>
                {profile && (
                  <>
                    <span>·</span>
                    <span>
                      Basis: <span className="text-cc-fg font-medium">{profile.basedOnPostCount}</span>
                    </span>
                    <span>·</span>
                    <span className="capitalize">{profile.lengthCategory}</span>
                    <span>·</span>
                    <span>Ø {profile.averageWordCount} Wörter</span>
                  </>
                )}
              </div>

              {/* Stale badge */}
              {stale && (
                <div className="text-[10px] px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                  ⚠ {newPosts} {newPosts === 1 ? "neuer Post" : "neue Posts"} seit letzter Analyse — Aktualisierung empfohlen
                </div>
              )}

              {/* Profile preview */}
              {profile && profile.toneOfVoice && (
                <div className="text-xs text-cc-fg line-clamp-2 italic">
                  „{profile.toneOfVoice}"
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {profile && (
                  <button
                    onClick={() => setViewing(profile)}
                    className="text-[11px] px-2 py-1 rounded bg-cc-surface border border-cc-border text-cc-fg hover:bg-cc-bg"
                  >
                    Ansehen
                  </button>
                )}
                <button
                  onClick={() => generateProfile(g.platform, g.handle)}
                  disabled={isAnalyzing}
                  className="text-[11px] px-2 py-1 rounded bg-cc-accent/15 border border-cc-accent/40 text-cc-accent hover:bg-cc-accent/25 disabled:opacity-50"
                  title={profile ? "Auf Basis aller Posts neu erstellen" : "Persona aus Library-Posts destillieren"}
                >
                  {isAnalyzing ? "Analysiere…" : profile ? "Aktualisieren" : "Generieren"}
                </button>
                {profile && (
                  <button
                    onClick={() => deleteProfile(g.platform, g.handle)}
                    className="text-[11px] px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                  >
                    Löschen
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {viewing && <PersonaDetailModal profile={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ─── PersonaDetailModal ──────────────────────────────────────────────────────
function PersonaDetailModal({
  profile,
  onClose,
}: {
  profile: StyleProfile;
  onClose: () => void;
}): React.ReactElement {
  const maxFreq = Math.max(
    1,
    ...profile.hookPatterns.map((h) => h.frequency),
    ...profile.ctaPatterns.map((c) => c.frequency),
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-cc-surface border border-cc-border rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-cc-border sticky top-0 bg-cc-surface z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted uppercase">
                {profile.platform}
              </span>
              <span className="text-sm font-semibold text-cc-fg">@{profile.handle}</span>
            </div>
            {profile.displayName && profile.displayName !== profile.handle && (
              <div className="text-xs text-cc-muted mt-0.5">{profile.displayName}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-cc-fg text-lg leading-none"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-cc-bg border border-cc-border rounded p-2">
              <div className="text-[10px] text-cc-muted">Basis</div>
              <div className="text-cc-fg font-medium">{profile.basedOnPostCount} Posts</div>
            </div>
            <div className="bg-cc-bg border border-cc-border rounded p-2">
              <div className="text-[10px] text-cc-muted">Ø Wörter</div>
              <div className="text-cc-fg font-medium">{profile.averageWordCount}</div>
            </div>
            <div className="bg-cc-bg border border-cc-border rounded p-2">
              <div className="text-[10px] text-cc-muted">Länge</div>
              <div className="text-cc-fg font-medium capitalize">{profile.lengthCategory}</div>
            </div>
          </div>

          {profile.toneOfVoice && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Tonfall</div>
              <div className="text-cc-fg whitespace-pre-wrap">{profile.toneOfVoice}</div>
            </section>
          )}

          {profile.hookPatterns.length > 0 && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Hook-Muster</div>
              <div className="space-y-2">
                {profile.hookPatterns
                  .slice()
                  .sort((a, b) => b.frequency - a.frequency)
                  .map((h, i) => (
                    <div key={i} className="bg-cc-bg border border-cc-border rounded p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-cc-fg font-medium flex-1">{h.type}</span>
                        <span className="text-cc-muted text-[10px]">{h.frequency}×</span>
                      </div>
                      <div className="h-1 bg-cc-surface rounded mt-1 overflow-hidden">
                        <div
                          className="h-full bg-cc-accent"
                          style={{ width: `${(h.frequency / maxFreq) * 100}%` }}
                        />
                      </div>
                      {h.examples.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {h.examples.slice(0, 3).map((ex, j) => (
                            <li key={j} className="text-cc-muted italic">„{ex}"</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}

          {profile.ctaPatterns.length > 0 && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">CTA-Muster</div>
              <div className="space-y-2">
                {profile.ctaPatterns
                  .slice()
                  .sort((a, b) => b.frequency - a.frequency)
                  .map((c, i) => (
                    <div key={i} className="bg-cc-bg border border-cc-border rounded p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-cc-fg font-medium flex-1">{c.type}</span>
                        <span className="text-cc-muted text-[10px]">{c.frequency}×</span>
                      </div>
                      {c.examples.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {c.examples.slice(0, 3).map((ex, j) => (
                            <li key={j} className="text-cc-muted italic">„{ex}"</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 gap-3">
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Emoji-Stil</div>
              <div className="text-cc-fg capitalize">{profile.emojiStyle}</div>
              {profile.emojiList.length > 0 && (
                <div className="text-base mt-1">{profile.emojiList.join(" ")}</div>
              )}
            </section>
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Hashtag-Stil</div>
              <div className="text-cc-fg capitalize">{profile.hashtagStyle}</div>
            </section>
          </div>

          {profile.contentPillars.length > 0 && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Content-Säulen</div>
              <div className="flex flex-wrap gap-1">
                {profile.contentPillars.map((p, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-cc-accent/15 text-cc-accent border border-cc-accent/30"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </section>
          )}

          {profile.commentEngagementPattern && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Kommentar-Verhalten</div>
              <div className="text-cc-fg whitespace-pre-wrap">{profile.commentEngagementPattern}</div>
            </section>
          )}

          {profile.visualStyle && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Visueller Stil</div>
              <div className="text-cc-fg whitespace-pre-wrap">{profile.visualStyle}</div>
            </section>
          )}
          {profile.rawAnalysis && (
            <section>
              <div className="text-[10px] uppercase text-cc-muted mb-1">Gesamt-Analyse</div>
              <div className="bg-cc-bg border border-cc-border rounded p-2 text-cc-fg whitespace-pre-wrap">
                {profile.rawAnalysis}
              </div>
            </section>
          )}

          <div className="text-[10px] text-cc-muted pt-2 border-t border-cc-border flex justify-between">
            <span>Erstellt: {new Date(profile.createdAt).toLocaleString()}</span>
            <span>Aktualisiert: {new Date(profile.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
