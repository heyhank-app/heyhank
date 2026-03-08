// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  currentSessionId: string | null;
  publicUrl: string;
}

let mockState: MockStoreState;

const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getLinearConnection: vi.fn(),
  getLinearStates: vi.fn(),
  getLinearOAuthStatus: vi.fn(),
  getLinearOAuthAuthorizeUrl: vi.fn(),
  disconnectLinearOAuth: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
    getLinearStates: (...args: unknown[]) => mockApi.getLinearStates(...args),
    getLinearOAuthStatus: (...args: unknown[]) => mockApi.getLinearOAuthStatus(...args),
    getLinearOAuthAuthorizeUrl: (...args: unknown[]) => mockApi.getLinearOAuthAuthorizeUrl(...args),
    disconnectLinearOAuth: (...args: unknown[]) => mockApi.disconnectLinearOAuth(...args),
  },
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

import { LinearSettingsPage } from "./LinearSettingsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { currentSessionId: null, publicUrl: "" };
  mockApi.getSettings.mockResolvedValue({
    anthropicApiKeyConfigured: false,
    anthropicModel: "claude-sonnet-4.6",
    linearApiKeyConfigured: true,
    linearAutoTransition: false,
    linearAutoTransitionStateName: "",
    linearArchiveTransition: false,
    linearArchiveTransitionStateName: "",
    linearOAuthConfigured: false,
  });
  mockApi.getLinearOAuthStatus.mockResolvedValue({ configured: false, hasClientId: false, hasClientSecret: false, hasWebhookSecret: false, hasAccessToken: false });
  mockApi.updateSettings.mockResolvedValue({
    anthropicApiKeyConfigured: false,
    anthropicModel: "claude-sonnet-4.6",
    linearApiKeyConfigured: true,
    linearAutoTransition: false,
    linearAutoTransitionStateName: "",
    linearArchiveTransition: false,
    linearArchiveTransitionStateName: "",
  });
  mockApi.getLinearStates.mockResolvedValue({
    teams: [
      {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
        states: [
          { id: "s-backlog", name: "Backlog", type: "backlog" },
          { id: "s-inprogress", name: "In Progress", type: "started" },
          { id: "s-done", name: "Done", type: "completed" },
        ],
      },
    ],
  });
  mockApi.getLinearConnection.mockResolvedValue({
    connected: true,
    viewerName: "Ada",
    viewerEmail: "ada@example.com",
    teamName: "Engineering",
    teamKey: "ENG",
  });
});

describe("LinearSettingsPage", () => {
  it("loads Linear configuration status", async () => {
    render(<LinearSettingsPage />);
    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Linear key configured")).toBeInTheDocument();
  });

  it("saves trimmed Linear API key", async () => {
    render(<LinearSettingsPage />);
    await screen.findByText("Linear key configured");

    fireEvent.change(screen.getByLabelText("Linear API Key"), {
      target: { value: "  lin_api_123  " },
    });
    // Click the credentials Save button (first one; the second is auto-transition Save)
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ linearApiKey: "lin_api_123" });
    });
    expect(mockApi.getLinearConnection).toHaveBeenCalled();
    expect(await screen.findByText("Integration saved.")).toBeInTheDocument();
  });

  it("shows an error when saving empty key", async () => {
    render(<LinearSettingsPage />);
    await screen.findByText("Linear key configured");
    // Click the credentials Save button (first one)
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]);
    expect(await screen.findByText("Please enter a Linear API key.")).toBeInTheDocument();
    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });

  it("verifies connection when Verify is clicked", async () => {
    render(<LinearSettingsPage />);
    await screen.findByText("Linear key configured");

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(mockApi.getLinearConnection).toHaveBeenCalled();
    });
    expect(await screen.findByText("Linear connection verified.")).toBeInTheDocument();
  });

  it("disconnects Linear integration", async () => {
    mockApi.updateSettings.mockResolvedValueOnce({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: false,
    });

    render(<LinearSettingsPage />);
    await screen.findByText("Linear key configured");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ linearApiKey: "" });
    });
    expect(await screen.findByText("Linear disconnected.")).toBeInTheDocument();
  });
});

