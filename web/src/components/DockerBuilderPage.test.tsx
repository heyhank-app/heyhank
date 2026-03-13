// @vitest-environment jsdom
/**
 * Tests for DockerBuilderPage component.
 *
 * DockerBuilderPage provides a dedicated Docker image building interface
 * separated from the sandbox management page. It allows users to:
 * - Select sandboxes with Dockerfiles to build
 * - View read-only image tag and dockerfile from the selected sandbox
 * - Trigger and monitor builds
 * - View and manage locally available Docker images
 *
 * Coverage targets:
 * - Render test and axe accessibility scan
 * - Docker available / unavailable states
 * - Build card: sandbox selection, read-only sandbox details display
 * - Build actions: build trigger
 * - Build status panel: idle, building, success, error states
 * - Available images list: display, pull actions, status badges
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── API Mocks ─────────────────────────────────────────────────
const mockListSandboxes = vi.fn();
const mockGetContainerStatus = vi.fn();
const mockGetContainerImages = vi.fn();
const mockBuildSandboxImage = vi.fn();
const mockGetSandboxBuildStatus = vi.fn();
const mockGetImageStatus = vi.fn();
const mockPullImage = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listSandboxes: (...args: unknown[]) => mockListSandboxes(...args),
    getContainerStatus: (...args: unknown[]) => mockGetContainerStatus(...args),
    getContainerImages: (...args: unknown[]) => mockGetContainerImages(...args),
    buildSandboxImage: (...args: unknown[]) => mockBuildSandboxImage(...args),
    getSandboxBuildStatus: (...args: unknown[]) => mockGetSandboxBuildStatus(...args),
    getImageStatus: (...args: unknown[]) => mockGetImageStatus(...args),
    pullImage: (...args: unknown[]) => mockPullImage(...args),
  },
}));

import { DockerBuilderPage } from "./DockerBuilderPage.js";

// ─── Helpers ───────────────────────────────────────────────────

function makeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    name: "Production",
    slug: "production",
    dockerfile: "FROM node:20\nRUN npm install",
    imageTag: "companion-sandbox-production:latest",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Helper: select the "production" sandbox from the sandbox dropdown */
async function selectProductionSandbox() {
  await waitFor(() => {
    const selects = screen.getAllByRole("combobox");
    const sandboxSelect = selects[0] as HTMLSelectElement;
    expect(Array.from(sandboxSelect.options).some((o) => o.text === "Production")).toBe(true);
  });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "production" } });
}

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: Docker available, one sandbox with dockerfile, two images
  mockGetContainerStatus.mockResolvedValue({ available: true, version: "27.5.1" });
  mockGetContainerImages.mockResolvedValue(["the-companion:latest", "node:20"]);
  mockListSandboxes.mockResolvedValue([makeSandbox()]);
  mockGetImageStatus.mockResolvedValue({ image: "", status: "ready", progress: [] });
  mockPullImage.mockResolvedValue({ ok: true, state: { image: "", status: "pulling", progress: [] } });
  mockBuildSandboxImage.mockResolvedValue({ ok: true, imageTag: "companion-sandbox-production:latest" });
  mockGetSandboxBuildStatus.mockResolvedValue({ buildStatus: "success" });
});

// ─── Render & Accessibility ────────────────────────────────────

