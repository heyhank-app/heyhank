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
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
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
    openrouterApiKeyConfigured: false,
    openrouterModel: "openrouter/free",
    linearApiKeyConfigured: true,
  });
  mockApi.updateSettings.mockResolvedValue({
    openrouterApiKeyConfigured: false,
    openrouterModel: "openrouter/free",
    linearApiKeyConfigured: true,
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
      openrouterApiKeyConfigured: false,
      openrouterModel: "openrouter/free",
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
