// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
  },
}));

import { SettingsPage } from "./SettingsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/settings";
  mockApi.getSettings.mockResolvedValue({
    openrouterApiKeyConfigured: true,
    openrouterModel: "openrouter/free",
  });
  mockApi.updateSettings.mockResolvedValue({
    openrouterApiKeyConfigured: true,
    openrouterModel: "openrouter/free",
  });
});

describe("SettingsPage", () => {
  it("loads settings on mount and shows configured status", async () => {
    render(<SettingsPage />);

    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    await screen.findByText("OpenRouter key configured");
    expect(screen.getByDisplayValue("openrouter/free")).toBeInTheDocument();
  });

  it("shows not configured status", async () => {
    mockApi.getSettings.mockResolvedValueOnce({
      openrouterApiKeyConfigured: false,
      openrouterModel: "openrouter/free",
    });

    render(<SettingsPage />);

    await screen.findByText("OpenRouter key not configured");
  });

  it("saves settings with trimmed values", async () => {
    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");

    fireEvent.change(screen.getByLabelText("OpenRouter API Key"), {
      target: { value: "  or-key  " },
    });
    fireEvent.change(screen.getByLabelText("OpenRouter Model"), {
      target: { value: "  openai/gpt-4o-mini  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        openrouterApiKey: "or-key",
        openrouterModel: "openai/gpt-4o-mini",
      });
    });

    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("falls back model to openrouter/free when blank", async () => {
    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");
    fireEvent.change(screen.getByLabelText("OpenRouter Model"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        openrouterModel: "openrouter/free",
      });
    });
  });

  it("does not send key when left empty", async () => {
    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");

    fireEvent.change(screen.getByLabelText("OpenRouter Model"), {
      target: { value: "openai/gpt-4o-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        openrouterModel: "openai/gpt-4o-mini",
      });
    });
  });

  it("shows error if initial load fails", async () => {
    mockApi.getSettings.mockRejectedValueOnce(new Error("load failed"));

    render(<SettingsPage />);

    expect(await screen.findByText("load failed")).toBeInTheDocument();
  });

  it("shows error if save fails", async () => {
    mockApi.updateSettings.mockRejectedValueOnce(new Error("save failed"));

    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");

    fireEvent.change(screen.getByLabelText("OpenRouter API Key"), {
      target: { value: "or-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("save failed")).toBeInTheDocument();
  });

  it("navigates back when Back button is clicked", async () => {
    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(window.location.hash).toBe("");
  });

  it("shows saving state while request is in flight", async () => {
    let resolveSave: ((value: {
      openrouterApiKeyConfigured: boolean;
      openrouterModel: string;
    }) => void) | undefined;
    mockApi.updateSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve as typeof resolveSave;
      }),
    );

    render(<SettingsPage />);
    await screen.findByText("OpenRouter key configured");

    fireEvent.change(screen.getByLabelText("OpenRouter API Key"), {
      target: { value: "or-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    resolveSave?.({
      openrouterApiKeyConfigured: true,
      openrouterModel: "openrouter/free",
    });

    await screen.findByText("Settings saved.");
  });
});
