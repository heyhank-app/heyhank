import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { navigateToSession, navigateHome } from "../utils/routing.js";
import { FederationSettings } from "./FederationSettings.js";
import { ProviderGrid } from "./ProviderGrid.js";
import { subscribeToPush, unsubscribeFromPush } from "../sw-register.js";

interface SettingsPageProps {
  embedded?: boolean;
}

const CATEGORIES = [
  { id: "general", label: "General" },
  { id: "connectivity", label: "Connectivity" },
  { id: "authentication", label: "Authentication" },
  { id: "notifications", label: "Notifications" },
  { id: "providers", label: "Providers" },
  { id: "gemini", label: "Gemini" },
  { id: "email", label: "Email" },
  { id: "calendar", label: "Calendar" },
  { id: "ai-features", label: "HeyHank AI" },
  { id: "updates", label: "Updates" },
  { id: "appearance", label: "Appearance" },
  { id: "environments", label: "Environments" },
  { id: "federation", label: "Federation" },
  { id: "backup", label: "Backup" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

function PushNotificationToggle() {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);

  useEffect(() => {
    // Check current push subscription status
    (async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          setPushEnabled(!!sub);
        }
      } catch { /* SW not available */ }
      setPushLoading(false);
    })();
  }, []);

  const toggle = async () => {
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        if (Notification.permission !== "granted") {
          const result = await Notification.requestPermission();
          if (result !== "granted") {
            setPushLoading(false);
            return;
          }
        }
        const sub = await subscribeToPush();
        setPushEnabled(!!sub);
      }
    } catch (err) {
      console.error("[push] Toggle failed:", err);
    }
    setPushLoading(false);
  };

  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pushLoading}
      className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-50"
    >
      <span>Push Notifications (Agent Alerts)</span>
      <span className="text-xs text-cc-muted">
        {pushLoading ? "..." : pushEnabled ? "On" : "Off"}
      </span>
    </button>
  );
}

