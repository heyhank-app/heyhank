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
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getLinearConnection: (...args: unknown[]) => mockApi.getLinearConnection(...args),
  },
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

import { IntegrationsPage } from "./IntegrationsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { currentSessionId: null };
  mockApi.getSettings.mockResolvedValue({
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
});