describe("DockerBuilderPage render & accessibility", () => {
  it("renders the page with title and passes axe scan", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    expect(screen.getByText("Build Docker images for sandbox profiles.")).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── Docker Status Badge ───────────────────────────────────────

describe("DockerBuilderPage docker status", () => {
  it("shows Docker badge when Docker is available", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker");
  });

  it("shows No Docker badge when Docker is unavailable", async () => {
    mockGetContainerStatus.mockResolvedValue({ available: false });
    render(<DockerBuilderPage />);
    await screen.findByText("No Docker");
  });

  it("shows No Docker badge when status check fails", async () => {
    mockGetContainerStatus.mockRejectedValue(new Error("network error"));
    render(<DockerBuilderPage />);
    await screen.findByText("No Docker");
  });
});

// ─── Build Card ────────────────────────────────────────────────

describe("DockerBuilderPage build card", () => {
  it("shows sandbox selector with sandboxes that have dockerfiles", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");

    // Should show the sandbox select
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(1);

    // Wait for sandboxes to load and be available
    await waitFor(() => {
      // The option for "Production" should be in the first select
      const sandboxSelect = selects[0] as HTMLSelectElement;
      const options = Array.from(sandboxSelect.options);
      expect(options.some((o) => o.text === "Production")).toBe(true);
    });
  });

  it("shows message when no sandboxes have dockerfiles", async () => {
    mockListSandboxes.mockResolvedValue([makeSandbox({ dockerfile: undefined })]);
    render(<DockerBuilderPage />);
    await screen.findByText(/No sandboxes have a Dockerfile configured/);
  });

  it("shows read-only sandbox details when sandbox is selected", async () => {
    // When a sandbox is selected, the page displays the image tag and
    // dockerfile as read-only text (not editable inputs). This ensures the UI
    // accurately reflects what the server will use for the build.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    // Image tag shown as read-only text (derived from sandbox slug)
    await waitFor(() => {
      expect(screen.getByText("companion-sandbox-production:latest")).toBeInTheDocument();
    });

    // Image tag label shown
    expect(screen.getByText("Image Tag")).toBeInTheDocument();

    // Dockerfile content shown in a <pre> block
    expect(screen.getByText(/FROM node:20/)).toBeInTheDocument();
  });

  it("shows Edit in Sandboxes link when sandbox is selected", async () => {
    // The dockerfile section includes a link to edit the actual dockerfile
    // in the Sandboxes page, since the Docker Builder shows read-only data.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    await waitFor(() => {
      const editLink = screen.getByText("Edit in Sandboxes");
      expect(editLink).toBeInTheDocument();
      expect(editLink.closest("a")).toHaveAttribute("href", "#/sandboxes");
    });
  });

  it("does not show sandbox details before a sandbox is selected", async () => {
    // Before selecting a sandbox, the read-only details (image tag,
    // dockerfile) should not be rendered.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");

    // No image tag or dockerfile labels should appear yet
    expect(screen.queryByText("Image Tag")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit in Sandboxes")).not.toBeInTheDocument();
  });
});

// ─── Build Actions ─────────────────────────────────────────────

describe("DockerBuilderPage build actions", () => {
  it("triggers build when Build Image is clicked", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    // Click Build Image
    const buildBtn = screen.getByRole("button", { name: /build image/i });
    fireEvent.click(buildBtn);

    await waitFor(() => {
      expect(mockBuildSandboxImage).toHaveBeenCalledWith("production");
    });
  });

  it("disables Build Image when no sandbox is selected", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");

    const buildBtn = screen.getByRole("button", { name: /build image/i });
    expect(buildBtn).toBeDisabled();
  });

  it("disables Build Image when Docker is unavailable", async () => {
    mockGetContainerStatus.mockResolvedValue({ available: false });
    render(<DockerBuilderPage />);
    await screen.findByText("No Docker");

    const buildBtn = screen.getByRole("button", { name: /build image/i });
    expect(buildBtn).toBeDisabled();
  });
});

// ─── Build Status Panel ────────────────────────────────────────

