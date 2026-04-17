// @vitest-environment jsdom
/**
 * Tests for IntegrationsPage component.
 *
 * Validates:
 * - Page renders with integration cards
 * - Back button navigation (home vs session)
 * - Back button hidden when embedded
 * - Accessibility
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  currentSessionId: string | null;
}

let mockState: MockStoreState;

const mockApi = {
  getSettings: vi.fn(),
  listAgents: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
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

// Mock global fetch for the raw fetch() calls in IntegrationsPage
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { currentSessionId: null };
  mockApi.getSettings.mockResolvedValue({
    anthropicApiKeyConfigured: false,
    anthropicModel: "claude-sonnet-4-6",
  });
  mockApi.listAgents.mockResolvedValue([]);
  // Mock all fetch calls used by IntegrationsPage
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/email-accounts") return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url === "/api/calendar-accounts") return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url === "/api/mcp/plugins") return Promise.resolve({ ok: true, json: () => Promise.resolve({ plugins: [] }) });
    if (url === "/api/push/status") return Promise.resolve({ ok: true, json: () => Promise.resolve({ subscriptions: 0 }) });
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
  window.location.hash = "#/integrations";
});

/** Helper to wait for the page to finish loading its async data. */
async function waitForPageLoad() {
  await waitFor(() => {
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByText("Voice Assistant")).toBeInTheDocument();
  });
}

describe("IntegrationsPage", () => {
  // ─── Render ─────────────────────────────────────────────────────────────────

  it("renders page title and integration cards after loading", async () => {
    // Verifies the page renders with its main heading and at least one card
    render(<IntegrationsPage />);

    await waitForPageLoad();

    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByText("Voice Assistant")).toBeInTheDocument();
    expect(screen.getByText("IMAP/SMTP Email")).toBeInTheDocument();
  });

  // ─── Back button ──────────────────────────────────────────────────────────

  it("renders Back button when not embedded and navigates home when no session", async () => {
    // No currentSessionId in state, so clicking Back should call navigateHome
    mockState = { currentSessionId: null };
    render(<IntegrationsPage />);

    await waitForPageLoad();

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

    await waitForPageLoad();

    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);

    expect(mockNavigateToSession).toHaveBeenCalledWith("session-xyz");
    expect(mockNavigateHome).not.toHaveBeenCalled();
  });

  it("does not render Back button when embedded", async () => {
    // When embedded=true the Back button should be absent
    render(<IntegrationsPage embedded />);

    await waitForPageLoad();

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
});
