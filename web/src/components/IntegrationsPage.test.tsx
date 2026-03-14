// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  currentSessionId: string | null;
}

let mockState: MockStoreState;

const mockApi = {
  getSettings: vi.fn(),
  getLinearConnection: vi.fn(),
  getTailscaleStatus: vi.fn(),
  listAgents: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
    getTailscaleStatus: (...args: unknown[]) => mockApi.getTailscaleStatus(...args),
    listAgents: (...args: unknown[]) => mockApi.listAgents(...args),
  },
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

const mockNavigateHome = vi.fn();
const mockNavigateToSession = vi.fn();
vi.mock("../utils/routing.js", () => ({
  navigateHome: (...args: unknown[]) => mockNavigateHome(...args),
  navigateToSession: (...args: unknown[]) => mockNavigateToSession(...args),
}));

import { IntegrationsPage } from "./IntegrationsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { currentSessionId: null };
  mockApi.getSettings.mockResolvedValue({
    anthropicApiKeyConfigured: false,
    anthropicModel: "claude-sonnet-4-6",
    linearApiKeyConfigured: true,
  });
  mockApi.getLinearConnection.mockResolvedValue({
    connected: true,
    viewerName: "Ada",
    viewerEmail: "ada@example.com",
    teamName: "Engineering",
    teamKey: "ENG",
  });
  mockApi.getTailscaleStatus.mockResolvedValue({
    installed: false,
    binaryPath: null,
    connected: false,
    dnsName: null,
    funnelActive: false,
    funnelUrl: null,
    error: null,
  });
  mockApi.listAgents.mockResolvedValue([]);
  window.location.hash = "#/integrations";
});

describe("IntegrationsPage", () => {
  it("shows Linear card with live status", async () => {
    render(<IntegrationsPage />);

    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    await screen.findByText("Linear");
    await screen.findByLabelText("Connected");
    expect(screen.getByText("Ada • Engineering")).toBeInTheDocument();
  });

  it("opens dedicated Linear settings page from card", async () => {
    render(<IntegrationsPage />);

    await screen.findByRole("button", { name: "Open Linear settings" });
    fireEvent.click(screen.getByRole("button", { name: "Open Linear settings" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/integrations/linear");
    });
  });

  // ------------------------------------------------------------------
  // Back button (lines 78-87): only shown when embedded=false
  // ------------------------------------------------------------------

  it("renders Back button when not embedded and navigates home when no session", async () => {
    // No currentSessionId in state, so clicking Back should call navigateHome
    mockState = { currentSessionId: null };
    render(<IntegrationsPage />);

    // Wait for async effects to settle (settings fetch)
    await screen.findByText("Linear");

    const backBtn = screen.getByRole("button", { name: "Back" });
    expect(backBtn).toBeInTheDocument();

    fireEvent.click(backBtn);

    expect(mockNavigateHome).toHaveBeenCalledTimes(1);
    expect(mockNavigateToSession).not.toHaveBeenCalled();
  });

  it("Back button navigates to session when currentSessionId is set", async () => {
    // Store has an active session, so Back should navigate to that session
    mockState = { currentSessionId: "session-xyz" };
    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);

    expect(mockNavigateToSession).toHaveBeenCalledWith("session-xyz");
    expect(mockNavigateHome).not.toHaveBeenCalled();
  });

  it("does not render Back button when embedded", async () => {
    // When embedded=true the Back button should be absent
    render(<IntegrationsPage embedded />);

    await screen.findByText("Linear");

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Tailscale card (renders status and navigates to settings page)
  // ------------------------------------------------------------------

  it("renders Tailscale card with 'Checking...' while status loads", async () => {
    // getTailscaleStatus returns a pending promise that never resolves during this test
    mockApi.getTailscaleStatus.mockReturnValue(new Promise(() => {}));

    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    // Tailscale card should show "Checking..." while status is loading
    expect(screen.getByText("Tailscale")).toBeInTheDocument();
    expect(screen.getByText("Checking...")).toBeInTheDocument();
  });

  it("renders Tailscale card with funnel active status", async () => {
    // Tailscale is connected with funnel active
    mockApi.getTailscaleStatus.mockResolvedValue({
      installed: true,
      binaryPath: "/usr/bin/tailscale",
      connected: true,
      dnsName: "my-machine.ts.net",
      funnelActive: true,
      funnelUrl: "https://my-machine.ts.net",
      error: null,
    });

    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    // Should show the funnel URL and the active indicator
    expect(screen.getByText("https://my-machine.ts.net")).toBeInTheDocument();
    expect(screen.getByLabelText("Funnel active")).toBeInTheDocument();
  });

  it("renders Tailscale card with 'Not installed' when tailscale is absent", async () => {
    // Default mock already returns installed: false — just verify it renders
    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    // Wait for the Tailscale status to resolve
    await screen.findByText("Not installed");
    expect(screen.getByText("HTTPS access in one click")).toBeInTheDocument();
  });

  it("shows fallback status when getTailscaleStatus fails", async () => {
    mockApi.getTailscaleStatus.mockRejectedValue(new Error("Network error"));

    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    // Should show "Not installed" (fallback status) instead of staying on "Checking..."
    await screen.findByText("Not installed");
  });

  it("navigates to Tailscale settings page when gear button is clicked", async () => {
    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    const tailscaleSettingsBtn = screen.getByRole("button", { name: "Open Tailscale settings" });
    fireEvent.click(tailscaleSettingsBtn);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/integrations/tailscale");
    });
  });
});
