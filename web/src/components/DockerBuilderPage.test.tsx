// @vitest-environment jsdom
/**
 * Tests for DockerBuilderPage component.
 *
 * DockerBuilderPage provides a dedicated Docker image building interface
 * separated from the environment management page. It allows users to:
 * - Select environments with Dockerfiles to build
 * - View read-only image tag, base image, and dockerfile from the selected env
 * - Trigger and monitor builds
 * - View and manage locally available Docker images
 *
 * Coverage targets:
 * - Render test and axe accessibility scan
 * - Docker available / unavailable states
 * - Build card: env selection, read-only env details display
 * - Build actions: build trigger, pull base image
 * - Build status panel: idle, building, success, error states
 * - Available images list: display, pull actions, status badges
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── API Mocks ─────────────────────────────────────────────────
const mockListEnvs = vi.fn();
const mockGetContainerStatus = vi.fn();
const mockGetContainerImages = vi.fn();
const mockBuildEnvImage = vi.fn();
const mockGetEnvBuildStatus = vi.fn();
const mockGetImageStatus = vi.fn();
const mockPullImage = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listEnvs: (...args: unknown[]) => mockListEnvs(...args),
    getContainerStatus: (...args: unknown[]) => mockGetContainerStatus(...args),
    getContainerImages: (...args: unknown[]) => mockGetContainerImages(...args),
    buildEnvImage: (...args: unknown[]) => mockBuildEnvImage(...args),
    getEnvBuildStatus: (...args: unknown[]) => mockGetEnvBuildStatus(...args),
    getImageStatus: (...args: unknown[]) => mockGetImageStatus(...args),
    pullImage: (...args: unknown[]) => mockPullImage(...args),
  },
}));

import { DockerBuilderPage } from "./DockerBuilderPage.js";

// ─── Helpers ───────────────────────────────────────────────────

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    name: "Production",
    slug: "production",
    variables: { API_KEY: "secret123" },
    dockerfile: "FROM node:20\nRUN npm install",
    baseImage: "node:20",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Helper: select the "production" env from the environment dropdown */
async function selectProductionEnv() {
  await waitFor(() => {
    const selects = screen.getAllByRole("combobox");
    const envSelect = selects[0] as HTMLSelectElement;
    expect(Array.from(envSelect.options).some((o) => o.text === "Production")).toBe(true);
  });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "production" } });
}

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: Docker available, one env with dockerfile, two images
  mockGetContainerStatus.mockResolvedValue({ available: true, version: "27.5.1" });
  mockGetContainerImages.mockResolvedValue(["the-companion:latest", "node:20"]);
  mockListEnvs.mockResolvedValue([makeEnv()]);
  mockGetImageStatus.mockResolvedValue({ image: "", status: "ready", progress: [] });
  mockPullImage.mockResolvedValue({ ok: true, state: { image: "", status: "pulling", progress: [] } });
  mockBuildEnvImage.mockResolvedValue({ ok: true, imageTag: "env-production:latest" });
  mockGetEnvBuildStatus.mockResolvedValue({ buildStatus: "success" });
});

// ─── Render & Accessibility ────────────────────────────────────

describe("DockerBuilderPage render & accessibility", () => {
  it("renders the page with title and passes axe scan", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    expect(screen.getByText("Build and manage Docker images for environments.")).toBeInTheDocument();
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
  it("shows environment selector with envs that have dockerfiles", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");

    // Should show the env select
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(1);

    // Wait for envs to load and be available
    await waitFor(() => {
      // The option for "Production" should be in the first select
      const envSelect = selects[0] as HTMLSelectElement;
      const options = Array.from(envSelect.options);
      expect(options.some((o) => o.text === "Production")).toBe(true);
    });
  });

  it("shows message when no envs have dockerfiles", async () => {
    mockListEnvs.mockResolvedValue([makeEnv({ dockerfile: undefined })]);
    render(<DockerBuilderPage />);
    await screen.findByText(/No environments have a Dockerfile configured/);
  });

  it("shows read-only env details when environment is selected", async () => {
    // When an env is selected, the page displays the image tag, base image, and
    // dockerfile as read-only text (not editable inputs). This ensures the UI
    // accurately reflects what the server will use for the build.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    // Image tag shown as read-only text (derived from env slug)
    await waitFor(() => {
      expect(screen.getByText("companion-env-production:latest")).toBeInTheDocument();
    });

    // Base image shown as read-only text
    expect(screen.getByText("Image Tag")).toBeInTheDocument();
    expect(screen.getByText("Base Image")).toBeInTheDocument();

    // Dockerfile content shown in a <pre> block
    expect(screen.getByText(/FROM node:20/)).toBeInTheDocument();
  });

  it("shows Edit in Environments link when env is selected", async () => {
    // The dockerfile section includes a link to edit the actual dockerfile
    // in the Environments page, since the Docker Builder shows read-only data.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    await waitFor(() => {
      const editLink = screen.getByText("Edit in Environments");
      expect(editLink).toBeInTheDocument();
      expect(editLink.closest("a")).toHaveAttribute("href", "#/environments");
    });
  });

  it("does not show env details before an environment is selected", async () => {
    // Before selecting an env, the read-only details (image tag, base image,
    // dockerfile) should not be rendered.
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");

    // No image tag or dockerfile labels should appear yet
    expect(screen.queryByText("Image Tag")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit in Environments")).not.toBeInTheDocument();
  });
});

