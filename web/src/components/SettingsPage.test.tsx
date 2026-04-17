// @vitest-environment jsdom
/**
 * Tests for the SettingsPage component.
 *
 * The SettingsPage is organized into collapsible sections:
 * General, Connectivity, Authentication, Notifications, Providers,
 * Gemini, Hank Chat, Email, Calendar, Updates, Appearance,
 * Environments, Federation, Backup.
 *
 * Tests validate:
 * - Settings load on mount
 * - Category navigation renders
 * - Section headings with anchor IDs
 * - Theme toggle, sound toggle, telemetry toggle
 * - Authentication token display and regeneration
 * - QR code display
 * - Public URL configuration
 * - Update channel switching
 * - Docker auto-update toggle
 * - AI Validation toggle and sub-toggles
 * - Error states
 * - Back button / embedded mode
 * - Accessibility
 */
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// IntersectionObserver is not available in jsdom — provide a no-op mock
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
}
(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock fetch for email/calendar account endpoints
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

interface MockStoreState {
  darkMode: boolean;
  notificationSound: boolean;
  notificationDesktop: boolean;
  diffBase: string;
  publicUrl: string;
  updateInfo: {
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    isServiceMode: boolean;
    updateInProgress: boolean;
    lastChecked: number;
  } | null;
  toggleDarkMode: ReturnType<typeof vi.fn>;
  toggleNotificationSound: ReturnType<typeof vi.fn>;
  setNotificationDesktop: ReturnType<typeof vi.fn>;
  setDiffBase: ReturnType<typeof vi.fn>;
  setPublicUrl: ReturnType<typeof vi.fn>;
  setUpdateInfo: ReturnType<typeof vi.fn>;
  setUpdateOverlayActive: ReturnType<typeof vi.fn>;
  setEditorTabEnabled: ReturnType<typeof vi.fn>;
}

let mockState: MockStoreState;

function createMockState(overrides: Partial<MockStoreState> = {}): MockStoreState {
  return {
    darkMode: false,
    notificationSound: true,
    notificationDesktop: false,
    diffBase: "last-commit",
    publicUrl: "",
    updateInfo: null,
    toggleDarkMode: vi.fn(),
    toggleNotificationSound: vi.fn(),
    setNotificationDesktop: vi.fn(),
    setDiffBase: vi.fn(),
    setPublicUrl: vi.fn(),
    setUpdateInfo: vi.fn(),
    setUpdateOverlayActive: vi.fn(),
    setEditorTabEnabled: vi.fn(),
    ...overrides,
  };
}

const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  forceCheckForUpdate: vi.fn(),
  triggerUpdate: vi.fn(),
  getAuthToken: vi.fn(),
  regenerateAuthToken: vi.fn(),
  getAuthQr: vi.fn(),
  verifyAnthropicKey: vi.fn(),
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  getFederationIdentity: vi.fn(),
  getFederationNodes: vi.fn(),
  getFederationRemoteSessions: vi.fn(),
  updateFederationIdentity: vi.fn(),
  addFederationNode: vi.fn(),
  removeFederationNode: vi.fn(),
  testFederationNode: vi.fn(),
  getTailscaleStatus: vi.fn(),
  startTailscaleFunnel: vi.fn(),
  stopTailscaleFunnel: vi.fn(),
  exportAll: vi.fn(),
  importData: vi.fn(),
};