describe("LinearSettingsPage — archive transition settings", () => {
  it("renders the 'On session archive' section when connected", async () => {
    // Verifies that the archive transition settings section appears when the
    // Linear integration is connected and team states are available.
    render(<LinearSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("On session archive")).toBeInTheDocument();
    });
  });

  it("toggle enables the archive transition state selector", async () => {
    // Verifies that clicking the toggle shows the target status selector.
    render(<LinearSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("On session archive")).toBeInTheDocument();
    });

    // The archive transition toggle should show "Disabled" initially
    const archiveSection = screen.getByText("On session archive").closest("div");
    expect(archiveSection).toBeTruthy();

    // Find the toggle button in the archive section (second switch on the page)
    const switches = screen.getAllByRole("switch");
    // The first switch is auto-transition, the second is archive transition
    const archiveSwitch = switches[switches.length - 1];
    fireEvent.click(archiveSwitch);

    // After enabling, the state selector should appear
    await waitFor(() => {
      expect(screen.getByLabelText("Target status")).toBeInTheDocument();
    });
  });

  it("saves archive transition settings", async () => {
    // Verifies that saving archive transition settings calls updateSettings
    // with the correct fields.
    render(<LinearSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("On session archive")).toBeInTheDocument();
    });

    // Enable the toggle
    const switches = screen.getAllByRole("switch");
    const archiveSwitch = switches[switches.length - 1];
    fireEvent.click(archiveSwitch);

    // Wait for state selector
    await waitFor(() => {
      expect(screen.getByLabelText("Target status")).toBeInTheDocument();
    });

    // Note: We can't test the exact label match since there are multiple "Target status"
    // labels on the page. Instead, find by id.
    const stateSelect = document.getElementById("archive-transition-state") as HTMLSelectElement;
    expect(stateSelect).toBeTruthy();
    fireEvent.change(stateSelect, { target: { value: "s-backlog" } });

    // Click the last Save button (for archive transition section)
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const lastSaveBtn = saveButtons[saveButtons.length - 1];
    fireEvent.click(lastSaveBtn);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        linearArchiveTransition: true,
        linearArchiveTransitionStateId: "s-backlog",
        linearArchiveTransitionStateName: "Backlog",
      });
    });
  });
});

