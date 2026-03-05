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
  listAgents: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
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
    anthropicModel: "claude-sonnet-4.6",
    linearApiKeyConfigured: true,
  });
  mockApi.getLinearConnection.mockResolvedValue({
    connected: true,
    viewerName: "Ada",
    viewerEmail: "ada@example.com",
    teamName: "Engineering",
    teamKey: "ENG",
  });
  mockApi.listAgents.mockResolvedValue([]);
  window.location.hash = "#/integrations";
});

/** Helper: builds a mock agent with chat trigger and platform bindings */
function buildAgentWithChat(
  id: string,
  platforms: Array<{ adapter: string; credentials?: Record<string, string> }>,
) {
  return {
    id,
    version: 1,
    name: `Agent ${id}`,
    description: "test agent",
    backendType: "claude",
    model: "claude-sonnet-4.6",
    permissionMode: "default",
    cwd: "/tmp",
    prompt: "test",
    triggers: {
      chat: {
        enabled: true,
        platforms: platforms.map((p) => ({
          adapter: p.adapter,
          autoSubscribe: false,
          credentials: p.credentials,
        })),
      },
    },
  };
}

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
  // Chat Platforms summary section (lines 147-183)
  // ------------------------------------------------------------------

  it("renders Chat Platforms section when agents have chat bindings with configured credentials", async () => {
    // One agent with a slack platform that has credentials configured
    mockApi.listAgents.mockResolvedValue([
      buildAgentWithChat("agent-1", [
        { adapter: "slack", credentials: { botToken: "xoxb-abc" } },
      ]),
    ]);

    render(<IntegrationsPage />);

    // Wait for the Chat Platforms heading to appear
    const heading = await screen.findByText("Chat Platforms");
    expect(heading).toBeInTheDocument();

    // Platform name (capitalized via CSS, but text content is lowercase)
    expect(screen.getByText("slack")).toBeInTheDocument();

    // Agent count: "1 agent" (singular)
    expect(screen.getByText("1 agent")).toBeInTheDocument();

    // Configured badge: "1 configured"
    expect(screen.getByText("1 configured")).toBeInTheDocument();

    // "Using env vars" badge should NOT be present
    expect(screen.queryByText("Using env vars")).not.toBeInTheDocument();
  });

  it("shows 'Using env vars' badge when platform binding has no credentials", async () => {
    // Agent with a discord platform but NO credentials
    mockApi.listAgents.mockResolvedValue([
      buildAgentWithChat("agent-2", [
        { adapter: "discord" },
      ]),
    ]);

    render(<IntegrationsPage />);

    await screen.findByText("Chat Platforms");

    expect(screen.getByText("discord")).toBeInTheDocument();
    expect(screen.getByText("1 agent")).toBeInTheDocument();

    // Should show "Using env vars" since no credentials are configured
    expect(screen.getByText("Using env vars")).toBeInTheDocument();

    // "configured" badge should NOT be present
    expect(screen.queryByText("1 configured")).not.toBeInTheDocument();
  });

  it("aggregates multiple agents on the same platform", async () => {
    // Two agents both using slack: one with credentials, one without
    mockApi.listAgents.mockResolvedValue([
      buildAgentWithChat("agent-a", [
        { adapter: "slack", credentials: { botToken: "xoxb-111" } },
      ]),
      buildAgentWithChat("agent-b", [
        { adapter: "slack" },
      ]),
    ]);

    render(<IntegrationsPage />);

    await screen.findByText("Chat Platforms");

    // Slack row should show 2 agents (plural)
    expect(screen.getByText("2 agents")).toBeInTheDocument();

    // 1 out of 2 has credentials configured
    expect(screen.getByText("1 configured")).toBeInTheDocument();
  });

  it("Configure button navigates to agents page", async () => {
    mockApi.listAgents.mockResolvedValue([
      buildAgentWithChat("agent-3", [{ adapter: "github" }]),
    ]);

    render(<IntegrationsPage />);

    // Wait for the Chat Platforms section to render
    await screen.findByText("Chat Platforms");

    const configureBtn = screen.getByRole("button", { name: "Configure" });
    fireEvent.click(configureBtn);

    // Clicking Configure should navigate to the agents page
    await waitFor(() => {
      expect(window.location.hash).toBe("#/agents");
    });
  });

  it("does not render Chat Platforms section when no agents have chat bindings", async () => {
    // Default: listAgents returns empty array
    render(<IntegrationsPage />);

    await screen.findByText("Linear");

    // Chat Platforms heading should not appear
    expect(screen.queryByText("Chat Platforms")).not.toBeInTheDocument();
  });
});