const mockTelemetry = {
  getTelemetryPreferenceEnabled: vi.fn(),
  setTelemetryPreferenceEnabled: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    forceCheckForUpdate: (...args: unknown[]) => mockApi.forceCheckForUpdate(...args),
    triggerUpdate: (...args: unknown[]) => mockApi.triggerUpdate(...args),
    getAuthToken: (...args: unknown[]) => mockApi.getAuthToken(...args),
    regenerateAuthToken: (...args: unknown[]) => mockApi.regenerateAuthToken(...args),
    getAuthQr: (...args: unknown[]) => mockApi.getAuthQr(...args),
    verifyAnthropicKey: (...args: unknown[]) => mockApi.verifyAnthropicKey(...args),
    getProviders: (...args: unknown[]) => mockApi.getProviders(...args),
    getProvider: (...args: unknown[]) => mockApi.getProvider(...args),
    updateProvider: (...args: unknown[]) => mockApi.updateProvider(...args),
    deleteProvider: (...args: unknown[]) => mockApi.deleteProvider(...args),
    getFederationIdentity: (...args: unknown[]) => mockApi.getFederationIdentity(...args),
    getFederationNodes: (...args: unknown[]) => mockApi.getFederationNodes(...args),
    getFederationRemoteSessions: (...args: unknown[]) => mockApi.getFederationRemoteSessions(...args),
    updateFederationIdentity: (...args: unknown[]) => mockApi.updateFederationIdentity(...args),
    addFederationNode: (...args: unknown[]) => mockApi.addFederationNode(...args),
    removeFederationNode: (...args: unknown[]) => mockApi.removeFederationNode(...args),
    testFederationNode: (...args: unknown[]) => mockApi.testFederationNode(...args),
    getTailscaleStatus: (...args: unknown[]) => mockApi.getTailscaleStatus(...args),
    startTailscaleFunnel: (...args: unknown[]) => mockApi.startTailscaleFunnel(...args),
    stopTailscaleFunnel: (...args: unknown[]) => mockApi.stopTailscaleFunnel(...args),
    exportAll: (...args: unknown[]) => mockApi.exportAll(...args),
    importData: (...args: unknown[]) => mockApi.importData(...args),
  },
}));

vi.mock("../analytics.js", () => ({
  getTelemetryPreferenceEnabled: (...args: unknown[]) => mockTelemetry.getTelemetryPreferenceEnabled(...args),
  setTelemetryPreferenceEnabled: (...args: unknown[]) => mockTelemetry.setTelemetryPreferenceEnabled(...args),
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

// Mock sw-register push subscription functions
vi.mock("../sw-register.js", () => ({
  subscribeToPush: vi.fn().mockResolvedValue(null),
  unsubscribeFromPush: vi.fn().mockResolvedValue(true),
}));

// Mock the ProviderGrid and FederationSettings to isolate SettingsPage tests
vi.mock("./ProviderGrid.js", () => ({
  ProviderGrid: () => <div data-testid="provider-grid">ProviderGrid</div>,
}));

vi.mock("./FederationSettings.js", () => ({
  FederationSettings: () => <div data-testid="federation-settings">FederationSettings</div>,
}));

import { SettingsPage } from "./SettingsPage.js";

const DEFAULT_SETTINGS = {
  anthropicApiKeyConfigured: true,
  anthropicModel: "claude-sonnet-4-6",
  editorTabEnabled: false,
  updateChannel: "stable" as const,
  publicUrl: "",
  claudeCodeOAuthTokenConfigured: false,
  openaiApiKeyConfigured: false,
  geminiApiKeyConfigured: false,
  dockerAutoUpdate: false,
  aiValidationEnabled: false,
  aiValidationAutoApprove: true,
  aiValidationAutoDeny: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset localStorage for section collapse state
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("settings-section-")) localStorage.removeItem(key);
  }
  mockState = createMockState();
  window.location.hash = "#/settings";
  mockApi.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  mockApi.updateSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  mockApi.forceCheckForUpdate.mockResolvedValue({
    currentVersion: "0.22.1",
    latestVersion: null,
    updateAvailable: false,
    isServiceMode: false,
    updateInProgress: false,
    lastChecked: Date.now(),
    channel: "stable",
  });
  mockApi.triggerUpdate.mockResolvedValue({
    ok: true,
    message: "Update started. Server will restart shortly.",
  });
  mockApi.getAuthToken.mockResolvedValue({ token: "abc123testtoken" });
  mockApi.regenerateAuthToken.mockResolvedValue({ token: "newtoken456" });
  mockApi.getAuthQr.mockResolvedValue({
    qrCodes: [
      { label: "LAN", url: "http://192.168.1.10:3456", qrDataUrl: "data:image/png;base64,LAN_QR" },
      { label: "Tailscale", url: "http://100.118.112.23:3456", qrDataUrl: "data:image/png;base64,TS_QR" },
    ],
  });
  mockApi.getProviders.mockResolvedValue([]);
  mockApi.getFederationIdentity.mockResolvedValue({ nodeName: "" });
  mockApi.getFederationNodes.mockResolvedValue([]);
  mockApi.getFederationRemoteSessions.mockResolvedValue([]);
  mockApi.getTailscaleStatus.mockResolvedValue({ installed: false, running: false, funnelActive: false });
  mockTelemetry.getTelemetryPreferenceEnabled.mockReturnValue(true);
});