describe("LinearSettingsPage — OAuth Agent App section", () => {
  it("renders the Linear Agent App section", async () => {
    // Verifies that the OAuth section renders with its heading
    render(<LinearSettingsPage />);
    expect(await screen.findByText("Linear Agent App")).toBeInTheDocument();
  });

  it("shows 'Not configured' status when OAuth is not set up", async () => {
    // Verifies the status text when no OAuth credentials are configured
    render(<LinearSettingsPage />);
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
  });

  it("renders all OAuth input fields", async () => {
    // Verifies all three credential fields are present
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(screen.getByLabelText("Webhook Signing Secret")).toBeInTheDocument();
  });

  it("saves OAuth credentials when Save Credentials is clicked", async () => {
    // Verifies that entering credentials and clicking Save Credentials
    // calls updateSettings with the trimmed values
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "  my-client-id  " },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "  my-secret  " },
    });
    fireEvent.change(screen.getByLabelText("Webhook Signing Secret"), {
      target: { value: "  wh-secret  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Credentials" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        linearOAuthClientId: "my-client-id",
        linearOAuthClientSecret: "my-secret",
        linearOAuthWebhookSecret: "wh-secret",
      });
    });
  });

  it("shows connected status when OAuth has access token", async () => {
    // Verifies the connected badge and status text when OAuth is fully configured
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: true,
      hasAccessToken: true,
    });
    mockApi.getSettings.mockResolvedValue({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: true,
      linearAutoTransition: false,
      linearAutoTransitionStateName: "",
      linearArchiveTransition: false,
      linearArchiveTransitionStateName: "",
      linearOAuthConfigured: true,
    });

    render(<LinearSettingsPage />);

    // Should show the agent status text indicating it's connected
    expect(await screen.findByText(/agents with the Linear trigger/i)).toBeInTheDocument();
  });

  it("opens OAuth authorize URL when Install to Workspace is clicked", async () => {
    // Verifies that clicking Install to Workspace calls the API and opens the URL
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: false,
      hasAccessToken: false,
    });
    mockApi.getSettings.mockResolvedValue({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: true,
      linearAutoTransition: false,
      linearAutoTransitionStateName: "",
      linearArchiveTransition: false,
      linearArchiveTransitionStateName: "",
      linearOAuthConfigured: true,
    });
    mockApi.getLinearOAuthAuthorizeUrl.mockResolvedValue({
      url: "https://linear.app/oauth/authorize?client_id=test",
    });

    // Mock window.open
    const originalOpen = window.open;
    window.open = vi.fn();

    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    // Wait for the status to load (sets oauthConfigured)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install to Workspace" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Install to Workspace" }));

    await waitFor(() => {
      expect(mockApi.getLinearOAuthAuthorizeUrl).toHaveBeenCalled();
    });
    expect(window.open).toHaveBeenCalledWith(
      "https://linear.app/oauth/authorize?client_id=test",
      "_self",
    );

    window.open = originalOpen;
  });

  it("disconnects OAuth when Disconnect is clicked", async () => {
    // Verifies that clicking Disconnect calls the disconnect API
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: true,
      hasAccessToken: true,
    });
    mockApi.getSettings.mockResolvedValue({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: true,
      linearAutoTransition: false,
      linearAutoTransitionStateName: "",
      linearArchiveTransition: false,
      linearArchiveTransitionStateName: "",
      linearOAuthConfigured: true,
    });

    render(<LinearSettingsPage />);

    // Wait for the OAuth connected status text (unique to the OAuth section)
    await screen.findByText(/agents with the Linear trigger/i);

    // Find and click the OAuth Disconnect button (not the API key Disconnect)
    // The OAuth Disconnect button appears inside the Linear Agent App section
    const disconnectButtons = screen.getAllByRole("button", { name: "Disconnect" });
    // The OAuth disconnect is the last one (after the API key disconnect)
    fireEvent.click(disconnectButtons[disconnectButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.disconnectLinearOAuth).toHaveBeenCalled();
    });
  });

  it("shows setup guide details section", async () => {
    // Verifies the expandable setup guide is present
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    expect(screen.getByText("Setup guide")).toBeInTheDocument();
  });

  it("disables Save Credentials when no fields are filled", async () => {
    // Verifies the button is disabled when all OAuth fields are empty
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    const saveBtn = screen.getByRole("button", { name: "Save Credentials" });
    expect(saveBtn).toBeDisabled();
  });

  it("shows 'Credentials saved' status when configured but not installed", async () => {
    // Verifies the intermediate status text when OAuth has credentials saved
    // on the server but no access token (not yet installed to workspace).
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: false,
      hasAccessToken: false,
    });
    mockApi.getSettings.mockResolvedValue({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: true,
      linearAutoTransition: false,
      linearAutoTransitionStateName: "",
      linearArchiveTransition: false,
      linearArchiveTransitionStateName: "",
      linearOAuthConfigured: true,
    });

    render(<LinearSettingsPage />);

    expect(await screen.findByText(/Credentials saved/i)).toBeInTheDocument();
  });

  it("shows error when Save Credentials fails", async () => {
    // Verifies that a server error on updateSettings shows the error message
    mockApi.updateSettings.mockRejectedValueOnce(new Error("Server error"));

    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Credentials" }));

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  it("shows success message after saving OAuth credentials", async () => {
    // Verifies the success banner appears after a successful save
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Credentials" }));

    expect(await screen.findByText("OAuth credentials saved.")).toBeInTheDocument();
  });

  it("shows error when Install to Workspace API call fails", async () => {
    // Verifies that an error from getLinearOAuthAuthorizeUrl is displayed
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: false,
      hasAccessToken: false,
    });
    mockApi.getSettings.mockResolvedValue({
      anthropicApiKeyConfigured: false,
      anthropicModel: "claude-sonnet-4.6",
      linearApiKeyConfigured: true,
      linearAutoTransition: false,
      linearAutoTransitionStateName: "",
      linearArchiveTransition: false,
      linearArchiveTransitionStateName: "",
      linearOAuthConfigured: true,
    });
    mockApi.getLinearOAuthAuthorizeUrl.mockRejectedValueOnce(new Error("Not configured"));

    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    // Wait for the button to be enabled (oauthConfigured = true from API)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install to Workspace" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Install to Workspace" }));

    expect(await screen.findByText("Not configured")).toBeInTheDocument();
  });

  it("handles OAuth success callback from URL hash", async () => {
    // Verifies that when the URL hash contains oauth_success=true (from
    // the OAuth redirect callback), the component shows the success state.
    // Mock getLinearOAuthStatus to also return hasAccessToken=true so the
    // success message shows "Agent app connected successfully!".
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      configured: true, hasClientId: true, hasClientSecret: true,
      hasWebhookSecret: true, hasAccessToken: true,
    });

    const originalHash = window.location.hash;
    window.location.hash = "#/settings/linear?oauth_success=true";

    render(<LinearSettingsPage />);

    // The component should detect oauth_success in the URL and show connected state
    expect(await screen.findByText("Agent app connected successfully!")).toBeInTheDocument();

    window.location.hash = originalHash;
  });

  it("handles OAuth error callback from URL hash", async () => {
    // Verifies that when the URL hash contains oauth_error=..., the
    // component displays the decoded error message.
    const originalHash = window.location.hash;
    window.location.hash = "#/settings/linear?oauth_error=access_denied";

    render(<LinearSettingsPage />);

    expect(await screen.findByText("access_denied")).toBeInTheDocument();

    window.location.hash = originalHash;
  });

  it("disables Install to Workspace when credentials are not persisted on server", async () => {
    // Verifies that typing a Client ID locally does NOT enable Install —
    // only server-side oauthConfigured makes the button clickable.
    // This prevents confusing 400 errors when the user hasn't saved yet.
    render(<LinearSettingsPage />);
    await screen.findByText("Linear Agent App");

    // Type a client ID locally — but settings.linearOAuthConfigured is false
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "my-client-id" },
    });

    // Install button should still be disabled because credentials aren't persisted
    const installBtn = screen.getByRole("button", { name: "Install to Workspace" });
    expect(installBtn).toBeDisabled();
  });
});
