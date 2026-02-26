// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { SessionItem } from "./SessionItem.js";
import type { SessionItem as SessionItemType } from "../utils/project-grouping.js";

function makeSession(overrides: Partial<SessionItemType> = {}): SessionItemType {
  return {
    id: "session-1",
    model: "claude-sonnet-4-6",
    cwd: "/workspace/app",
    gitBranch: "",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "running",
    sdkState: "connected",
    createdAt: Date.now(),
    archived: false,
    permCount: 0,
    backendType: "claude",
    repoRoot: "/workspace/app",
    cronJobId: undefined,
    ...overrides,
  };
}

function buildProps(overrides: Partial<ComponentProps<typeof SessionItem>> = {}): ComponentProps<typeof SessionItem> {
  return {
    session: makeSession(),
    isActive: false,
    isArchived: false,
    sessionName: undefined,
    permCount: 0,
    isRecentlyRenamed: false,
    onSelect: vi.fn(),
    onStartRename: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onClearRecentlyRenamed: vi.fn(),
    editingSessionId: null,
    editingName: "",
    setEditingName: vi.fn(),
    onConfirmRename: vi.fn(),
    onCancelRename: vi.fn(),
    editInputRef: { current: null },
    ...overrides,
  };
}

describe("SessionItem", () => {
  it("renders the session label and cwd", () => {
    // Validates the primary row content users rely on to identify sessions.
    render(<SessionItem {...buildProps()} />);

    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("/workspace/app")).toBeInTheDocument();
  });

  it("renders the Docker logo asset when session is containerized", () => {
    // Regression guard for THE-195: keep using the transparent Docker logo asset.
    render(<SessionItem {...buildProps({ session: makeSession({ isContainerized: true }) })} />);

    expect(screen.getByTitle("Docker")).toBeInTheDocument();
    const dockerLogo = screen.getByAltText("Docker logo");
    expect(dockerLogo).toHaveAttribute("src", "/logo-docker.svg");
  });

  it("enters rename flow on double-click", () => {
    // Confirms the interaction contract used by Sidebar for inline rename.
    const onStartRename = vi.fn();
    render(<SessionItem {...buildProps({ onStartRename })} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /claude-sonnet-4-6/i }));

    expect(onStartRename).toHaveBeenCalledWith("session-1", "claude-sonnet-4-6");
  });

  it("passes axe accessibility checks", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<SessionItem {...buildProps()} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