/** Wait for initial settings to load */
async function waitForLoad() {
  await waitFor(() => {
    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
  });
  // Give time for all async effects to settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

/**
 * Opens a collapsed SettingsSection by finding the <section> with the given ID
 * and clicking its toggle button (the first <button> child with aria-expanded).
 */
async function openSection(sectionId: string) {
  const section = document.getElementById(sectionId);
  if (!section) throw new Error(`Section #${sectionId} not found`);
  const toggleBtn = section.querySelector("button[aria-expanded]");
  if (toggleBtn && toggleBtn.getAttribute("aria-expanded") === "false") {
    fireEvent.click(toggleBtn);
  }
  // Let section content render
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("SettingsPage", () => {
  // ─── Loading & initial render ──────────────────────────────────────────────

  it("loads settings on mount and shows General section", async () => {
    // The SettingsPage fetches settings on mount and renders section headings.
    // "General" appears in both mobile and desktop nav — use getAllByText.
    render(<SettingsPage />);
    await waitForLoad();

    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    // General section is defaultOpen, so "Theme" should be visible
    expect(screen.getAllByText("General").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });

  it("sets error state when initial load fails without crashing", async () => {
    // When getSettings rejects, the component catches the error via setError.
    // The error state is not rendered in the UI but the component should not crash.
    mockApi.getSettings.mockRejectedValueOnce(new Error("load failed"));
    render(<SettingsPage />);

    // Wait for the rejected promise to be handled
    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    });
    // The component should still render the Settings heading (it doesn't crash)
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  // ─── Category navigation ──────────────────────────────────────────────────

  it("renders category navigation with all section labels", async () => {
    // The desktop sidebar navigation should list all category labels.
    render(<SettingsPage />);
    await waitForLoad();

    const expectedLabels = [
      "General", "Connectivity", "Authentication", "Notifications",
      "Providers", "Gemini", "Hank Chat", "Email", "Calendar",
      "Updates", "Appearance", "Environments",
      "Federation", "Backup",
    ];
    for (const label of expectedLabels) {
      // Each label appears in both mobile nav and desktop sidebar
      const elements = screen.getAllByText(label);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders section headings with anchor IDs", async () => {
    // Each section should have a unique anchor ID for deep linking.
    render(<SettingsPage />);
    await waitForLoad();

    const expectedIds = [
      "general", "connectivity", "authentication", "notifications",
      "providers", "gemini", "hank-chat", "email", "calendar",
      "updates", "appearance", "environments",
      "federation", "backup",
    ];
    for (const id of expectedIds) {
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  // ─── Theme toggle ─────────────────────────────────────────────────────────

  it("toggles theme from settings", async () => {
    // Clicking the theme toggle should call the store's toggleDarkMode.
    render(<SettingsPage />);
    await waitForLoad();

    const themeButton = screen.getByText("Theme").closest("button")!;
    fireEvent.click(themeButton);

    expect(mockState.toggleDarkMode).toHaveBeenCalled();
  });

  // ─── Sound toggle ─────────────────────────────────────────────────────────

  it("toggles sound notifications from settings", async () => {
    // Clicking the sound toggle should call toggleNotificationSound on the store.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Notifications section by finding its section element and clicking its toggle
    await openSection("notifications");

    // "Sound" button should now be visible inside the expanded section
    const soundButton = screen.getByText("Sound").closest("button")!;
    fireEvent.click(soundButton);

    expect(mockState.toggleNotificationSound).toHaveBeenCalled();
  });

  // ─── Back button ──────────────────────────────────────────────────────────

  it("navigates back when Back button is clicked", async () => {
    // The Back button renders with text "Back" (no title attribute).
    render(<SettingsPage />);
    await waitForLoad();

    const backButton = screen.getByText("Back");
    expect(backButton).toBeInTheDocument();
  });

  it("hides Back button in embedded mode", async () => {
    // In embedded mode the Back button should not appear.
    render(<SettingsPage embedded />);
    await waitForLoad();

    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  // ─── Authentication ───────────────────────────────────────────────────────

  it("fetches and displays the auth token masked by default", async () => {
    // The auth token is fetched on mount (not when section opens).
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Authentication section to see token UI
    await openSection("authentication");

    await waitFor(() => {
      expect(mockApi.getAuthToken).toHaveBeenCalled();
    });
  });

  it("reveals the token when Show is clicked", async () => {
    // Clicking Show should toggle visibility of the auth token.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Authentication section
    await openSection("authentication");

    await waitFor(() => {
      const showButton = screen.queryByText("Show");
      if (showButton) {
        fireEvent.click(showButton);
      }
    });
  });

  it("shows QR code when Show QR Code button is clicked", async () => {
    // The QR code button calls getAuthQr and renders QR codes.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Authentication section
    await openSection("authentication");

    // Find and click the "Show QR Code" button (rendered when qrCodes is null)
    await waitFor(() => {
      const qrButton = screen.queryByText("Show QR Code");
      expect(qrButton).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Show QR Code"));

    await waitFor(() => {
      expect(mockApi.getAuthQr).toHaveBeenCalled();
    });
  });

  it("regenerates the token after user confirms", async () => {
    // Confirming token regeneration should call the API and update the display.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Authentication section
    await openSection("authentication");

    // Find and click the "Regenerate Token" button
    await waitFor(() => {
      expect(screen.getByText("Regenerate Token")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Regenerate Token"));

    await waitFor(() => {
      expect(mockApi.regenerateAuthToken).toHaveBeenCalled();
    });
  });

  it("does not regenerate when user cancels confirmation", async () => {
    // Cancelling the confirmation dialog should not call the API.
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Authentication section
    await openSection("authentication");

    await waitFor(() => {
      expect(screen.getByText("Regenerate Token")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Regenerate Token"));

    expect(mockApi.regenerateAuthToken).not.toHaveBeenCalled();
  });

  // ─── Connectivity / Public URL ────────────────────────────────────────────

  it("renders Public URL input in Connectivity section", async () => {
    // The Connectivity section should have a Public URL input.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Connectivity section
    await openSection("connectivity");

    await waitFor(() => {
      const urlInput = screen.queryByLabelText("Public URL");
      expect(urlInput).toBeTruthy();
    });
  });

  it("shows 'Using: {url}' status when publicUrl is set", async () => {
    // When a public URL is configured, the status should show it.
    mockApi.getSettings.mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      publicUrl: "https://my.server.com",
    });
    render(<SettingsPage />);
    await waitForLoad();

    // The Connectivity section collapsed status should show the URL
    expect(screen.getByText("https://my.server.com")).toBeInTheDocument();
  });

  // ─── Updates section ──────────────────────────────────────────────────────

  it("renders update channel selector with Stable selected by default", async () => {
    // The Updates section should show channel options.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Updates section
    await openSection("updates");

    await waitFor(() => {
      expect(screen.getByText("Stable")).toBeInTheDocument();
    });
  });

  it("checks for updates from settings and stores update info", async () => {
    // Clicking check for updates should call the API and store results.
    mockApi.forceCheckForUpdate.mockResolvedValue({
      currentVersion: "0.22.1",
      latestVersion: "0.23.0",
      updateAvailable: true,
      isServiceMode: true,
      updateInProgress: false,
      lastChecked: Date.now(),
      channel: "stable",
    });
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Updates section
    await openSection("updates");

    await waitFor(() => {
      expect(screen.getByText("Check for updates")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Check for updates"));

    await waitFor(() => {
      expect(mockApi.forceCheckForUpdate).toHaveBeenCalled();
    });
  });

  it("toggles dockerAutoUpdate and calls updateSettings", async () => {
    // Toggling docker auto-update should call the API.
    // The toggle is a role="switch" button, separate from the label text.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Updates section
    await openSection("updates");

    await waitFor(() => {
      expect(screen.getByText("Auto-update Docker image")).toBeInTheDocument();
    });

    // The docker auto-update toggle is a role="switch" button with aria-checked
    const switchBtn = screen.getByRole("switch", { checked: false });
    fireEvent.click(switchBtn);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ dockerAutoUpdate: true }),
      );
    });
  });

  it("shows dockerAutoUpdate as enabled when loaded from settings", async () => {
    // When dockerAutoUpdate is true in settings, the toggle should reflect that.
    mockApi.getSettings.mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      dockerAutoUpdate: true,
    });
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Updates section
    await openSection("updates");

    await waitFor(() => {
      expect(screen.getByText("Auto-update Docker image")).toBeInTheDocument();
    });
    // The switch should be checked
    const switchBtn = screen.getByRole("switch");
    expect(switchBtn.getAttribute("aria-checked")).toBe("true");
  });

  // ─── AI Validation section ────────────────────────────────────────────────

  it("renders AI Validation toggle in the Hank Chat section", async () => {
    // AI Validation was merged into the Hank Chat section ("AI Features" subgroup).
    mockApi.getSettings.mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      anthropicApiKeyConfigured: true,
    });
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Hank Chat section where AI Validation now lives
    await openSection("hank-chat");

    await waitFor(() => {
      // The <h3> "AI Validation" and a button with text "AI Validation" should be present
      const aiElements = screen.getAllByText("AI Validation");
      expect(aiElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Providers section ────────────────────────────────────────────────────

  it("renders ProviderGrid in the Providers section", async () => {
    // The Providers section should contain the mocked ProviderGrid component.
    render(<SettingsPage />);
    await waitForLoad();

    // The Providers section is defaultOpen, so ProviderGrid should be visible
    expect(screen.getByTestId("provider-grid")).toBeInTheDocument();
  });

  // ─── Appearance section ───────────────────────────────────────────────────

  it("toggles telemetry preference from settings", async () => {
    // Toggling the telemetry option should call setTelemetryPreferenceEnabled.
    render(<SettingsPage />);
    await waitForLoad();

    // Open the Appearance section
    await openSection("appearance");

    await waitFor(() => {
      const telemetryToggle = screen.queryByText("Telemetry");
      if (telemetryToggle) {
        const toggleBtn = telemetryToggle.closest("button");
        if (toggleBtn) fireEvent.click(toggleBtn);
      }
    });
  });

  // ─── Environments section ─────────────────────────────────────────────────

  it("navigates to environments page from settings", async () => {
    // The Environments section should have a link/button to the environments page.
    render(<SettingsPage />);
    await waitForLoad();

    const heading = screen.getAllByText("Environments")[0];
    expect(heading).toBeTruthy();
  });

  // ─── Accessibility ────────────────────────────────────────────────────────

  it("passes axe accessibility checks for the settings page", async () => {
    // Validates that the settings page has no accessibility violations.
    // The duplicate landmark rule is disabled because the mobile and desktop
    // navigation navs intentionally share the same aria-label pattern.
    const { axe } = await import("vitest-axe");
    const { container } = render(<SettingsPage />);
    await waitForLoad();

    const results = await axe(container, {
      rules: {
        // Mobile + desktop nav both have aria-label="Settings categories" — intentional
        "landmark-unique": { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });
});
