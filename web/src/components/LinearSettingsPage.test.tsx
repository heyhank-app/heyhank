// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  currentSessionId: string | null;
}

let mockState: MockStoreState;

const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getLinearConnection: vi.fn(),
  getLinearStates: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
    getLinearStates: (...args: unknown[]) => mockApi.getLinearStates(...args),
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
  mockState = { currentSessionId: null };
  mockApi.getSettings.mockResolvedValue({
    anthropicApiKeyConfigured: false,
    anthropicModel: "claude-sonnet-4.6",
    linearApiKeyConfigured: true,
    linearAutoTransition: false,
    linearAutoTransitionStateName: "",
    linearArchiveTransition: false,
    linearArchiveTransitionStateName: "",
  });
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
