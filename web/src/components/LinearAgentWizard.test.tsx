// @vitest-environment jsdom
/**
 * Tests for the Linear Agent setup wizard integrated into AgentsPage.
 *
 * Validates:
 * - Wizard entry via "Setup Linear Agent" button
 * - Rendering with step indicator across all wizard steps
 * - Accessibility (axe scan)
 * - Step navigation (Next/Back buttons)
 * - Starting step detection based on OAuth status
 * - OAuth redirect return handling (oauth_success / oauth_error in hash)
 * - Credential saving via API
 * - Agent creation with correct payload (Linear trigger enabled)
 * - sessionStorage persistence across OAuth redirect
 * - Error handling for API failures
 * - Cancel returns to agent list
 * - Finish refreshes agent list
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockPublicUrl = "";

const mockApi = {
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  toggleAgent: vi.fn(),
  runAgent: vi.fn(),
  exportAgent: vi.fn(),
  importAgent: vi.fn(),
  regenerateAgentWebhookSecret: vi.fn(),
  listSkills: vi.fn(),
  listEnvs: vi.fn(),
  getLinearOAuthStatus: vi.fn(),
  getLinearOAuthAuthorizeUrl: vi.fn(),
  updateSettings: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    listAgents: (...args: unknown[]) => mockApi.listAgents(...args),
    createAgent: (...args: unknown[]) => mockApi.createAgent(...args),
    updateAgent: (...args: unknown[]) => mockApi.updateAgent(...args),
    deleteAgent: (...args: unknown[]) => mockApi.deleteAgent(...args),
    toggleAgent: (...args: unknown[]) => mockApi.toggleAgent(...args),
    runAgent: (...args: unknown[]) => mockApi.runAgent(...args),
    exportAgent: (...args: unknown[]) => mockApi.exportAgent(...args),
    importAgent: (...args: unknown[]) => mockApi.importAgent(...args),
    regenerateAgentWebhookSecret: (...args: unknown[]) => mockApi.regenerateAgentWebhookSecret(...args),
    listSkills: (...args: unknown[]) => mockApi.listSkills(...args),
    listEnvs: (...args: unknown[]) => mockApi.listEnvs(...args),
    getLinearOAuthStatus: (...args: unknown[]) => mockApi.getLinearOAuthStatus(...args),
    getLinearOAuthAuthorizeUrl: (...args: unknown[]) => mockApi.getLinearOAuthAuthorizeUrl(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
  },
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: { publicUrl: string }) => unknown) =>
    selector({ publicUrl: mockPublicUrl }),
}));

// Mock FolderPicker to avoid file-system API calls in tests
vi.mock("./FolderPicker.js", () => ({
  FolderPicker: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="folder-picker">
      <button onClick={onClose}>Close Picker</button>
    </div>
  ),
}));

// Mock LinearLogo to avoid SVG import issues
vi.mock("./LinearLogo.js", () => ({
  LinearLogo: ({ className }: { className?: string }) => (
    <span data-testid="linear-logo" className={className} />
  ),
}));

import { AgentsPage } from "./AgentsPage.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const defaultOAuthStatus = {
  configured: false,
  hasClientId: false,
  hasClientSecret: false,
  hasWebhookSecret: false,
  hasAccessToken: false,
};

/** Render AgentsPage and enter the wizard via the "Setup Linear Agent" button */
async function renderAndEnterWizard() {
  render(<AgentsPage route={{ page: "agents" }} />);

  // Wait for agents page to load
  await waitFor(() => {
    expect(screen.getByText("Setup Linear Agent")).toBeInTheDocument();
  });

  // Click the "Setup Linear Agent" button
  fireEvent.click(screen.getByText("Setup Linear Agent"));

  // Wait for wizard to load (OAuth status check)
  await waitFor(() => {
    expect(screen.getByText("Linear Agent Setup")).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPublicUrl = "https://companion.example.com";
  mockApi.listAgents.mockResolvedValue([]);
  mockApi.listSkills.mockResolvedValue([]);
  mockApi.listEnvs.mockResolvedValue([]);
  mockApi.getLinearOAuthStatus.mockResolvedValue(defaultOAuthStatus);
  mockApi.updateSettings.mockResolvedValue({});
  mockApi.createAgent.mockResolvedValue({
    id: "linear-agent",
    name: "Linear Agent",
    triggers: { linear: { enabled: true } },
  });
  sessionStorage.clear();
  window.location.hash = "#/agents";
});

afterEach(() => {
  window.location.hash = "";
});

// =============================================================================
// Tests
// =============================================================================

describe("Linear Agent Wizard in AgentsPage", () => {
  it("renders the wizard with step indicator when Setup Linear Agent is clicked", async () => {
    await renderAndEnterWizard();

    // Step indicator should be visible
    expect(screen.getByLabelText(/Step 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Step 2/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Step 3/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Step 4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Step 5/)).toBeInTheDocument();
  });

  it("shows Step 1 by default when OAuth is not configured", async () => {
    await renderAndEnterWizard();

    // Step 1 content: prerequisites
    expect(screen.getByText("Set up the Linear Agent")).toBeInTheDocument();
    expect(screen.getByText("Prerequisites")).toBeInTheDocument();
  });

  it("shows Step 3 when credentials are saved but not installed", async () => {
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: false,
      hasClientId: true,
      hasClientSecret: true,
      hasWebhookSecret: true,
      hasAccessToken: false,
    });

    await renderAndEnterWizard();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Install to Workspace" })).toBeInTheDocument();
    });
  });

  it("shows Step 4 when OAuth is already connected", async () => {
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasClientId: true,
      hasClientSecret: true,
      hasAccessToken: true,
    });

    await renderAndEnterWizard();

    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });
  });

  // ─── Accessibility ─────────────────────────────────────────────────────────

  it("passes axe accessibility checks on Step 1", async () => {
    const { axe } = await import("vitest-axe");
    await renderAndEnterWizard();

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });

  // ─── Step Navigation ──────────────────────────────────────────────────────

  it("navigates from Step 1 to Step 2 when Next is clicked", async () => {
    await renderAndEnterWizard();

    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => {
      expect(screen.getByText("Enter OAuth Credentials")).toBeInTheDocument();
    });
  });

  it("navigates back from Step 2 to Step 1", async () => {
    await renderAndEnterWizard();

    // Go to step 2
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByText("Enter OAuth Credentials")).toBeInTheDocument();
    });

    // Go back to step 1
    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => {
      expect(screen.getByText("Set up the Linear Agent")).toBeInTheDocument();
    });
  });

  // ─── Step 2: Credentials ──────────────────────────────────────────────────

  it("saves credentials and advances to Step 3", async () => {
    await renderAndEnterWizard();

    // Navigate to step 2
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByText("Enter OAuth Credentials")).toBeInTheDocument();
    });

    // Fill in credentials
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-id-123" } });
    fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "client-secret-456" } });
    fireEvent.change(screen.getByLabelText("Webhook Signing Secret"), { target: { value: "webhook-secret-789" } });

    // Save
    fireEvent.click(screen.getByText("Save Credentials"));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        linearOAuthClientId: "client-id-123",
        linearOAuthClientSecret: "client-secret-456",
        linearOAuthWebhookSecret: "webhook-secret-789",
      });
    });

    // Should show success and Next button
    await waitFor(() => {
      expect(screen.getByText("Credentials saved successfully.")).toBeInTheDocument();
    });

    // Advance to step 3
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Install to Workspace" })).toBeInTheDocument();
    });
  });

  it("shows error when credentials save fails", async () => {
    mockApi.updateSettings.mockRejectedValue(new Error("Network error"));

    await renderAndEnterWizard();

    // Navigate to step 2
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByText("Enter OAuth Credentials")).toBeInTheDocument();
    });

    // Fill and save
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "id" } });
    fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("Webhook Signing Secret"), { target: { value: "webhook" } });
    fireEvent.click(screen.getByText("Save Credentials"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  // ─── Step 3: OAuth Return ─────────────────────────────────────────────────

  it("detects oauth_success in hash and advances to Step 4", async () => {
    // Simulate returning from OAuth redirect with success
    window.location.hash = "#/agents?oauth_success=true";

    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasClientId: true,
      hasAccessToken: true,
    });

    render(<AgentsPage route={{ page: "agents" }} />);

    // Should auto-enter wizard and advance to step 4 (agent configuration)
    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });
  });

  it("detects oauth_error in hash and shows error on Step 3", async () => {
    // Simulate persisted state so we return to step 3
    sessionStorage.setItem("companion_linear_wizard_state", JSON.stringify({
      step: 3,
      credentialsSaved: true,
      oauthConnected: false,
      agentName: "",
      createdAgentId: null,
    }));

    window.location.hash = "#/agents?oauth_error=access_denied";

    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: false,
      hasClientId: true,
      hasAccessToken: false,
    });

    render(<AgentsPage route={{ page: "agents" }} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Install to Workspace" })).toBeInTheDocument();
    });

    expect(screen.getByText("access_denied")).toBeInTheDocument();
  });

  // ─── Step 4: Agent Creation ────────────────────────────────────────────────

  it("creates agent with Linear trigger enabled and advances to Step 5", async () => {
    // Start at step 4 (OAuth already connected)
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasAccessToken: true,
    });

    await renderAndEnterWizard();

    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });

    // Default name is "Linear Agent" — just click create
    fireEvent.click(screen.getByText("Create Agent"));

    await waitFor(() => {
      expect(mockApi.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Linear Agent",
          permissionMode: "bypassPermissions",
          triggers: expect.objectContaining({
            linear: { enabled: true },
          }),
          enabled: true,
        }),
      );
    });

    // Should advance to step 5
    await waitFor(() => {
      expect(screen.getByText("Setup Complete")).toBeInTheDocument();
    });

    // Summary should show agent name
    expect(screen.getByText(/Agent "Linear Agent" created/)).toBeInTheDocument();
  });

  it("shows error when agent creation fails", async () => {
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasAccessToken: true,
    });
    mockApi.createAgent.mockRejectedValue(new Error("Agent name already exists"));

    await renderAndEnterWizard();

    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Create Agent"));

    await waitFor(() => {
      expect(screen.getByText("Agent name already exists")).toBeInTheDocument();
    });

    // Should still be on step 4
    expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
  });

  // ─── Step 5: Done ─────────────────────────────────────────────────────────

  it("returns to agent list when Go to Agents is clicked", async () => {
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasAccessToken: true,
    });

    await renderAndEnterWizard();

    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });

    // Create agent to get to step 5
    fireEvent.click(screen.getByText("Create Agent"));

    await waitFor(() => {
      expect(screen.getByText("Setup Complete")).toBeInTheDocument();
    });

    // Click finish — should return to agent list view
    fireEvent.click(screen.getByText("Go to Agents"));

    await waitFor(() => {
      // Should be back on the agents list (header visible)
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });
  });

  // ─── sessionStorage Persistence ────────────────────────────────────────────

  it("restores wizard state from sessionStorage after OAuth redirect", async () => {
    // Simulate wizard state saved before OAuth redirect
    sessionStorage.setItem("companion_linear_wizard_state", JSON.stringify({
      step: 3,
      credentialsSaved: true,
      oauthConnected: false,
      agentName: "",
      createdAgentId: null,
    }));

    // Simulate successful OAuth return
    window.location.hash = "#/agents?oauth_success=true";
    mockApi.getLinearOAuthStatus.mockResolvedValue({
      ...defaultOAuthStatus,
      configured: true,
      hasAccessToken: true,
    });

    render(<AgentsPage route={{ page: "agents" }} />);

    // Should skip to step 4 since OAuth is now connected
    await waitFor(() => {
      expect(screen.getByText("Configure Your Agent")).toBeInTheDocument();
    });

    // sessionStorage should be cleared after restore
    expect(sessionStorage.getItem("companion_linear_wizard_state")).toBeNull();
  });

  // ─── Cancel ────────────────────────────────────────────────────────────────

  it("returns to agent list when Cancel is clicked", async () => {
    await renderAndEnterWizard();

    fireEvent.click(screen.getByText("Cancel"));

    // Should be back on the agents list
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    });
  });

  // ─── Public URL warning ────────────────────────────────────────────────────

  it("shows warning when public URL is not configured", async () => {
    mockPublicUrl = "";

    await renderAndEnterWizard();

    // Should show warning about missing public URL
    expect(screen.getByText(/No public URL set/)).toBeInTheDocument();
  });

  it("shows green checkmark when public URL is configured", async () => {
    await renderAndEnterWizard();

    expect(screen.getByText("Public URL configured")).toBeInTheDocument();
  });

  // ─── Entry from IntegrationsPage (hash param) ─────────────────────────────

  it("auto-enters wizard when ?setup=linear is in hash", async () => {
    window.location.hash = "#/agents?setup=linear";

    render(<AgentsPage route={{ page: "agents" }} />);

    // Should auto-enter the wizard
    await waitFor(() => {
      expect(screen.getByText("Linear Agent Setup")).toBeInTheDocument();
    });
  });
});
