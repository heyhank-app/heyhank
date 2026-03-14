// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { AgentInfo } from "../api.js";

// Mock LinearLogo since it's an SVG component with its own module
vi.mock("./LinearLogo.js", () => ({
  LinearLogo: (props: Record<string, unknown>) => (
    <svg data-testid="linear-logo" {...props} />
  ),
}));

import { LinearAgentSection } from "./LinearAgentSection.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Creates a minimal AgentInfo object with sensible defaults, allowing overrides. */
function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "agent-1",
    version: 1,
    name: "Test Agent",
    description: "A test agent",
    icon: "",
    backendType: "claude",
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    cwd: "/workspace",
    prompt: "Handle Linear issues",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalRuns: 0,
    consecutiveFailures: 0,
    triggers: {
      linear: {
        enabled: true,
        oauthClientId: "client-123",
        hasAccessToken: true,
        hasClientSecret: true,
        hasWebhookSecret: true,
      },
    },
    ...overrides,
  };
}

const defaultProps = {
  agents: [] as AgentInfo[],
  onEdit: vi.fn(),
  onRun: vi.fn(),
  onAddNew: vi.fn(),
  onManageCredentials: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LinearAgentSection", () => {
  // Test 1: Verifies the section heading and the LinearLogo icon are rendered
  it("renders the section heading 'Linear Agents' and the LinearLogo", () => {
    render(<LinearAgentSection {...defaultProps} />);
    expect(screen.getByText("Linear Agents")).toBeInTheDocument();
    expect(screen.getByTestId("linear-logo")).toBeInTheDocument();
  });

  // Test 2: Verifies the empty state message is shown when no agents are provided
  it("shows empty state message when agents array is empty", () => {
    render(<LinearAgentSection {...defaultProps} agents={[]} />);
    expect(
      screen.getByText(
        "No Linear agents yet. Create one to respond to @mentions in Linear.",
      ),
    ).toBeInTheDocument();
  });

  // Test 3: Verifies agent cards display the agent name and correct backend type badge
  it("renders agent cards with name and backend type badges", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Claude Bot", backendType: "claude" }),
      makeAgent({ id: "a2", name: "Codex Bot", backendType: "codex" }),
    ];
    render(<LinearAgentSection {...defaultProps} agents={agents} />);

    // Both agent names should be visible
    expect(screen.getByText("Claude Bot")).toBeInTheDocument();
    expect(screen.getByText("Codex Bot")).toBeInTheDocument();

    // Backend type badges: "Claude" for claude, "Codex" for codex
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  // Test 4: Verifies that the "Primary" badge only appears on the first agent
  it('shows "Primary" badge on the first agent only', () => {
    const agents = [
      makeAgent({ id: "a1", name: "First Agent" }),
      makeAgent({ id: "a2", name: "Second Agent" }),
    ];
    render(<LinearAgentSection {...defaultProps} agents={agents} />);

    // "Primary" badge should appear exactly once (on the first agent)
    const primaryBadges = screen.getAllByText("Primary");
    expect(primaryBadges).toHaveLength(1);

    // The Primary badge should be a sibling of the first agent's name, not the second
    const firstAgentName = screen.getByText("First Agent");
    const firstAgentRow = firstAgentName.closest(
      ".flex.items-center.gap-2.min-w-0",
    );
    expect(firstAgentRow).toContainElement(primaryBadges[0]);
  });

  // Test 5: Verifies clicking Edit button calls onEdit with the correct agent
  it("calls onEdit with the correct agent when Edit button is clicked", () => {
    const agent = makeAgent({ id: "edit-agent", name: "Editable Agent" });
    render(<LinearAgentSection {...defaultProps} agents={[agent]} />);

    const editButton = screen.getByTitle("Edit");
    fireEvent.click(editButton);

    expect(defaultProps.onEdit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEdit).toHaveBeenCalledWith(agent);
  });

  // Test 6: Verifies clicking Run button calls onRun with the correct agent
  it("calls onRun with the correct agent when Run button is clicked", () => {
    const agent = makeAgent({ id: "run-agent", name: "Runnable Agent" });
    render(<LinearAgentSection {...defaultProps} agents={[agent]} />);

    const runButton = screen.getByTitle("Run agent");
    fireEvent.click(runButton);

    expect(defaultProps.onRun).toHaveBeenCalledTimes(1);
    expect(defaultProps.onRun).toHaveBeenCalledWith(agent);
  });

  // Test 7: Verifies clicking "+ Add Linear Agent" calls onAddNew
  it('calls onAddNew when "+ Add Linear Agent" is clicked', () => {
    render(<LinearAgentSection {...defaultProps} />);

    fireEvent.click(screen.getByText("+ Add Linear Agent"));

    expect(defaultProps.onAddNew).toHaveBeenCalledTimes(1);
  });

  // Test 8: Verifies clicking "Manage OAuth" calls onManageCredentials
  it('calls onManageCredentials when "Manage OAuth" is clicked', () => {
    render(<LinearAgentSection {...defaultProps} />);

    fireEvent.click(screen.getByText("Manage OAuth"));

    expect(defaultProps.onManageCredentials).toHaveBeenCalledTimes(1);
  });

  // Test 9: Accessibility scan with agents rendered (non-empty state).
  // Scoped to container to avoid the "region" landmark rule which fires because
  // the component renders outside a <main>/<header> in isolation.
  it("passes axe accessibility checks with agents", async () => {
    const { axe } = await import("vitest-axe");
    const agents = [
      makeAgent({ id: "a1", name: "Agent One", backendType: "claude" }),
      makeAgent({ id: "a2", name: "Agent Two", backendType: "codex" }),
    ];
    const { container } = render(
      <LinearAgentSection {...defaultProps} agents={agents} />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Test 10: Accessibility scan with empty agents list (empty state).
  // Scoped to container to avoid the "region" landmark rule for the same reason.
  it("passes axe accessibility checks with empty state", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(
      <LinearAgentSection {...defaultProps} agents={[]} />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