// ─── Build Actions ─────────────────────────────────────────────

describe("DockerBuilderPage build actions", () => {
  it("triggers build when Build Image is clicked", async () => {
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    // Click Build Image
    const buildBtn = screen.getByRole("button", { name: /build image/i });
    fireEvent.click(buildBtn);

    await waitFor(() => {
      expect(mockBuildEnvImage).toHaveBeenCalledWith("production");
    });
  });

  it("disables Build Image when no env is selected", async () => {
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
    mockBuildEnvImage.mockReturnValue(new Promise(() => {}));
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await screen.findByText("Starting build...");
  });

  it("shows error state on build failure", async () => {
    mockBuildEnvImage.mockRejectedValue(new Error("Docker daemon not running"));
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await screen.findByText("Docker daemon not running");
  });

  it("shows success state after build completes via poll", async () => {
    // Simulate: buildEnvImage resolves, then getEnvBuildStatus returns "success".
    // The component uses setTimeout(poll, 2000) internally, so we wait for
    // the poll to fire and resolve.
    mockBuildEnvImage.mockResolvedValue({ ok: true });
    mockGetEnvBuildStatus.mockResolvedValue({
      buildStatus: "success",
      imageTag: "companion-env-production:latest",
      lastBuiltAt: 1700000000000,
    });
    mockListEnvs.mockResolvedValue([makeEnv()]);

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    // Wait for the poll to complete and success to render
    await waitFor(() => {
      expect(screen.getByText("Success")).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it("shows error when build poll returns failed status", async () => {
    // Covers the branch where getEnvBuildStatus returns a non-success,
    // non-building status with a buildError message.
    mockBuildEnvImage.mockResolvedValue({ ok: true });
    mockGetEnvBuildStatus.mockResolvedValue({
      buildStatus: "failed",
      buildError: "Dockerfile syntax error",
    });

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(screen.getByText("Dockerfile syntax error")).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it("resets build state when environment selection changes", async () => {
    // After building env A and seeing an error, switching to env B should
    // clear the build status back to idle so stale results don't show.
    mockBuildEnvImage.mockRejectedValue(new Error("build failed"));
    mockListEnvs.mockResolvedValue([
      makeEnv(),
      makeEnv({ name: "Staging", slug: "staging", dockerfile: "FROM alpine" }),
    ]);

    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    fireEvent.click(screen.getByRole("button", { name: /build image/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/build failed/).length).toBeGreaterThan(0);
    });

    // Switch to a different env
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "staging" } });

    // Build state should reset to idle
    await waitFor(() => {
      expect(screen.getByText("No build in progress.")).toBeInTheDocument();
    });
  });

  it("clears build log on clear button click", async () => {
    mockBuildEnvImage.mockRejectedValue(new Error("failed"));
    render(<DockerBuilderPage />);
    await selectProductionEnv();

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

// ─── Pull Base Image ──────────────────────────────────────────

describe("DockerBuilderPage pull base image", () => {
  it("shows Pull base image button when env with baseImage is selected", async () => {
    // When an env with a baseImage is selected and the image status is "idle"
    // (not yet downloaded), a "Pull base image" button appears.
    mockGetImageStatus.mockResolvedValue({ image: "node:20", status: "idle", progress: [] });
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    await waitFor(() => {
      expect(screen.getByText("Pull base image")).toBeInTheDocument();
    });
  });

  it("calls pullImage when Pull base image is clicked", async () => {
    // Clicking the pull base image button should call the pullImage API
    // with the env's base image tag.
    mockGetImageStatus.mockResolvedValue({ image: "node:20", status: "idle", progress: [] });
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    await waitFor(() => {
      expect(screen.getByText("Pull base image")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pull base image"));

    await waitFor(() => {
      expect(mockPullImage).toHaveBeenCalledWith("node:20");
    });
  });

  it("shows Pull / Update base image when base image is ready", async () => {
    // When the base image status is "ready", the button text changes.
    mockGetImageStatus.mockResolvedValue({ image: "node:20", status: "ready", progress: [] });
    render(<DockerBuilderPage />);
    await screen.findByText("Docker Builder");
    await selectProductionEnv();

    await waitFor(() => {
      expect(screen.getByText("Pull / Update base image")).toBeInTheDocument();
    });
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
