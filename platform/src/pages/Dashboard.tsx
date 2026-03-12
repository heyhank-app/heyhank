import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";
import {
  LayoutGrid,
  Settings,
  Users,
  LogOut,
  Plus,
  Terminal,
  X,
  Server,
  Globe,
  Loader2,
  Menu,
} from "lucide-react";

/**
 * Dashboard page with sidebar navigation and instance management.
 * Shows instance list or empty state. Supports creating new instances.
 */
export function Dashboard() {
  const session = authClient.useSession();
  const [page, setPage] = useState<"instances" | "settings" | "team">("instances");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen flex bg-cc-bg text-cc-fg">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-cc-sidebar border-r border-cc-separator flex flex-col",
          "transition-transform duration-200 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-cc-separator">
          <span className="font-[family-name:var(--font-display)] font-bold text-sm tracking-tight">
            companion<span className="text-cc-primary">.</span>cloud
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => { setPage(item.id as any); setSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                page === item.id
                  ? "bg-cc-primary/10 text-cc-primary"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover",
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-cc-separator">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-cc-primary/20 text-cc-primary flex items-center justify-center text-xs font-bold">
              {session.data?.user?.name?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {session.data?.user?.name || "User"}
              </p>
              <p className="text-xs text-cc-muted-fg truncate">
                {session.data?.user?.email}
              </p>
            </div>
            <button
              onClick={() => authClient.signOut()}
              className="text-cc-muted-fg hover:text-cc-error transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-cc-separator shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-cc-muted hover:text-cc-fg"
            >
              <Menu size={20} />
            </button>
            <h1 className="font-medium text-sm capitalize">{page}</h1>
          </div>
          {page === "instances" && (
            <CreateInstanceButton />
          )}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {page === "instances" && <InstancesView />}
          {page === "settings" && <SettingsView />}
          {page === "team" && <TeamView />}
        </div>
      </main>
    </div>
  );
}

/* ─── Instances View ──────────────────────────────────────────────────────── */

function InstancesView() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listInstances()
      .then((data) => setInstances(data.instances || []))
      .catch((err) => setError(err.message || "Failed to load instances"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-cc-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-cc-error text-sm mb-2">Failed to load instances</p>
        <p className="text-cc-muted text-xs">{error}</p>
      </div>
    );
  }

  if (instances.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {instances.map((inst: any) => (
        <InstanceCard key={inst.id} instance={inst} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-16 h-16 rounded-2xl bg-cc-card border border-cc-border flex items-center justify-center mb-6">
        <Terminal size={28} className="text-cc-muted-fg" />
      </div>
      <h2 className="font-[family-name:var(--font-display)] font-bold text-lg mb-2">
        No instances yet
      </h2>
      <p className="text-cc-muted text-sm max-w-sm mb-6">
        Create your first Companion instance to start building with Claude Code
        in the browser.
      </p>
      <CreateInstanceButton />
    </div>
  );
}

function InstanceCard({ instance }: { instance: any }) {
  const [actionLoading, setActionLoading] = useState(false);
  const isRunning = instance.machineStatus === "running" || instance.machineStatus === "started";
  const isStopped = instance.machineStatus === "stopped";

  async function handleAction(action: () => Promise<unknown>) {
    setActionLoading(true);
    try {
      await action();
      window.location.reload();
    } catch {
      // Instance action failed — page will still reflect current state
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-cc-border bg-cc-card p-5 hover:border-cc-border-hover transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-cc-muted" />
          <span className="font-[family-name:var(--font-display)] text-sm font-medium">
            {instance.hostname || instance.id?.slice(0, 8)}
          </span>
        </div>
        <StatusBadge status={instance.machineStatus} />
      </div>

      <div className="space-y-1.5 text-xs text-cc-muted mb-4">
        {instance.region && (
          <div className="flex items-center gap-1.5">
            <Globe size={12} />
            <span>{instance.region}</span>
          </div>
        )}
        {instance.ownerType && (
          <span className="inline-block px-2 py-0.5 bg-cc-hover rounded text-cc-muted-fg">
            {instance.ownerType}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {isRunning && (
          <>
            <a
              href={instance.id ? `/api/instances/${instance.id}/embed` : "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-1.5 text-xs font-medium bg-cc-primary text-white rounded-lg hover:bg-cc-primary-hover transition-colors text-center"
            >
              Open
            </a>
            <button
              onClick={() => handleAction(() => api.stopInstance(instance.id))}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs border border-cc-border rounded-lg hover:bg-cc-hover transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : "Stop"}
            </button>
          </>
        )}
        {isStopped && (
          <>
            <button
              onClick={() => handleAction(() => api.startInstance(instance.id))}
              disabled={actionLoading}
              className="flex-1 py-1.5 text-xs font-medium border border-cc-border rounded-lg hover:bg-cc-hover transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin mx-auto" /> : "Start"}
            </button>
          </>
        )}
        <button
          onClick={() => {
            const confirmed = window.confirm("Delete this instance permanently?");
            if (!confirmed) return;
            void handleAction(() => api.deleteInstance(instance.id));
          }}
          disabled={actionLoading}
          className="px-3 py-1.5 text-xs border border-cc-error/40 text-cc-error rounded-lg hover:bg-cc-error/10 transition-colors disabled:opacity-50"
        >
          {actionLoading ? <Loader2 size={12} className="animate-spin" /> : "Delete"}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const isRunning = status === "running" || status === "started";
  const isStopped = status === "stopped";
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full",
        isRunning && "bg-cc-success/10 text-cc-success",
        isStopped && "bg-cc-muted-fg/10 text-cc-muted-fg",
        !isRunning && !isStopped && "bg-cc-warning/10 text-cc-warning",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          isRunning && "bg-cc-success animate-pulse-dot",
          isStopped && "bg-cc-muted-fg",
          !isRunning && !isStopped && "bg-cc-warning animate-pulse-dot",
        )}
      />
      {status || "unknown"}
    </span>
  );
}

/* ─── Create Instance ─────────────────────────────────────────────────────── */

function CreateInstanceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-white rounded-lg text-sm font-medium hover:bg-cc-primary-hover transition-colors"
      >
        <Plus size={16} />
        Create Instance
      </button>

      {open && <CreateInstanceModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateInstanceModal({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState("starter");
  const [region, setRegion] = useState("iad");
  const [ownerType, setOwnerType] = useState<"shared" | "personal">("shared");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      await api.createInstance({ plan, region, ownerType });
      onClose();
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Failed to create instance");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create Instance"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-cc-card border border-cc-border rounded-2xl p-8 w-full max-w-md animate-fade-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-[family-name:var(--font-display)] font-bold">
            Create Instance
          </h2>
          <button onClick={onClose} className="text-cc-muted-fg hover:text-cc-fg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Plan selection */}
        <label className="block text-xs text-cc-muted mb-2">Plan</label>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {["starter", "pro", "enterprise"].map((p) => (
            <button
              key={p}
              onClick={() => setPlan(p)}
              className={cn(
                "py-2 px-3 rounded-lg text-xs font-medium border transition-all capitalize",
                plan === p
                  ? "border-cc-primary bg-cc-primary/10 text-cc-primary"
                  : "border-cc-border hover:border-cc-border-hover",
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Region */}
        <label className="block text-xs text-cc-muted mb-2">Region</label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="w-full px-3 py-2.5 bg-cc-input-bg border border-cc-border rounded-lg text-sm text-cc-fg outline-none focus:border-cc-primary mb-5 appearance-none"
        >
          <option value="iad">US East (IAD)</option>
          <option value="lax">US West (LAX)</option>
          <option value="cdg">Europe (CDG)</option>
          <option value="nrt">Asia (NRT)</option>
        </select>

        {/* Ownership */}
        <label className="block text-xs text-cc-muted mb-2">Ownership</label>
        <div className="grid grid-cols-2 gap-2 mb-8">
          {(["shared", "personal"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOwnerType(o)}
              className={cn(
                "py-2 px-3 rounded-lg text-xs font-medium border transition-all capitalize",
                ownerType === o
                  ? "border-cc-primary bg-cc-primary/10 text-cc-primary"
                  : "border-cc-border hover:border-cc-border-hover",
              )}
            >
              {o}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-cc-error text-xs mb-3">{error}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full py-2.5 bg-cc-primary text-white rounded-lg font-medium text-sm hover:bg-cc-primary-hover transition-all disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin mx-auto" />
          ) : (
            "Create Instance"
          )}
        </button>
      </div>
    </div>
  );
}

/* ─── Stub Pages ──────────────────────────────────────────────────────────── */

function SettingsView() {
  return (
    <div className="max-w-lg">
      <h2 className="font-[family-name:var(--font-display)] font-bold text-lg mb-4">Settings</h2>
      <p className="text-cc-muted text-sm">Account settings coming soon.</p>
    </div>
  );
}

function TeamView() {
  return (
    <div className="max-w-lg">
      <h2 className="font-[family-name:var(--font-display)] font-bold text-lg mb-4">Team</h2>
      <p className="text-cc-muted text-sm">Team management coming soon.</p>
    </div>
  );
}

/* ─── Data ────────────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { id: "instances", label: "Instances", icon: LayoutGrid },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "team", label: "Team", icon: Users },
];