export function SettingsPage({ embedded = false }: SettingsPageProps) {
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-6");
  const [editorTabEnabled, setEditorTabEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const darkMode = useStore((s) => s.darkMode);
  const toggleDarkMode = useStore((s) => s.toggleDarkMode);
  const diffBase = useStore((s) => s.diffBase);
  const setDiffBase = useStore((s) => s.setDiffBase);
  const notificationSound = useStore((s) => s.notificationSound);
  const toggleNotificationSound = useStore((s) => s.toggleNotificationSound);
  const notificationDesktop = useStore((s) => s.notificationDesktop);
  const setNotificationDesktop = useStore((s) => s.setNotificationDesktop);
  const updateInfo = useStore((s) => s.updateInfo);
  const setUpdateInfo = useStore((s) => s.setUpdateInfo);
  const setUpdateOverlayActive = useStore((s) => s.setUpdateOverlayActive);
  const setStoreEditorTabEnabled = useStore((s) => s.setEditorTabEnabled);
  const notificationApiAvailable = typeof Notification !== "undefined";
  const [updateChannel, setUpdateChannel] = useState<"stable" | "prerelease">("stable");
  const [dockerAutoUpdate, setDockerAutoUpdate] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [aiValidationEnabled, setAiValidationEnabled] = useState(false);
  const [aiValidationAutoApprove, setAiValidationAutoApprove] = useState(true);
  const [aiValidationAutoDeny, setAiValidationAutoDeny] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [activeSection, setActiveSection] = useState<CategoryId>("general");
  const [apiKeyFocused, setApiKeyFocused] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; error?: string } | null>(null);

  // Provider tokens state
  const [claudeCodeToken, setClaudeCodeToken] = useState("");
  const [claudeCodeTokenConfigured, setClaudeCodeTokenConfigured] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiApiKeyConfigured, setOpenaiApiKeyConfigured] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [claudeTokenFocused, setClaudeTokenFocused] = useState(false);
  const [openaiKeyFocused, setOpenaiKeyFocused] = useState(false);
  const [claudeCliAuth, setClaudeCliAuth] = useState<{ authenticated: boolean; method: string; oauthTokenConfigured: boolean; cliVersion: string | null } | null>(null);
  const [codexCliAuth, setCodexCliAuth] = useState<{ authenticated: boolean; method: string; apiKeyConfigured: boolean; cliVersion: string | null } | null>(null);

  // Gemini state
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiKeyConfigured, setGeminiApiKeyConfigured] = useState(false);
  const [geminiVoice, setGeminiVoice] = useState("Kore");
  const [geminiVoiceOriginal, setGeminiVoiceOriginal] = useState("Kore");
  const [assistantName, setAssistantName] = useState("");
  const [assistantNameOriginal, setAssistantNameOriginal] = useState("");
  const [userName, setUserName] = useState("");
  const [userNameOriginal, setUserNameOriginal] = useState("");
  const [geminiKeyFocused, setGeminiKeyFocused] = useState(false);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiSaved, setGeminiSaved] = useState(false);
  const [geminiError, setGeminiError] = useState("");

  // Email accounts state
  interface EmailAccountUI {
    id: string;
    name: string;
    email: string;
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
    auth: { user: string; pass: string };
  }
  const [emailAccounts, setEmailAccounts] = useState<EmailAccountUI[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailSaved, setEmailSaved] = useState("");
  const [editingEmail, setEditingEmail] = useState<EmailAccountUI | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailForm, setEmailForm] = useState({
    name: "", email: "",
    imapHost: "", imapPort: "993", imapSecure: true,
    smtpHost: "", smtpPort: "465", smtpSecure: true,
    authUser: "", authPass: "",
  });
  const [emailTesting, setEmailTesting] = useState<string | null>(null);
  const [emailTestResult, setEmailTestResult] = useState<{ id: string; ok: boolean; message?: string } | null>(null);

  // Calendar accounts state
  interface CalendarAccountUI {
    id: string;
    name: string;
    provider: "google" | "icloud" | "caldav";
    serverUrl: string;
    auth: { user: string; pass: string };
    defaultCalendarId?: string;
  }
  const [calAccounts, setCalAccounts] = useState<CalendarAccountUI[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState("");
  const [calSaved, setCalSaved] = useState("");
  const [editingCal, setEditingCal] = useState<CalendarAccountUI | null>(null);
  const [showCalForm, setShowCalForm] = useState(false);
  const [calForm, setCalForm] = useState({
    name: "", provider: "google" as "google" | "icloud" | "caldav",
    serverUrl: "", authUser: "", authPass: "",
  });
  const [calTesting, setCalTesting] = useState<string | null>(null);
  const [calTestResult, setCalTestResult] = useState<{ id: string; ok: boolean; message?: string; calendars?: string[] } | null>(null);

  // Auth section state
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [qrCodes, setQrCodes] = useState<{ label: string; url: string; qrDataUrl: string }[] | null>(null);
  const [selectedQrIndex, setSelectedQrIndex] = useState(0);
  const [qrLoading, setQrLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // IntersectionObserver to track which section is in view
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry?.target?.id) {
          setActiveSection(topEntry.target.id as CategoryId);
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -70% 0px",
        threshold: 0,
      },
    );

    for (const cat of CATEGORIES) {
      const el = sectionRefs.current[cat.id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [loading]); // re-attach after loading completes and sections render

  const scrollToSection = useCallback((id: CategoryId) => {
    setActiveSection(id);
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setConfigured(s.anthropicApiKeyConfigured);
        // Also check if any additional provider is enabled (for AI Features status)
        api.getProviders().then((providers) => {
          if (providers.some((p) => p.configured && p.enabled)) setConfigured(true);
        }).catch(() => {});
        setClaudeCodeTokenConfigured(s.claudeCodeOAuthTokenConfigured);
        setOpenaiApiKeyConfigured(s.openaiApiKeyConfigured);
        if (s.claudeCliAuth) setClaudeCliAuth(s.claudeCliAuth);
        if (s.codexCliAuth) setCodexCliAuth(s.codexCliAuth);
        setGeminiApiKeyConfigured(s.geminiApiKeyConfigured);
        if (s.geminiVoice) { setGeminiVoice(s.geminiVoice); setGeminiVoiceOriginal(s.geminiVoice); }
        if (typeof s.assistantName === "string") { setAssistantName(s.assistantName); setAssistantNameOriginal(s.assistantName); }
        if (typeof s.userName === "string") { setUserName(s.userName); setUserNameOriginal(s.userName); }
        setAnthropicModel(s.anthropicModel || "claude-sonnet-4-6");
        setEditorTabEnabled(s.editorTabEnabled);
        setStoreEditorTabEnabled(s.editorTabEnabled);
        if (typeof s.aiValidationEnabled === "boolean") setAiValidationEnabled(s.aiValidationEnabled);
        if (typeof s.aiValidationAutoApprove === "boolean") setAiValidationAutoApprove(s.aiValidationAutoApprove);
        if (typeof s.aiValidationAutoDeny === "boolean") setAiValidationAutoDeny(s.aiValidationAutoDeny);
        if (s.updateChannel === "stable" || s.updateChannel === "prerelease") setUpdateChannel(s.updateChannel);
        if (typeof s.dockerAutoUpdate === "boolean") setDockerAutoUpdate(s.dockerAutoUpdate);
        if (typeof s.publicUrl === "string") {
          setPublicUrl(s.publicUrl);
          useStore.getState().setPublicUrl(s.publicUrl);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));

    // Fetch auth token in parallel (non-blocking)
    api.getAuthToken().then((res) => setAuthToken(res.token)).catch(() => {});

    // Fetch email accounts
    loadEmailAccounts();
    // Fetch calendar accounts
    loadCalendarAccounts();
  }, []);

  function loadEmailAccounts() {
    setEmailLoading(true);
    fetch("/api/email-accounts", { headers: { ...getAuthHeadersForFetch() } })
      .then((r) => r.json())
      .then((data) => setEmailAccounts(data as EmailAccountUI[]))
      .catch(() => {})
      .finally(() => setEmailLoading(false));
  }

  function getAuthHeadersForFetch(): Record<string, string> {
    const token = localStorage.getItem("auth_token") || sessionStorage.getItem("auth_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function resetEmailForm() {
    setEmailForm({ name: "", email: "", imapHost: "", imapPort: "993", imapSecure: true, smtpHost: "", smtpPort: "465", smtpSecure: true, authUser: "", authPass: "" });
    setEditingEmail(null);
    setShowEmailForm(false);
  }

  async function saveEmailAccount() {
    setEmailError("");
    const payload = {
      name: emailForm.name.trim(),
      email: emailForm.email.trim(),
      imap: { host: emailForm.imapHost.trim(), port: parseInt(emailForm.imapPort) || 993, secure: emailForm.imapSecure },
      smtp: { host: emailForm.smtpHost.trim(), port: parseInt(emailForm.smtpPort) || 465, secure: emailForm.smtpSecure },
      auth: { user: emailForm.authUser.trim(), pass: emailForm.authPass },
    };
    if (!payload.name || !payload.email || !payload.imap.host || !payload.smtp.host || !payload.auth.user || !payload.auth.pass) {
      setEmailError("All fields are required.");
      return;
    }
    try {
      const url = editingEmail ? `/api/email-accounts/${editingEmail.id}` : "/api/email-accounts";
      const method = editingEmail ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...getAuthHeadersForFetch() },
        body: JSON.stringify(editingEmail ? payload : payload),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || "Failed"); }
      setEmailSaved(editingEmail ? "Account updated." : "Account added.");
      setTimeout(() => setEmailSaved(""), 2000);
      resetEmailForm();
      loadEmailAccounts();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteEmailAccount(id: string) {
    if (!confirm("Delete this email account?")) return;
    try {
      await fetch(`/api/email-accounts/${id}`, { method: "DELETE", headers: getAuthHeadersForFetch() });
      loadEmailAccounts();
    } catch {}
  }

  async function testEmailAccount(id: string) {
    setEmailTesting(id);
    setEmailTestResult(null);
    try {
      const res = await fetch(`/api/email-accounts/${id}/test`, { method: "POST", headers: getAuthHeadersForFetch() });
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      setEmailTestResult({ id, ok: data.ok, message: data.ok ? data.message : data.error });
    } catch (err) {
      setEmailTestResult({ id, ok: false, message: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setEmailTesting(null);
    }
  }

  function startEditEmail(account: EmailAccountUI) {
    setEditingEmail(account);
    setEmailForm({
      name: account.name,
      email: account.email,
      imapHost: account.imap.host,
      imapPort: String(account.imap.port),
      imapSecure: account.imap.secure,
      smtpHost: account.smtp.host,
      smtpPort: String(account.smtp.port),
      smtpSecure: account.smtp.secure,
      authUser: account.auth.user,
      authPass: "", // don't prefill password
    });
    setShowEmailForm(true);
  }

  // ─── Calendar Account Functions ──────────────────────────────────────

  function loadCalendarAccounts() {
    setCalLoading(true);
    fetch("/api/calendar-accounts", { headers: { ...getAuthHeadersForFetch() } })
      .then((r) => r.json())
      .then((data) => setCalAccounts(data as CalendarAccountUI[]))
      .catch(() => {})
      .finally(() => setCalLoading(false));
  }

  function resetCalForm() {
    setCalForm({ name: "", provider: "google", serverUrl: "", authUser: "", authPass: "" });
    setEditingCal(null);
    setShowCalForm(false);
  }

  function applyCalPreset(provider: "google" | "icloud" | "outlook" | "caldav") {
    const presets: Record<string, { serverUrl: string }> = {
      google: { serverUrl: "https://apidata.googleusercontent.com/caldav/v2/" },
      icloud: { serverUrl: "https://caldav.icloud.com/" },
      outlook: { serverUrl: "https://outlook.office365.com/caldav/" },
      caldav: { serverUrl: "" },
    };
    setCalForm((f) => ({ ...f, provider: provider === "outlook" ? "caldav" : provider, serverUrl: presets[provider]?.serverUrl || "" }));
  }

  async function saveCalendarAccount() {
    setCalError("");
    const payload = {
      name: calForm.name.trim(),
      provider: calForm.provider,
      serverUrl: calForm.serverUrl.trim(),
      auth: { user: calForm.authUser.trim(), pass: calForm.authPass },
    };
    if (!payload.name || !payload.auth.user || !payload.auth.pass) {
      setCalError("Name, user and password are required.");
      return;
    }
    if (payload.provider === "caldav" && !payload.serverUrl) {
      setCalError("Server URL is required for custom CalDAV.");
      return;
    }
    try {
      const url = editingCal ? `/api/calendar-accounts/${editingCal.id}` : "/api/calendar-accounts";
      const method = editingCal ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...getAuthHeadersForFetch() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || "Failed"); }
      setCalSaved(editingCal ? "Account updated." : "Account added.");
      setTimeout(() => setCalSaved(""), 2000);
      resetCalForm();
      loadCalendarAccounts();
    } catch (err) {
      setCalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteCalendarAccount(id: string) {
    if (!confirm("Delete this calendar account?")) return;
    try {
      await fetch(`/api/calendar-accounts/${id}`, { method: "DELETE", headers: getAuthHeadersForFetch() });
      loadCalendarAccounts();
    } catch {}
  }

  async function testCalendarAccount(id: string) {
    setCalTesting(id);
    setCalTestResult(null);
    try {
      const res = await fetch(`/api/calendar-accounts/${id}/test`, { method: "POST", headers: getAuthHeadersForFetch() });
      const data = await res.json() as { ok: boolean; message?: string; error?: string; calendars?: string[] };
      setCalTestResult({ id, ok: data.ok, message: data.ok ? data.message : data.error, calendars: data.calendars });
    } catch (err) {
      setCalTestResult({ id, ok: false, message: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setCalTesting(null);
    }
  }

  function startEditCal(account: CalendarAccountUI) {
    setEditingCal(account);
    setCalForm({
      name: account.name,
      provider: account.provider,
      serverUrl: account.serverUrl,
      authUser: account.auth.user,
      authPass: "",
    });
    setShowCalForm(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const nextKey = anthropicApiKey.trim();
      const payload: { anthropicApiKey?: string; anthropicModel: string; editorTabEnabled: boolean } = {
        anthropicModel: anthropicModel.trim() || "claude-sonnet-4-6",
        editorTabEnabled,
      };
      if (nextKey) {
        payload.anthropicApiKey = nextKey;
      }

      const res = await api.updateSettings(payload);
      setConfigured(res.anthropicApiKeyConfigured);
      setEditorTabEnabled(res.editorTabEnabled);
      setStoreEditorTabEnabled(res.editorTabEnabled);
      setAnthropicApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAiValidation(field: "aiValidationEnabled" | "aiValidationAutoApprove" | "aiValidationAutoDeny") {
    const current = field === "aiValidationEnabled" ? aiValidationEnabled
      : field === "aiValidationAutoApprove" ? aiValidationAutoApprove
      : aiValidationAutoDeny;
    const newValue = !current;
    // Optimistic UI update
    if (field === "aiValidationEnabled") setAiValidationEnabled(newValue);
    else if (field === "aiValidationAutoApprove") setAiValidationAutoApprove(newValue);
    else setAiValidationAutoDeny(newValue);

    try {
      await api.updateSettings({ [field]: newValue });
    } catch {
      // Revert on failure
      if (field === "aiValidationEnabled") setAiValidationEnabled(current);
      else if (field === "aiValidationAutoApprove") setAiValidationAutoApprove(current);
      else setAiValidationAutoDeny(current);
    }
  }

  async function onCheckUpdates() {
    setCheckingUpdates(true);
    setUpdateStatus("");
    setUpdateError("");
    try {
      const info = await api.forceCheckForUpdate();
      setUpdateInfo(info);
      if (info.updateAvailable && info.latestVersion) {
        setUpdateStatus(`Update v${info.latestVersion} is available.`);
      } else {
        setUpdateStatus("You are up to date.");
      }
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function onTriggerUpdate() {
    setUpdatingApp(true);
    setUpdateStatus("");
    setUpdateError("");
    try {
      // Flag so the Docker image update dialog appears after restart
      localStorage.setItem("heyhank_docker_prompt_pending", "1");
      const res = await api.triggerUpdate();
      setUpdateStatus(res.message);
      setUpdateOverlayActive(true);
    } catch (err: unknown) {
      localStorage.removeItem("heyhank_docker_prompt_pending");
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdatingApp(false);
    }
  }

  const setSectionRef = useCallback((id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  }, []);

  return (
    <div className={`${embedded ? "h-full" : "h-[100dvh]"} bg-cc-bg text-cc-fg font-sans-ui antialiased flex flex-col`}>
      {/* Header */}
      <div className="shrink-0 max-w-5xl w-full mx-auto px-4 sm:px-8 pt-6 sm:pt-10">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-cc-fg">Settings</h1>
            <p className="mt-1 text-sm text-cc-muted">
              Configure API access, notifications, appearance, and workspace defaults.
            </p>
          </div>
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

      {/* Mobile horizontal nav */}
      <div className="sm:hidden shrink-0 border-b border-cc-border">
        <nav
          className="flex gap-1 px-4 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Settings categories"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => scrollToSection(cat.id)}
              className={`shrink-0 px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeSection === cat.id
                  ? "text-cc-primary bg-cc-primary/8"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Body: desktop sidebar + content */}
      <div className="flex-1 min-h-0 flex max-w-5xl w-full mx-auto">
        {/* Desktop sidebar nav */}
        <nav
          className="hidden sm:flex flex-col gap-0.5 w-44 shrink-0 pt-2 pr-6 pl-8 sticky top-0 self-start"
          aria-label="Settings categories"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => scrollToSection(cat.id)}
              className={`text-left px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeSection === cat.id
                  ? "text-cc-primary bg-cc-primary/8"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        {/* Scrollable content */}
        <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-8 sm:pl-0 pb-safe">
          <div className="space-y-10 py-4 sm:py-2">
            {/* General */}
            <section id="general" ref={setSectionRef("general")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">General</h2>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  <span>Theme</span>
                  <span className="text-xs text-cc-muted">{darkMode ? "Dark" : "Light"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditorTabEnabled((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  <span>Enable Editor tab (CodeMirror)</span>
                  <span className="text-xs text-cc-muted">{editorTabEnabled ? "On" : "Off"}</span>
                </button>
                <p className="text-xs text-cc-muted px-1">
                  Shows a simple in-app file editor in the session tabs.
                </p>

                <button
                  type="button"
                  onClick={() => setDiffBase(diffBase === "last-commit" ? "default-branch" : "last-commit")}
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  <span>Diff compare against</span>
                  <span className="text-xs text-cc-muted">
                    {diffBase === "last-commit" ? "Last commit (HEAD)" : "Default branch"}
                  </span>
                </button>
                <p className="text-xs text-cc-muted px-1">
                  Last commit shows only uncommitted changes. Default branch shows all changes since diverging from main.
                </p>
              </div>
            </section>

            {/* Connectivity */}
            <section id="connectivity" ref={setSectionRef("connectivity")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Connectivity</h2>
              <div className="space-y-4">
                <p className="text-xs text-cc-muted">
                  HeyHank needs an externally-reachable HTTPS URL for mobile access (PWA), webhooks (GitHub), and OAuth callbacks.
                </p>

                {/* Public URL */}
                <div className="bg-cc-hover/50 rounded-lg p-3 space-y-3">
                  <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Public URL</h3>
                  <p className="text-[11px] text-cc-muted">
                    If you have your own domain with a reverse proxy (nginx, Caddy), enter the URL here.
                  </p>
                  <input
                    id="public-url"
                    type="url"
                    aria-label="Public URL"
                    value={publicUrl}
                    onChange={(e) => setPublicUrl(e.target.value)}
                    placeholder="https://your-domain.example.com"
                    className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg border border-cc-border text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary font-mono-code"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        setSaving(true);
                        setError("");
                        try {
                          const res = await api.updateSettings({ publicUrl: publicUrl.trim() });
                          setPublicUrl(res.publicUrl);
                          useStore.getState().setPublicUrl(res.publicUrl);
                          setSaved(true);
                          setTimeout(() => setSaved(false), 1800);
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cc-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                    >
                      {saving ? "Saving..." : saved ? "Saved!" : "Save"}
                    </button>
                    {publicUrl && (
                      <span className="text-[11px] text-green-500 font-medium">Active: {publicUrl}</span>
                    )}
                    {!publicUrl && (
                      <span className="text-[11px] text-cc-muted">Not set — using {typeof window !== "undefined" ? window.location.origin : "http://localhost:3456"}</span>
                    )}
                  </div>
                </div>

                {/* Tailscale */}
                <div className="bg-cc-hover/50 rounded-lg p-3 space-y-3">
                  <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Tailscale (no domain needed)</h3>
                  <p className="text-[11px] text-cc-muted">
                    No domain? Tailscale Funnel gives you a free HTTPS URL automatically. Install Tailscale on your server, then enable Funnel here.
                  </p>
                  <TailscaleStatusInline />
                </div>

                {/* What this enables */}
                <div className="bg-cc-hover/50 rounded-lg p-3 space-y-2">
                  <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">What the Public URL enables</h3>
                  <ul className="text-[11px] text-cc-muted space-y-1 list-disc pl-4">
                    <li>Mobile access — install HeyHank as PWA on your phone</li>
                    <li>Webhooks — receive events from GitHub and other services</li>
                    <li>OAuth callbacks — authenticate with external services</li>
                    <li>Federation — connect multiple HeyHank instances</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Authentication */}
            <section id="authentication" ref={setSectionRef("authentication")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Authentication</h2>
              <div className="space-y-4">
                <p className="text-xs text-cc-muted">
                  Use the auth token or QR code to connect additional devices (e.g. mobile over Tailscale).
                </p>

                {/* Token display */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">Auth Token</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg font-mono-code select-all break-all flex items-center">
                      {authToken
                        ? tokenRevealed
                          ? authToken
                          : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                        : <span className="text-cc-muted">Loading...</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTokenRevealed((v) => !v)}
                      className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm bg-cc-hover hover:bg-cc-active text-cc-fg transition-colors cursor-pointer"
                      title={tokenRevealed ? "Hide token" : "Show token"}
                    >
                      {tokenRevealed ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (authToken) {
                          navigator.clipboard.writeText(authToken).then(() => {
                            setTokenCopied(true);
                            setTimeout(() => setTokenCopied(false), 1500);
                          });
                        }
                      }}
                      disabled={!authToken}
                      className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm bg-cc-hover hover:bg-cc-active text-cc-fg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Copy token to clipboard"
                    >
                      {tokenCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* QR code with address tabs */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">Mobile Login QR</label>
                  {qrCodes && qrCodes.length > 0 ? (
                    <div className="space-y-3">
                      {/* Address tabs — pick which network to use */}
                      {qrCodes.length > 1 && (
                        <div className="flex gap-1">
                          {qrCodes.map((qr, i) => (
                            <button
                              key={qr.label}
                              type="button"
                              onClick={() => setSelectedQrIndex(i)}
                              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                i === selectedQrIndex
                                  ? "bg-cc-primary text-white"
                                  : "bg-cc-hover text-cc-muted hover:text-cc-fg"
                              }`}
                            >
                              {qr.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="inline-block rounded-lg bg-white p-2">
                        <img
                          src={qrCodes[selectedQrIndex].qrDataUrl}
                          alt={`QR code for ${qrCodes[selectedQrIndex].label} login`}
                          className="w-48 h-48"
                        />
                      </div>
                      <div className="px-3 py-2 rounded-lg bg-cc-bg text-sm font-mono-code text-cc-fg break-all select-all">
                        {qrCodes[selectedQrIndex].url}
                      </div>
                      <p className="text-xs text-cc-muted">
                        Scan with your phone&apos;s camera app — it will open the URL and auto-authenticate.
                      </p>
                    </div>
                  ) : qrCodes && qrCodes.length === 0 ? (
                    <p className="text-xs text-cc-muted">
                      No remote addresses detected (LAN or Tailscale). Connect to a network to generate a QR code.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        setQrLoading(true);
                        try {
                          const data = await api.getAuthQr();
                          setQrCodes(data.qrCodes);
                        } catch {
                          // QR generation failed silently — user can retry
                        } finally {
                          setQrLoading(false);
                        }
                      }}
                      disabled={qrLoading}
                      className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                        qrLoading
                          ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                          : "bg-cc-hover hover:bg-cc-active text-cc-fg cursor-pointer"
                      }`}
                    >
                      {qrLoading ? "Generating..." : "Show QR Code"}
                    </button>
                  )}
                </div>

                {/* Regenerate token */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Regenerate auth token? All existing sessions on other devices will be signed out.")) return;
                      setRegenerating(true);
                      try {
                        const res = await api.regenerateAuthToken();
                        setAuthToken(res.token);
                        setTokenRevealed(true);
                        setQrCodes(null); // invalidate old QR
                      } catch {
                        // Regeneration failed
                      } finally {
                        setRegenerating(false);
                      }
                    }}
                    disabled={regenerating}
                    className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                      regenerating
                        ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                        : "bg-cc-error/10 hover:bg-cc-error/20 text-cc-error cursor-pointer"
                    }`}
                  >
                    {regenerating ? "Regenerating..." : "Regenerate Token"}
                  </button>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Creates a new token. All other signed-in devices will need to re-authenticate.
                  </p>
                </div>
              </div>
            </section>

            {/* Notifications */}
            <section id="notifications" ref={setSectionRef("notifications")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Notifications</h2>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={toggleNotificationSound}
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  <span>Sound</span>
                  <span className="text-xs text-cc-muted">{notificationSound ? "On" : "Off"}</span>
                </button>
                {notificationApiAvailable && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!notificationDesktop) {
                        if (Notification.permission !== "granted") {
                          const result = await Notification.requestPermission();
                          if (result !== "granted") return;
                        }
                        setNotificationDesktop(true);
                      } else {
                        setNotificationDesktop(false);
                      }
                    }}
                    className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                  >
                    <span>Desktop Alerts</span>
                    <span className="text-xs text-cc-muted">{notificationDesktop ? "On" : "Off"}</span>
                  </button>
                )}
                <PushNotificationToggle />
              </div>
            </section>

            {/* Providers */}
            <section id="providers" ref={setSectionRef("providers")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Providers</h2>
              <div className="space-y-6">
                <p className="text-xs text-cc-muted">
                  Connect AI backends to power your agent sessions. Configure CLI backends (Claude Code, Codex) and additional model providers for Claude Code's <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg">--provider</code> flag.
                </p>

                {/* Claude Code — primary backend */}
                <div className="space-y-3 p-4 bg-cc-bg rounded-lg border border-cc-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-cc-fg">Claude Code</h3>
                      {claudeCliAuth?.cliVersion && (
                        <p className="text-xs text-cc-muted mt-0.5">{claudeCliAuth.cliVersion}</p>
                      )}
                    </div>
                    {claudeCliAuth?.authenticated || claudeCodeTokenConfigured ? (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-cc-success/15 text-cc-success border border-cc-success/20">
                        Authenticated
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-cc-error/15 text-cc-error border border-cc-error/20">
                        Not configured
                      </span>
                    )}
                  </div>
                  {claudeCliAuth?.authenticated && (
                    <div className="px-3 py-2 rounded-lg bg-cc-success/5 border border-cc-success/10 text-xs text-cc-muted">
                      {claudeCliAuth.method === "cli_login" && <>Authenticated via <strong className="text-cc-fg">CLI login</strong>. Sessions authenticate automatically.</>}
                      {claudeCliAuth.method === "env_api_key" && <>Authenticated via <strong className="text-cc-fg">ANTHROPIC_API_KEY</strong> env var.</>}
                      {claudeCliAuth.method === "env_oauth" && <>Authenticated via <strong className="text-cc-fg">CLAUDE_CODE_OAUTH_TOKEN</strong> env var.</>}
                      {claudeCliAuth.method === "env_auth_token" && <>Authenticated via <strong className="text-cc-fg">ANTHROPIC_AUTH_TOKEN</strong> env var.</>}
                    </div>
                  )}
                  {!claudeCliAuth?.authenticated && !claudeCodeTokenConfigured && (
                    <div className="px-3 py-2.5 rounded-lg bg-cc-primary/5 border border-cc-primary/15 text-xs text-cc-muted space-y-1.5">
                      <p><strong>CLI Login:</strong> Run <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg">claude login</code> on the server.</p>
                      <p><strong>OAuth Token:</strong> Paste a token from <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg">claude setup-token</code> below.</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="block text-xs text-cc-muted" htmlFor="claude-code-token">OAuth Token {claudeCliAuth?.authenticated ? "(optional)" : ""}</label>
                    <input id="claude-code-token" type="password"
                      value={claudeCodeTokenConfigured && !claudeTokenFocused && !claudeCodeToken ? "••••••••••••••••" : claudeCodeToken}
                      onChange={(e) => setClaudeCodeToken(e.target.value)}
                      onFocus={() => setClaudeTokenFocused(true)} onBlur={() => setClaudeTokenFocused(false)}
                      placeholder={claudeCodeTokenConfigured ? "Enter a new token to replace" : "Paste token from claude setup-token"}
                      className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow" />
                  </div>
                </div>

                {/* OpenAI Codex — primary backend */}
                <div className="space-y-3 p-4 bg-cc-bg rounded-lg border border-cc-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-cc-fg">OpenAI Codex</h3>
                      {codexCliAuth?.cliVersion && <p className="text-xs text-cc-muted mt-0.5">{codexCliAuth.cliVersion}</p>}
                    </div>
                    {codexCliAuth?.authenticated || openaiApiKeyConfigured ? (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-cc-success/15 text-cc-success border border-cc-success/20">Authenticated</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-cc-error/15 text-cc-error border border-cc-error/20">Not configured</span>
                    )}
                  </div>
                  {codexCliAuth?.authenticated && (
                    <div className="px-3 py-2 rounded-lg bg-cc-success/5 border border-cc-success/10 text-xs text-cc-muted">
                      {codexCliAuth.method === "cli_login" && <>Authenticated via <strong className="text-cc-fg">device login</strong>.</>}
                      {codexCliAuth.method === "env_api_key" && <>Authenticated via <strong className="text-cc-fg">OPENAI_API_KEY</strong> env var.</>}
                    </div>
                  )}
                  {!codexCliAuth?.authenticated && !openaiApiKeyConfigured && (
                    <div className="px-3 py-2.5 rounded-lg bg-cc-primary/5 border border-cc-primary/15 text-xs text-cc-muted space-y-1.5">
                      <p><strong>Device Login:</strong> Run <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg">codex --login</code> on the server.</p>
                      <p><strong>API Key:</strong> Enter your key below from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-cc-primary hover:underline">platform.openai.com</a>.</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="block text-xs text-cc-muted" htmlFor="openai-api-key">API Key {codexCliAuth?.authenticated ? "(optional)" : ""}</label>
                    <input id="openai-api-key" type="password"
                      value={openaiApiKeyConfigured && !openaiKeyFocused && !openaiApiKey ? "••••••••••••••••" : openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      onFocus={() => setOpenaiKeyFocused(true)} onBlur={() => setOpenaiKeyFocused(false)}
                      placeholder={openaiApiKeyConfigured ? "Enter a new key to replace" : "sk-..."}
                      className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow" />
                  </div>
                </div>

                {providerError && (
                  <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">{providerError}</div>
                )}
                {providerSaved && (
                  <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">Provider settings saved.</div>
                )}
                <button type="button"
                  disabled={providerSaving || (!claudeCodeToken.trim() && !openaiApiKey.trim())}
                  onClick={async () => {
                    setProviderSaving(true); setProviderError(""); setProviderSaved(false);
                    try {
                      const payload: { claudeCodeOAuthToken?: string; openaiApiKey?: string } = {};
                      if (claudeCodeToken.trim()) payload.claudeCodeOAuthToken = claudeCodeToken.trim();
                      if (openaiApiKey.trim()) payload.openaiApiKey = openaiApiKey.trim();
                      const res = await api.updateSettings(payload);
                      setClaudeCodeTokenConfigured(res.claudeCodeOAuthTokenConfigured);
                      setOpenaiApiKeyConfigured(res.openaiApiKeyConfigured);
                      if (res.claudeCliAuth) setClaudeCliAuth(res.claudeCliAuth);
                      if (res.codexCliAuth) setCodexCliAuth(res.codexCliAuth);
                      setClaudeCodeToken(""); setOpenaiApiKey("");
                      setProviderSaved(true); setTimeout(() => setProviderSaved(false), 1800);
                    } catch (err: unknown) { setProviderError(err instanceof Error ? err.message : String(err)); }
                    finally { setProviderSaving(false); }
                  }}
                  className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                    providerSaving || (!claudeCodeToken.trim() && !openaiApiKey.trim())
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white cursor-pointer"
                  }`}
                >{providerSaving ? "Saving..." : "Save CLI Backend Settings"}</button>

                {/* Additional Model Providers — collapsible */}
                <details className="border-t border-cc-border pt-4 group">
                  <summary className="flex items-center justify-between cursor-pointer list-none">
                    <div>
                      <h3 className="text-sm font-medium text-cc-fg">Additional Providers</h3>
                      <p className="text-xs text-cc-muted mt-0.5">
                        Configure model providers for Claude Code's <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg text-[10px]">--provider</code> flag.
                      </p>
                    </div>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-muted transition-transform group-open:rotate-180">
                      <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </summary>
                  <div className="mt-4">
                    <ProviderGrid />
                  </div>
                </details>
              </div>
            </section>

            {/* Gemini */}
            <section id="gemini" ref={setSectionRef("gemini")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Gemini</h2>
              <div className="space-y-6">
                <p className="text-xs text-cc-muted">
                  Configure Gemini Live for voice chat. Get an API key from{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-cc-primary hover:underline">
                    Google AI Studio
                  </a>.
                </p>

                {/* Gemini API Key */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium" htmlFor="gemini-api-key">
                    Gemini API Key
                  </label>
                  <input
                    id="gemini-api-key"
                    type="password"
                    value={geminiApiKeyConfigured && !geminiKeyFocused && !geminiApiKey ? "••••••••••••••••" : geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    onFocus={() => setGeminiKeyFocused(true)}
                    onBlur={() => setGeminiKeyFocused(false)}
                    placeholder={geminiApiKeyConfigured ? "Enter a new key to replace" : "AIza..."}
                    className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
                  />
                  <p className="text-xs text-cc-muted">
                    {geminiApiKeyConfigured ? "Gemini API key configured" : "Gemini API key not configured"}
                  </p>
                </div>

                {/* Assistant Name */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium" htmlFor="assistant-name">
                    Assistant Name
                  </label>
                  <input
                    id="assistant-name"
                    type="text"
                    value={assistantName}
                    onChange={(e) => setAssistantName(e.target.value)}
                    placeholder="e.g. Jarvis, Friday, Max"
                    className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
                  />
                  <p className="text-xs text-cc-muted">
                    Give your voice assistant a custom name. Leave empty for default.
                  </p>
                </div>

                {/* User Name */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium" htmlFor="user-name">
                    Your Name
                  </label>
                  <input
                    id="user-name"
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. Markus"
                    className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
                  />
                  <p className="text-xs text-cc-muted">
                    Your name so Gemini knows who it's talking to.
                  </p>
                </div>

                {/* Voice Selection */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium" htmlFor="gemini-voice">
                    Voice
                  </label>
                  <select
                    id="gemini-voice"
                    value={geminiVoice}
                    onChange={(e) => setGeminiVoice(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
                  >
                    <option value="Kore">Kore (female, firm)</option>
                    <option value="Puck">Puck (male, playful)</option>
                    <option value="Charon">Charon (male, deep)</option>
                    <option value="Fenrir">Fenrir (male, bold)</option>
                    <option value="Aoede">Aoede (female, bright)</option>
                    <option value="Leda">Leda (female, gentle)</option>
                    <option value="Orus">Orus (male, clear)</option>
                    <option value="Zephyr">Zephyr (neutral, calm)</option>
                  </select>
                </div>

                {geminiError && (
                  <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
                    {geminiError}
                  </div>
                )}

                {geminiSaved && (
                  <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
                    Gemini settings saved.
                  </div>
                )}

                <button
                  type="button"
                  disabled={geminiSaving || (!geminiApiKey.trim() && geminiVoice === geminiVoiceOriginal && assistantName === assistantNameOriginal && userName === userNameOriginal)}
                  onClick={async () => {
                    setGeminiSaving(true);
                    setGeminiError("");
                    setGeminiSaved(false);
                    try {
                      const payload: { geminiApiKey?: string; geminiVoice?: string; assistantName?: string; userName?: string } = {};
                      if (geminiApiKey.trim()) payload.geminiApiKey = geminiApiKey.trim();
                      payload.assistantName = assistantName;
                      payload.userName = userName;
                      payload.geminiVoice = geminiVoice;
                      const res = await api.updateSettings(payload);
                      setGeminiApiKeyConfigured(res.geminiApiKeyConfigured);
                      if (res.geminiVoice) { setGeminiVoice(res.geminiVoice); setGeminiVoiceOriginal(res.geminiVoice); }
                      if (typeof res.assistantName === "string") { setAssistantName(res.assistantName); setAssistantNameOriginal(res.assistantName); }
                      if (typeof res.userName === "string") { setUserName(res.userName); setUserNameOriginal(res.userName); }
                      setGeminiApiKey("");
                      setGeminiSaved(true);
                      setTimeout(() => setGeminiSaved(false), 1800);
                    } catch (err: unknown) {
                      setGeminiError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setGeminiSaving(false);
                    }
                  }}
                  className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                    geminiSaving
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white cursor-pointer"
                  }`}
                >
                  {geminiSaving ? "Saving..." : "Save Gemini Settings"}
                </button>
              </div>
            </section>

            {/* Email Accounts */}
            <section id="email" ref={setSectionRef("email")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Email Accounts</h2>
              <div className="space-y-4">
                <p className="text-xs text-cc-muted">
                  Configure IMAP/SMTP email accounts for the voice assistant. Gemini can read, search, and send emails on your behalf.
                </p>

                {/* Account list */}
                {emailLoading ? (
                  <p className="text-xs text-cc-muted">Loading accounts...</p>
                ) : emailAccounts.length === 0 ? (
                  <p className="text-xs text-cc-muted">No email accounts configured.</p>
                ) : (
                  <div className="space-y-2">
                    {emailAccounts.map((acc) => (
                      <div key={acc.id} className="flex items-center justify-between px-3 py-2.5 bg-cc-bg rounded-lg">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-cc-fg truncate">{acc.name}</div>
                          <div className="text-xs text-cc-muted truncate">{acc.email}</div>
                          <div className="text-xs text-cc-muted">IMAP: {acc.imap.host}:{acc.imap.port} | SMTP: {acc.smtp.host}:{acc.smtp.port}</div>
                          {emailTestResult?.id === acc.id && (
                            <div className={`text-xs mt-1 ${emailTestResult.ok ? "text-cc-success" : "text-cc-error"}`}>
                              {emailTestResult.message}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1.5 ml-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => testEmailAccount(acc.id)}
                            disabled={emailTesting === acc.id}
                            className="px-2 py-1 text-xs rounded bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                          >
                            {emailTesting === acc.id ? "..." : "Test"}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditEmail(acc)}
                            className="px-2 py-1 text-xs rounded bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteEmailAccount(acc.id)}
                            className="px-2 py-1 text-xs rounded bg-cc-error/10 text-cc-error hover:bg-cc-error/20 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add/Edit form */}
                {!showEmailForm ? (
                  <button
                    type="button"
                    onClick={() => { resetEmailForm(); setShowEmailForm(true); }}
                    className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white transition-colors cursor-pointer"
                  >
                    Add Email Account
                  </button>
                ) : (
                  <div className="space-y-3 p-4 bg-cc-bg rounded-lg border border-cc-border">
                    <h3 className="text-sm font-medium text-cc-fg">
                      {editingEmail ? `Edit: ${editingEmail.name}` : "Add Email Account"}
                    </h3>

                    {/* Quick presets with info tooltips */}
                    {!editingEmail && (
                      <div className="space-y-1">
                        <p className="text-xs text-cc-muted font-medium">Quick presets:</p>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            { label: "Gmail", imap: "imap.gmail.com", smtp: "smtp.gmail.com", imapPort: "993", smtpPort: "465", info: "1. Go to myaccount.google.com\n2. Security \u2192 2-Step Verification (must be ON)\n3. Search for \"App passwords\" or go to myaccount.google.com/apppasswords\n4. Create a new App Password (name: e.g. \"Email Agent\")\n5. Copy the 16-character password\n6. Use your Gmail address as both Email and Username\n\nNote: If \"App passwords\" is not available, 2-Step Verification is not enabled yet." },
                            { label: "Outlook", imap: "outlook.office365.com", smtp: "smtp.office365.com", imapPort: "993", smtpPort: "587", smtpSecure: false, info: "1. Go to account.microsoft.com\n2. Security \u2192 Advanced security options\n3. Enable 2-Step Verification if not active\n4. App passwords \u2192 Create a new app password\n5. Copy the generated password\n6. Use your Outlook/Hotmail email as both Email and Username\n\nNote: SMTP uses port 587 with STARTTLS (not SSL). For work/school accounts, ask your admin about IMAP access." },
                            { label: "Hostinger", imap: "imap.hostinger.com", smtp: "smtp.hostinger.com", imapPort: "993", smtpPort: "465", info: "1. Use the email address you created in Hostinger\n2. Use the same password you set for the email account\n3. IMAP: imap.hostinger.com (Port 993, SSL)\n4. SMTP: smtp.hostinger.com (Port 465, SSL)\n\nNo App Password needed \u2014 use your regular email password." },
                            { label: "World4You", imap: "imap.world4you.com", smtp: "smtp.world4you.com", imapPort: "993", smtpPort: "465", info: "1. Use your World4You email address\n2. Use the password from your World4You control panel\n3. IMAP: imap.world4you.com (Port 993, SSL)\n4. SMTP: smtp.world4you.com (Port 465, SSL)\n\nNo App Password needed \u2014 use your regular email password." },
                          ].map((preset) => (
                            <div key={preset.label} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEmailForm((f) => ({
                                  ...f,
                                  imapHost: preset.imap,
                                  smtpHost: preset.smtp,
                                  imapPort: preset.imapPort,
                                  smtpPort: preset.smtpPort,
                                  imapSecure: true,
                                  smtpSecure: (preset as { smtpSecure?: boolean }).smtpSecure !== false,
                                }))}
                                className="px-2 py-1 text-xs rounded bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer border border-cc-border"
                              >
                                {preset.label}
                              </button>
                              <div className="relative group">
                                <div className="w-4 h-4 flex items-center justify-center rounded-full bg-cc-hover text-cc-muted text-[10px] font-bold cursor-help border border-cc-border group-hover:bg-cc-primary group-hover:text-white group-hover:border-cc-primary transition-colors">
                                  i
                                </div>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-lg bg-cc-card border border-cc-border shadow-lg text-xs text-cc-fg whitespace-pre-line opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                                  <div className="font-semibold mb-1.5 text-cc-primary">{preset.label} Setup</div>
                                  {preset.info}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-cc-card border-r border-b border-cc-border rotate-45" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-cc-muted mb-1">Display Name</label>
                        <input
                          type="text"
                          value={emailForm.name}
                          onChange={(e) => setEmailForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. Gmail, Work, Personal"
                          className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-cc-muted mb-1">Email Address</label>
                        <input
                          type="email"
                          value={emailForm.email}
                          onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                          placeholder="user@example.com"
                          className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                      </div>
                    </div>

                    {/* IMAP */}
                    <div>
                      <label className="block text-xs text-cc-muted mb-1 font-medium">IMAP (Incoming)</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={emailForm.imapHost}
                          onChange={(e) => setEmailForm((f) => ({ ...f, imapHost: e.target.value }))}
                          placeholder="imap.example.com"
                          className="col-span-2 px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={emailForm.imapPort}
                            onChange={(e) => setEmailForm((f) => ({ ...f, imapPort: e.target.value }))}
                            placeholder="993"
                            className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 mt-1.5 text-xs text-cc-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={emailForm.imapSecure}
                          onChange={(e) => setEmailForm((f) => ({ ...f, imapSecure: e.target.checked }))}
                          className="rounded"
                        />
                        SSL/TLS
                      </label>
                    </div>

                    {/* SMTP */}
                    <div>
                      <label className="block text-xs text-cc-muted mb-1 font-medium">SMTP (Outgoing)</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={emailForm.smtpHost}
                          onChange={(e) => setEmailForm((f) => ({ ...f, smtpHost: e.target.value }))}
                          placeholder="smtp.example.com"
                          className="col-span-2 px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                        <input
                          type="text"
                          value={emailForm.smtpPort}
                          onChange={(e) => setEmailForm((f) => ({ ...f, smtpPort: e.target.value }))}
                          placeholder="465"
                          className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                      </div>
                      <label className="flex items-center gap-2 mt-1.5 text-xs text-cc-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={emailForm.smtpSecure}
                          onChange={(e) => setEmailForm((f) => ({ ...f, smtpSecure: e.target.checked }))}
                          className="rounded"
                        />
                        SSL/TLS
                      </label>
                    </div>

                    {/* Auth */}
                    <div>
                      <label className="block text-xs text-cc-muted mb-1 font-medium">Authentication</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={emailForm.authUser}
                          onChange={(e) => setEmailForm((f) => ({ ...f, authUser: e.target.value }))}
                          placeholder="Username / Email"
                          className="px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                        <input
                          type="password"
                          value={emailForm.authPass}
                          onChange={(e) => setEmailForm((f) => ({ ...f, authPass: e.target.value }))}
                          placeholder={editingEmail ? "New password (leave empty to keep)" : "Password / App Password"}
                          className="px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                      </div>
                    </div>

                    {emailError && (
                      <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
                        {emailError}
                      </div>
                    )}

                    {emailSaved && (
                      <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
                        {emailSaved}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveEmailAccount}
                        className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white transition-colors cursor-pointer"
                      >
                        {editingEmail ? "Update Account" : "Add Account"}
                      </button>
                      <button
                        type="button"
                        onClick={resetEmailForm}
                        className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </section>

            {/* Calendar */}
            <section id="calendar" ref={setSectionRef("calendar")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Calendar Accounts</h2>
              <p className="text-xs text-cc-muted mb-4">
                Connect CalDAV calendars (Google Calendar, iCloud, Outlook, Nextcloud, etc.) so your assistant can manage events.
              </p>

              {calError && <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error mb-2">{calError}</div>}
              {calSaved && <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success mb-2">{calSaved}</div>}

              {/* Existing accounts list */}
              {calLoading ? (
                <div className="text-xs text-cc-muted">Loading...</div>
              ) : calAccounts.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {calAccounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between px-3 py-2.5 bg-cc-bg rounded-lg">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-cc-fg truncate">{acc.name}</div>
                        <div className="text-xs text-cc-muted truncate">{acc.auth.user} ({acc.provider})</div>
                        {calTestResult?.id === acc.id && (
                          <div className={`text-xs mt-1 ${calTestResult.ok ? "text-cc-success" : "text-cc-error"}`}>
                            {calTestResult.message}
                            {calTestResult.calendars && (
                              <span className="text-cc-muted"> — Calendars: {calTestResult.calendars.join(", ")}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 ml-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => testCalendarAccount(acc.id)}
                          disabled={calTesting === acc.id}
                          className="px-2 py-1 text-xs rounded bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                        >
                          {calTesting === acc.id ? "..." : "Test"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditCal(acc)}
                          className="px-2 py-1 text-xs rounded bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCalendarAccount(acc.id)}
                          className="px-2 py-1 text-xs rounded bg-cc-error/10 text-cc-error hover:bg-cc-error/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-cc-muted mb-4">No calendar accounts configured.</div>
              )}

              {/* Add / Edit form */}
              {!showCalForm && (
                <button
                  type="button"
                  onClick={() => { resetCalForm(); setShowCalForm(true); }}
                  className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white transition-colors cursor-pointer"
                >
                  Add Calendar Account
                </button>
              )}

              {showCalForm && (
                <div className="space-y-3 p-4 bg-cc-bg rounded-lg border border-cc-border">
                  <h3 className="text-sm font-medium text-cc-fg">
                    {editingCal ? "Edit Calendar Account" : "Add Calendar Account"}
                  </h3>

                  {/* Provider selection with info tooltips */}
                  <div>
                    <label className="block text-xs text-cc-muted mb-1 font-medium">Provider</label>
                    <div className="flex gap-2 flex-wrap">
                      {([
                        { id: "google" as const, label: "Google", info: "1. Go to myaccount.google.com\n2. Security \u2192 2-Step Verification (must be ON)\n3. Search for \"App passwords\" or go to myaccount.google.com/apppasswords\n4. Create a new App Password (name: e.g. \"Calendar\")\n5. Copy the 16-character password (format: xxxx xxxx xxxx xxxx)\n6. Use your Gmail address as username and the App Password here" },
                        { id: "icloud" as const, label: "iCloud", info: "1. Go to appleid.apple.com and sign in\n2. Sign-In and Security \u2192 App-Specific Passwords\n3. Click \"+\" to generate a new password\n4. Name it (e.g. \"Calendar Agent\")\n5. Copy the generated password (format: xxxx-xxxx-xxxx-xxxx)\n6. Use your Apple ID email as username and the App-Specific Password here\n\nNote: 2-Factor Authentication must be enabled (default for iCloud)" },
                        { id: "outlook" as const, label: "Outlook", info: "1. Go to account.microsoft.com and sign in\n2. Security \u2192 Advanced security options\n3. App passwords \u2192 Create a new app password\n4. Copy the generated password\n5. Use your Outlook/Hotmail email as username\n\nCalDAV URL: https://outlook.office365.com/caldav/\n\nNote: App Passwords require 2-Step Verification to be enabled. For work/school accounts, your admin may need to enable CalDAV access." },
                        { id: "caldav" as const, label: "CalDAV", info: "For Nextcloud:\n  URL: https://your-server.com/remote.php/dav/\n\nFor Synology:\n  URL: https://your-nas:5001/caldav/\n\nFor other servers, check your provider's CalDAV documentation for the correct URL." },
                      ]).map((p) => (
                        <div key={p.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => applyCalPreset(p.id)}
                            className={`px-2 py-1 text-xs rounded border transition-colors cursor-pointer ${calForm.provider === p.id ? "bg-cc-primary-btn text-white border-cc-primary-btn" : "bg-cc-hover text-cc-fg border-cc-border hover:bg-cc-active"}`}
                          >
                            {p.label}
                          </button>
                          <div className="relative group">
                            <div className="w-4 h-4 flex items-center justify-center rounded-full bg-cc-hover text-cc-muted text-[10px] font-bold cursor-help border border-cc-border group-hover:bg-cc-primary group-hover:text-white group-hover:border-cc-primary transition-colors">
                              i
                            </div>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-lg bg-cc-card border border-cc-border shadow-lg text-xs text-cc-fg whitespace-pre-line opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                              <div className="font-semibold mb-1.5 text-cc-primary">{p.label} Setup</div>
                              {p.info}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-cc-card border-r border-b border-cc-border rotate-45" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-cc-muted mb-1">Display Name</label>
                      <input
                        type="text"
                        value={calForm.name}
                        onChange={(e) => setCalForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Google, iCloud, Work"
                        className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                      />
                    </div>
                    {(calForm.provider === "caldav" || calForm.provider === "outlook") && (
                      <div>
                        <label className="block text-xs text-cc-muted mb-1">Server URL</label>
                        <input
                          type="text"
                          value={calForm.serverUrl}
                          onChange={(e) => setCalForm((f) => ({ ...f, serverUrl: e.target.value }))}
                          placeholder={calForm.provider === "outlook" ? "https://outlook.office365.com/caldav/" : "https://cloud.example.com/remote.php/dav/"}
                          className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-cc-muted mb-1">Username / Email</label>
                      <input
                        type="text"
                        value={calForm.authUser}
                        onChange={(e) => setCalForm((f) => ({ ...f, authUser: e.target.value }))}
                        placeholder={calForm.provider === "google" ? "you@gmail.com" : calForm.provider === "icloud" ? "you@icloud.com" : calForm.provider === "outlook" ? "you@outlook.com" : "username"}
                        className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-cc-muted mb-1">Password / App Password</label>
                      <input
                        type="password"
                        value={calForm.authPass}
                        onChange={(e) => setCalForm((f) => ({ ...f, authPass: e.target.value }))}
                        placeholder={editingCal ? "New password (leave empty to keep)" : "App Password"}
                        className="w-full px-3 py-2 text-sm bg-cc-input-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveCalendarAccount}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white transition-colors cursor-pointer"
                    >
                      {editingCal ? "Update Account" : "Add Account"}
                    </button>
                    <button
                      type="button"
                      onClick={resetCalForm}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* AI Features */}
            <section id="ai-features" ref={setSectionRef("ai-features")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">HeyHank AI Features</h2>
              <div className="space-y-4">
                <p className="text-xs text-cc-muted leading-relaxed">
                  These features use any enabled provider configured under Providers → Additional Providers above.
                </p>

                {/* Auto-Renaming info */}
                <div className="px-3 py-2.5 rounded-lg bg-cc-hover/50 border border-cc-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-cc-fg">Auto-Rename Sessions</span>
                    <span className={`text-xs font-medium ${configured ? "text-cc-success" : "text-cc-muted"}`}>
                      {configured ? "Active" : "No provider"}
                    </span>
                  </div>
                  <p className="text-[11px] text-cc-muted mt-1">
                    Automatically generates a short title for new sessions based on the first message.
                  </p>
                </div>

                {/* AI Validation */}
                <div className="space-y-3 p-3 bg-cc-bg rounded-lg border border-cc-border">
                  <h3 className="text-xs font-medium text-cc-fg">AI Validation</h3>
                  <p className="text-[11px] text-cc-muted leading-relaxed">
                    An AI model evaluates tool calls before execution. Safe ops are auto-approved, dangerous ones blocked.
                    Uses any configured provider. Per-session overrides via the shield icon.
                  </p>

                  <button type="button"
                    onClick={() => toggleAiValidation("aiValidationEnabled")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-cc-hover hover:bg-cc-active text-cc-fg transition-colors cursor-pointer"
                  >
                    <span className="text-sm">AI Validation</span>
                    <span className={`text-xs font-medium ${aiValidationEnabled ? "text-cc-success" : "text-cc-muted"}`}>
                      {aiValidationEnabled ? "On" : "Off"}
                    </span>
                  </button>

                  {aiValidationEnabled && (
                    <>
                      <button type="button" onClick={() => toggleAiValidation("aiValidationAutoApprove")}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-cc-hover hover:bg-cc-active text-cc-fg transition-colors cursor-pointer">
                        <div>
                          <span className="text-sm">Auto-approve safe tools</span>
                          <p className="text-[11px] text-cc-muted mt-0.5">Allow read-only tools automatically</p>
                        </div>
                        <span className={`text-xs font-medium ${aiValidationAutoApprove ? "text-cc-success" : "text-cc-muted"}`}>
                          {aiValidationAutoApprove ? "On" : "Off"}
                        </span>
                      </button>
                      <button type="button" onClick={() => toggleAiValidation("aiValidationAutoDeny")}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-cc-hover hover:bg-cc-active text-cc-fg transition-colors cursor-pointer">
                        <div>
                          <span className="text-sm">Auto-deny dangerous tools</span>
                          <p className="text-[11px] text-cc-muted mt-0.5">Block destructive commands like rm -rf</p>
                        </div>
                        <span className={`text-xs font-medium ${aiValidationAutoDeny ? "text-cc-success" : "text-cc-muted"}`}>
                          {aiValidationAutoDeny ? "On" : "Off"}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* Updates */}
            <section id="updates" ref={setSectionRef("updates")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Updates</h2>
              <div className="space-y-3">
                {updateInfo ? (
                  <p className="text-xs text-cc-muted">
                    Current version: v{updateInfo.currentVersion}
                    {updateInfo.latestVersion ? ` • Latest: v${updateInfo.latestVersion}` : ""}
                    {updateInfo.channel === "prerelease" ? " (prerelease)" : ""}
                  </p>
                ) : (
                  <p className="text-xs text-cc-muted">Version information not loaded yet.</p>
                )}

                <div>
                  <span id="update-channel-label" className="block text-sm font-medium mb-1.5">
                    Update Channel
                  </span>
                  <div className="flex gap-1" role="radiogroup" aria-labelledby="update-channel-label">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={updateChannel === "stable"}
                      onClick={async () => {
                        if (updateChannel === "stable") return;
                        setUpdateChannel("stable");
                        try {
                          await api.updateSettings({ updateChannel: "stable" });
                        } catch {
                          setUpdateChannel("prerelease");
                          return;
                        }
                        try {
                          const info = await api.forceCheckForUpdate();
                          setUpdateInfo(info);
                        } catch { /* settings saved; swallow check error */ }
                      }}
                      className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                        updateChannel === "stable"
                          ? "bg-cc-primary text-white"
                          : "bg-cc-hover text-cc-muted hover:text-cc-fg hover:bg-cc-active"
                      }`}
                    >
                      Stable
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={updateChannel === "prerelease"}
                      onClick={async () => {
                        if (updateChannel === "prerelease") return;
                        setUpdateChannel("prerelease");
                        try {
                          await api.updateSettings({ updateChannel: "prerelease" });
                        } catch {
                          setUpdateChannel("stable");
                          return;
                        }
                        try {
                          const info = await api.forceCheckForUpdate();
                          setUpdateInfo(info);
                        } catch { /* settings saved; swallow check error */ }
                      }}
                      className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                        updateChannel === "prerelease"
                          ? "bg-cc-primary text-white"
                          : "bg-cc-hover text-cc-muted hover:text-cc-fg hover:bg-cc-active"
                      }`}
                    >
                      Prerelease
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    {updateChannel === "prerelease"
                      ? "Tracking prerelease channel. You will receive preview builds from the latest main branch."
                      : "Tracking stable channel. You will only receive versioned releases."}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-sm font-medium">Auto-update Docker image</span>
                    <p className="mt-0.5 text-xs text-cc-muted">
                      Automatically re-pull the sandbox Docker image when updating HeyHank
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dockerAutoUpdate}
                    onClick={async () => {
                      const next = !dockerAutoUpdate;
                      setDockerAutoUpdate(next);
                      try {
                        await api.updateSettings({ dockerAutoUpdate: next });
                      } catch {
                        setDockerAutoUpdate(!next);
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      dockerAutoUpdate ? "bg-cc-primary" : "bg-cc-hover"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                        dockerAutoUpdate ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {updateError && (
                  <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
                    {updateError}
                  </div>
                )}

                {updateStatus && (
                  <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
                    {updateStatus}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onCheckUpdates}
                    disabled={checkingUpdates}
                    className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                      checkingUpdates
                        ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                        : "bg-cc-hover hover:bg-cc-active text-cc-fg cursor-pointer"
                    }`}
                  >
                    {checkingUpdates ? "Checking..." : "Check for updates"}
                  </button>

                  {updateInfo?.isServiceMode ? (
                    <button
                      type="button"
                      onClick={onTriggerUpdate}
                      disabled={updatingApp || updateInfo.updateInProgress || !updateInfo.updateAvailable}
                      className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                        updatingApp || updateInfo.updateInProgress || !updateInfo.updateAvailable
                          ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                          : "bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white cursor-pointer"
                      }`}
                    >
                      {updatingApp || updateInfo.updateInProgress ? "Updating..." : "Update & Restart"}
                    </button>
                  ) : (
                    <p className="text-xs text-cc-muted self-center">
                      Install service mode with <code className="font-mono-code bg-cc-code-bg px-1 py-0.5 rounded text-cc-code-fg">heyhank install</code> to enable one-click updates.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Appearance */}
            <section id="appearance" ref={setSectionRef("appearance")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Appearance</h2>
              <div className="space-y-4">
                {/* Theme toggle */}
                <div>
                  <label className="text-xs text-cc-fg font-medium block mb-2">Theme</label>
                  <div className="flex items-center gap-2">
                    {(["light", "dark", "system"] as const).map((mode) => {
                      const isActive = mode === "system"
                        ? localStorage.getItem("cc-dark-mode") === null
                        : mode === "dark"
                          ? darkMode && localStorage.getItem("cc-dark-mode") !== null
                          : !darkMode && localStorage.getItem("cc-dark-mode") !== null;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            if (mode === "system") {
                              localStorage.removeItem("cc-dark-mode");
                              const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                              useStore.getState().setDarkMode(prefersDark);
                              // Re-set without persisting
                              localStorage.removeItem("cc-dark-mode");
                            } else {
                              useStore.getState().setDarkMode(mode === "dark");
                            }
                          }}
                          className={`flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            isActive
                              ? "bg-cc-primary/15 text-cc-primary border border-cc-primary/30"
                              : "bg-cc-hover text-cc-muted border border-transparent hover:text-cc-fg"
                          }`}
                        >
                          {mode === "light" && (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                          )}
                          {mode === "dark" && (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                          )}
                          {mode === "system" && (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                          )}
                          {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font size */}
                <div>
                  <label className="text-xs text-cc-fg font-medium block mb-2">Font Size</label>
                  <div className="flex items-center gap-3">
                    <input
                      id="font-size-slider"
                      type="range"
                      min="12"
                      max="20"
                      step="1"
                      value={parseInt(localStorage.getItem("cc-font-size") || "14", 10)}
                      onChange={(e) => {
                        const size = e.target.value;
                        localStorage.setItem("cc-font-size", size);
                        document.documentElement.style.fontSize = `${size}px`;
                      }}
                      className="flex-1 accent-cc-primary cursor-pointer"
                    />
                    <span className="text-xs text-cc-muted tabular-nums w-8 text-right">
                      {localStorage.getItem("cc-font-size") || "14"}px
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("cc-font-size");
                      document.documentElement.style.fontSize = "";
                      window.dispatchEvent(new Event("storage"));
                    }}
                    className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer mt-1"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            </section>

            {/* Environments */}
            <section id="environments" ref={setSectionRef("environments")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Environments</h2>
              <div className="space-y-3">
                <p className="text-xs text-cc-muted">
                  Manage reusable environment profiles used when creating sessions.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = "#/environments";
                  }}
                  className="px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-cc-primary-btn hover:bg-cc-primary-btn-hover text-white transition-colors cursor-pointer"
                >
                  Open Environments Page
                </button>
              </div>
            </section>

            {/* Federation */}
            <section id="federation" ref={setSectionRef("federation")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Federation</h2>
              <div className="space-y-3">
                <p className="text-xs text-cc-muted">
                  Connect multiple HeyHank instances into a peer-to-peer mesh.
                </p>
                <FederationSettings />
              </div>
            </section>


            {/* ─── Backup ─────────────────────────────────────────────── */}
            <section id="backup" ref={setSectionRef("backup")}>
              <h2 className="text-sm font-semibold text-cc-fg mb-4">Export &amp; Backup</h2>
              <BackupSection />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Backup Section ─────────────────────────────────────────────────────────

// ─── Tailscale Inline Status ────────────────────────────────────────────────

function TailscaleStatusInline() {
  const [status, setStatus] = useState<{ installed?: boolean; connected?: boolean; funnelActive?: boolean; funnelUrl?: string | null; dnsName?: string | null; error?: string | null; needsOperatorMode?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    api.getTailscaleStatus()
      .then((s) => setStatus(s))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  async function enableFunnel() {
    setActionLoading(true);
    try {
      const result = await api.startTailscaleFunnel();
      setStatus(result);
      if (result.funnelUrl && !result.error) {
        useStore.getState().setPublicUrl(result.funnelUrl);
      }
    } catch { /* silent */ }
    setActionLoading(false);
  }

  async function disableFunnel() {
    setActionLoading(true);
    try {
      const result = await api.stopTailscaleFunnel();
      setStatus(result);
      const currentUrl = useStore.getState().publicUrl;
      if (!currentUrl || currentUrl === status?.funnelUrl) {
        useStore.getState().setPublicUrl("");
      }
    } catch { /* silent */ }
    setActionLoading(false);
  }

  if (loading) return <p className="text-[11px] text-cc-muted">Checking Tailscale...</p>;

  if (!status || !status.installed) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cc-muted" />
          <span className="text-xs text-cc-muted">Not installed</span>
        </div>
        <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer"
          className="text-[11px] text-cc-primary hover:underline">Install Tailscale</a>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-xs text-cc-muted">Installed but not connected</span>
        </div>
        <div className="rounded-lg bg-cc-bg border border-cc-border px-3 py-1.5 font-mono text-[11px] text-cc-fg">
          sudo tailscale up
        </div>
      </div>
    );
  }

  if (status.funnelActive) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-green-500 font-medium">Funnel active</span>
          </div>
          <button onClick={disableFunnel} disabled={actionLoading}
            className="text-[11px] text-red-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50">
            {actionLoading ? "Stopping..." : "Disable"}
          </button>
        </div>
        <p className="text-[11px] text-cc-fg font-mono">{status.funnelUrl}</p>
        <p className="text-[10px] text-cc-muted">This URL was automatically set as your Public URL.</p>
      </div>
    );
  }

  // Connected but Funnel not active
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs text-cc-muted">Connected as {status.dnsName}</span>
      </div>
      {status.needsOperatorMode && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-1">
          <p className="text-[11px] text-amber-500 font-medium">Setup needed: operator mode</p>
          <div className="font-mono text-[11px] text-cc-fg">sudo tailscale set --operator=$USER</div>
        </div>
      )}
      <button onClick={enableFunnel} disabled={actionLoading}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cc-primary text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
        {actionLoading ? "Starting..." : "Enable HTTPS via Funnel"}
      </button>
      {status.error && !status.needsOperatorMode && (
        <p className="text-[11px] text-red-400">{status.error}</p>
      )}
    </div>
  );
}

function BackupSection() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heyhank-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* silent */
    }
    setExporting(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.importData({
        agents: data.agents,
        notes: data.notes,
        todos: data.todos,
      });
      const parts = Object.entries(result.imported).map(([k, v]) => `${v} ${k}`);
      setImportResult(`Imported: ${parts.join(", ") || "nothing new"}`);
    } catch {
      setImportResult("Import failed — invalid file format");
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-cc-muted">
        Export all agents, settings, notes, todos, and Gemini conversations as a JSON file. Import to restore on a new instance.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export Backup"}
        </button>
        <label className="px-3 py-2 text-xs font-medium rounded-lg bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer">
          {importing ? "Importing..." : "Import Backup"}
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
      </div>
      {importResult && (
        <p className={`text-xs ${importResult.startsWith("Import failed") ? "text-cc-error" : "text-cc-success"}`}>
          {importResult}
        </p>
      )}
    </div>
  );
}