describe("DockerBuilderPage build status", () => {
  it("shows idle state by default", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("No build in progress.");
  });

  it("shows building state after triggering build", async () => {
    // Make build hang so we can observe the "building" state
    mockBuildSandboxImage.mockReturnValue(new Promise(() => {}));
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await screen.findByText("Starting build...");
  });

  it("shows error state on build failure", async () => {
    mockBuildSandboxImage.mockRejectedValue(new Error("Docker daemon not running"));
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await screen.findByText("Docker daemon not running");
  });

  it("shows success state after build completes via poll", async () => {
    // Simulate: buildSandboxImage resolves, then getSandboxBuildStatus returns "success".
    // The component uses setTimeout(poll, 2000) internally, so we wait for
    // the poll to fire and resolve.
    mockBuildSandboxImage.mockResolvedValue({ ok: true });
    mockGetSandboxBuildStatus.mockResolvedValue({
      buildStatus: "success",
      imageTag: "companion-sandbox-production:latest",
      lastBuiltAt: 1700000000000,
    });
    mockListSandboxes.mockResolvedValue([makeSandbox()]);

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    // Wait for the poll to complete and success to render
    await waitFor(() => {
      expect(screen.getByText("Success")).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it("shows error when build poll returns failed status", async () => {
    // Covers the branch where getSandboxBuildStatus returns a non-success,
    // non-building status with a buildError message.
    mockBuildSandboxImage.mockResolvedValue({ ok: true });
    mockGetSandboxBuildStatus.mockResolvedValue({
      buildStatus: "failed",
      buildError: "Dockerfile syntax error",
    });

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(screen.getByText("Dockerfile syntax error")).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it("resets build state when sandbox selection changes", async () => {
    // After building sandbox A and seeing an error, switching to sandbox B should
    // clear the build status back to idle so stale results don't show.
    mockBuildSandboxImage.mockRejectedValue(new Error("build failed"));
    mockListSandboxes.mockResolvedValue([
      makeSandbox(),
      makeSandbox({ name: "Staging", slug: "staging", dockerfile: "FROM alpine" }),
    ]);

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/build failed/).length).toBeGreaterThan(0);
    });

    // Switch to a different sandbox
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "staging" } });

    // Build state should reset to idle
    await waitFor(() => {
      expect(screen.getByText("No build in progress.")).toBeInTheDocument();
    });
  });

  it("clears build log on clear button click", async () => {
    mockBuildSandboxImage.mockRejectedValue(new Error("failed"));
    render(<DockerBuilderPage />);
    await selectProductionSandbox();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    // Wait for error to appear (multiple elements can match - use findAllByText)
    await waitFor(() => {
      const matches = screen.getAllByText(/failed/);
      expect(matches.length).toBeGreaterThan(0);
    });

    // Click clear log button
    const clearBtn = screen.getByRole("button", { name: "Clear log" });
    fireEvent.click(clearBtn);

    // Build log should be cleared, back to idle
    await screen.findByText("No build in progress.");
  });
});

// ─── Available Images List ─────────────────────────────────────

describe("DockerBuilderPage available images", () => {
  it("shows available images when Docker is available", async () => {
    render(<DockerBuilderPage />);
    // Wait for the Available Images section to render
    await screen.findByText("Available Images");
    // Images appear in the images list section
    await waitFor(() => {
      expect(screen.getAllByText("the-companion:latest").length).toBeGreaterThan(0);
      expect(screen.getAllByText("node:20").length).toBeGreaterThan(0);
    });
  });

  it("shows empty state when no images are available", async () => {
    mockGetContainerImages.mockResolvedValue([]);
    render(<DockerBuilderPage />);
    await screen.findByText("No images found locally.");
  });

  it("shows Docker unavailable message in images section", async () => {
    mockGetContainerStatus.mockResolvedValue({ available: false });
    render(<DockerBuilderPage />);
    await screen.findByText("Docker is not available. Install Docker to manage images.");
  });

  it("triggers pull when Pull button is clicked on an image", async () => {
    mockGetImageStatus.mockResolvedValue({ image: "node:20", status: "idle", progress: [] });
    render(<DockerBuilderPage />);

    // Wait for images list to populate by checking for a Pull/Update button
    await waitFor(() => {
      const pullButtons = screen.getAllByRole("button", { name: /^pull$/i });
      expect(pullButtons.length).toBeGreaterThan(0);
    });

    const pullButtons = screen.getAllByRole("button", { name: /^pull$/i });
    fireEvent.click(pullButtons[0]);

    await waitFor(() => {
      expect(mockPullImage).toHaveBeenCalled();
    });
  });

  it("shows Update text when image is ready", async () => {
    mockGetImageStatus.mockResolvedValue({ image: "the-companion:latest", status: "ready", progress: [] });
    render(<DockerBuilderPage />);

    // Wait for image status to be fetched and Update buttons to appear
    await waitFor(() => {
      const updateButtons = screen.getAllByRole("button", { name: /^update$/i });
      expect(updateButtons.length).toBeGreaterThan(0);
    });
  });

  it("shows Ready badge for images with ready status", async () => {
    mockGetImageStatus.mockResolvedValue({ image: "", status: "ready", progress: [] });
    render(<DockerBuilderPage />);

    await waitFor(() => {
      const readyBadges = screen.getAllByText("Ready");
      expect(readyBadges.length).toBeGreaterThan(0);
    });
  });
});
