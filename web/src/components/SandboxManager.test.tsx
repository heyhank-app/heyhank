// @vitest-environment jsdom
/**
 * Tests for SandboxManager component.
 *
 * SandboxManager manages sandbox profiles for containerized sessions. It
 * renders in two modes: "embedded" (full-page with CRUD UI) and a non-embedded
 * fallback that simply shows a message to use embedded mode.
 *
 * Each sandbox has a name, optional Dockerfile, and optional init script.
 * On mount the component loads sandboxes, checks Docker availability, and
 * checks the base image status.
 *
 * Coverage targets:
 * - Render test and axe accessibility scan
 * - Non-embedded fallback rendering
 * - Loading, empty, and populated list states
 * - Docker availability badges
 * - Create flow: toggle form, fill fields, submit, error handling
 * - Edit flow: open edit view, modify fields, save, cancel
 * - Delete flow: delete sandbox, error handling
 * - Build flow: trigger build, observe build status
 * - Base image banner: display states (ready, pulling, not downloaded, error)
 * - Dockerfile warning when not starting with FROM the-companion
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── API Mocks ─────────────────────────────────────────────────
const mockListSandboxes = vi.fn();
const mockCreateSandbox = vi.fn();
const mockUpdateSandbox = vi.fn();
const mockDeleteSandbox = vi.fn();
const mockBuildSandboxImage = vi.fn();
const mockGetSandboxBuildStatus = vi.fn();
const mockGetContainerStatus = vi.fn();
const mockGetImageStatus = vi.fn();
const mockPullImage = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listSandboxes: (...args: unknown[]) => mockListSandboxes(...args),
    createSandbox: (...args: unknown[]) => mockCreateSandbox(...args),
    updateSandbox: (...args: unknown[]) => mockUpdateSandbox(...args),
    deleteSandbox: (...args: unknown[]) => mockDeleteSandbox(...args),
    buildSandboxImage: (...args: unknown[]) => mockBuildSandboxImage(...args),
    getSandboxBuildStatus: (...args: unknown[]) => mockGetSandboxBuildStatus(...args),
    getContainerStatus: (...args: unknown[]) => mockGetContainerStatus(...args),
    getImageStatus: (...args: unknown[]) => mockGetImageStatus(...args),
    pullImage: (...args: unknown[]) => mockPullImage(...args),
  },
}));

import { SandboxManager } from "./SandboxManager.js";

// ─── Helpers ───────────────────────────────────────────────────

/** Creates a sandbox fixture with sensible defaults and optional overrides */
function makeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    name: "My Sandbox",
    slug: "my-sandbox",
    dockerfile: "FROM the-companion:latest\nWORKDIR /workspace",
    initScript: "bun install",
    imageTag: "companion-sandbox-my-sandbox:latest",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // Default: Docker available, base image ready, one sandbox
  mockListSandboxes.mockResolvedValue([makeSandbox()]);
  mockGetContainerStatus.mockResolvedValue({ available: true, version: "27.0.0" });
  mockGetImageStatus.mockResolvedValue({ image: "the-companion:latest", status: "ready", progress: [] });
  mockCreateSandbox.mockResolvedValue(makeSandbox());
  mockUpdateSandbox.mockResolvedValue(makeSandbox());
  mockDeleteSandbox.mockResolvedValue({});
  mockBuildSandboxImage.mockResolvedValue({ success: true, imageTag: "companion-sandbox-my-sandbox:latest" });
  mockGetSandboxBuildStatus.mockResolvedValue({ buildStatus: "success" });
  mockPullImage.mockResolvedValue({ ok: true, state: { image: "the-companion:latest", status: "pulling", progress: [] } });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Render & Accessibility ────────────────────────────────────

describe("SandboxManager render & accessibility", () => {
  it("renders embedded mode with title and passes axe accessibility scan", async () => {
    // Validates that the component renders its heading and has no
    // accessibility violations as detected by axe-core.
    const { axe } = await import("vitest-axe");
    const { container } = render(<SandboxManager embedded />);
    await screen.findByText("Sandboxes");
    expect(screen.getByText(/Reusable sandbox configurations/)).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("renders non-embedded mode with fallback message", () => {
    // When not in embedded mode, the component renders a message
    // instructing the user to use embedded mode instead.
    render(<SandboxManager />);
    expect(screen.getByText("Use embedded mode to view sandboxes.")).toBeInTheDocument();
  });
});

// ─── Docker Status Badge ───────────────────────────────────────

describe("SandboxManager Docker badge", () => {
  it("shows Docker badge when Docker is available", async () => {
    // The component shows a green "Docker" badge when the Docker daemon
    // is reachable.
    render(<SandboxManager embedded />);
    await screen.findByText("Docker");
  });

  it("shows No Docker badge when Docker is unavailable", async () => {
    // When getContainerStatus returns available: false, a yellow
    // "No Docker" badge is rendered.
    mockGetContainerStatus.mockResolvedValue({ available: false });
    render(<SandboxManager embedded />);
    await screen.findByText("No Docker");
  });

  it("shows No Docker badge when Docker check fails", async () => {
    // If the Docker status API call rejects, the component falls back
    // to treating Docker as unavailable.
    mockGetContainerStatus.mockRejectedValue(new Error("network error"));
    render(<SandboxManager embedded />);
    await screen.findByText("No Docker");
  });
});

// ─── List States ───────────────────────────────────────────────

describe("SandboxManager list states", () => {
  it("shows loading state while sandboxes are being fetched", () => {
    // When listSandboxes hasn't resolved yet, a loading message should
    // be shown to indicate data is being fetched.
    mockListSandboxes.mockReturnValue(new Promise(() => {}));
    render(<SandboxManager embedded />);
    expect(screen.getByText("Loading sandboxes...")).toBeInTheDocument();
  });

  it("shows empty state when no sandboxes exist", async () => {
    // When the API returns an empty list, a friendly "No sandboxes yet."
    // message should be displayed.
    mockListSandboxes.mockResolvedValue([]);
    render(<SandboxManager embedded />);
    await screen.findByText("No sandboxes yet.");
    expect(screen.getByText("0 sandboxes")).toBeInTheDocument();
  });

  it("displays sandbox list with sandbox names and metadata", async () => {
    // When sandboxes exist, each sandbox name and description metadata
    // (custom image indicator, init script indicator) should be visible.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");
    // The sandbox has a dockerfile, so "custom image" should appear
    expect(screen.getByText(/custom image/)).toBeInTheDocument();
    // The sandbox has an initScript, so "init script" should appear
    expect(screen.getByText(/init script/)).toBeInTheDocument();
    // Stats line
    expect(screen.getByText("1 sandbox")).toBeInTheDocument();
  });

  it("shows plural sandbox count for multiple sandboxes", async () => {
    mockListSandboxes.mockResolvedValue([
      makeSandbox(),
      makeSandbox({ name: "Second", slug: "second" }),
    ]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("2 sandboxes")).toBeInTheDocument();
  });

  it("shows default image text when sandbox has no dockerfile", async () => {
    // When a sandbox has no custom dockerfile, it uses the "default image"
    // label instead of "custom image".
    mockListSandboxes.mockResolvedValue([makeSandbox({ dockerfile: undefined, initScript: undefined })]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");
    expect(screen.getByText("default image")).toBeInTheDocument();
  });
});

// ─── Create Sandbox Flow ───────────────────────────────────────

describe("SandboxManager create flow", () => {
  it("toggles create form visibility with New Sandbox button", async () => {
    // Clicking "New Sandbox" should reveal the create form, and clicking
    // the button again (which becomes "Cancel") should hide it.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    // Click "New Sandbox" to show create form
    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    expect(screen.getByPlaceholderText("Sandbox name (e.g. node-project)")).toBeInTheDocument();

    // Click "Cancel" to hide the form
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByPlaceholderText("Sandbox name (e.g. node-project)")).not.toBeInTheDocument();
  });

  it("creates a new sandbox with name only", async () => {
    // Creating a sandbox with just a name (no dockerfile or init script)
    // should call createSandbox with the name and undefined options.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));

    const nameInput = screen.getByPlaceholderText("Sandbox name (e.g. node-project)");
    fireEvent.change(nameInput, { target: { value: "test-sandbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateSandbox).toHaveBeenCalledWith("test-sandbox", {
        dockerfile: undefined,
        initScript: undefined,
      });
    });
  });

  it("creates a sandbox with dockerfile and init script", async () => {
    // When all fields (name, dockerfile, init script) are provided, all
    // values should be passed to the createSandbox API call.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));

    fireEvent.change(screen.getByPlaceholderText("Sandbox name (e.g. node-project)"), {
      target: { value: "full-sandbox" },
    });
    fireEvent.change(screen.getByPlaceholderText("# Custom Dockerfile content..."), {
      target: { value: "FROM the-companion:latest\nRUN apt-get update" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Runs inside the container/),
      { target: { value: "npm install" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateSandbox).toHaveBeenCalledWith("full-sandbox", {
        dockerfile: "FROM the-companion:latest\nRUN apt-get update",
        initScript: "npm install",
      });
    });
  });

  it("creates sandbox via Enter key in name input", async () => {
    // Pressing Enter in the name input should trigger creation without
    // needing to click the Create button.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    const nameInput = screen.getByPlaceholderText("Sandbox name (e.g. node-project)");
    fireEvent.change(nameInput, { target: { value: "enter-sandbox" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockCreateSandbox).toHaveBeenCalled();
    });
  });

  it("does not create when name is empty", async () => {
    // The Create button should be disabled when no name is entered, and
    // pressing Enter in an empty name input should not trigger creation.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    const createBtn = screen.getByRole("button", { name: "Create" });
    expect(createBtn).toBeDisabled();

    // Enter key with empty name should not call API
    const nameInput = screen.getByPlaceholderText("Sandbox name (e.g. node-project)");
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(mockCreateSandbox).not.toHaveBeenCalled();
  });

  it("resets form and hides it after successful creation", async () => {
    // After a successful create, the form fields should be cleared and
    // the form should be hidden, returning to the list view.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    const nameInput = screen.getByPlaceholderText("Sandbox name (e.g. node-project)");
    fireEvent.change(nameInput, { target: { value: "new-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateSandbox).toHaveBeenCalled();
    });

    // Form should be hidden after successful creation
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Sandbox name (e.g. node-project)")).not.toBeInTheDocument();
    });
  });

  it("shows error when creation fails with Error object", async () => {
    // When createSandbox rejects with an Error, the error message should
    // be displayed within the create form.
    mockCreateSandbox.mockRejectedValue(new Error("Name already exists"));
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    fireEvent.change(screen.getByPlaceholderText("Sandbox name (e.g. node-project)"), {
      target: { value: "duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Name already exists");
  });

  it("shows error when creation fails with string exception", async () => {
    // Non-Error exceptions (e.g. thrown strings) should also be rendered
    // as error messages.
    mockCreateSandbox.mockRejectedValue("string error");
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    fireEvent.change(screen.getByPlaceholderText("Sandbox name (e.g. node-project)"), {
      target: { value: "fail" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("string error");
  });

  it("populates dockerfile with template when Use template is clicked", async () => {
    // The create form offers a "Use template" link that populates the
    // dockerfile textarea with a default Dockerfile content.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));

    // "Use template" should be visible when dockerfile is empty
    fireEvent.click(screen.getByText("Use template"));

    // The textarea should now contain the default template
    const textarea = screen.getByPlaceholderText("# Custom Dockerfile content...") as HTMLTextAreaElement;
    expect(textarea.value).toContain("FROM the-companion:latest");
    expect(textarea.value).toContain("WORKDIR /workspace");
  });

  it("shows dockerfile warning when FROM does not start with the-companion", async () => {
    // When the user enters a Dockerfile that does not start with
    // "FROM the-companion", a warning message should appear.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /new sandbox/i }));
    fireEvent.change(screen.getByPlaceholderText("# Custom Dockerfile content..."), {
      target: { value: "FROM node:20" },
    });

    expect(screen.getByText(/does not start with FROM the-companion/)).toBeInTheDocument();
  });
});

// ─── Edit Sandbox Flow ─────────────────────────────────────────

describe("SandboxManager edit flow", () => {
  it("opens edit view and displays current sandbox values", async () => {
    // Clicking the Edit button on a sandbox row should switch it to an
    // editable form with the current name, dockerfile, and init script.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    // Name input should contain the current name
    expect(screen.getByDisplayValue("My Sandbox")).toBeInTheDocument();
    // Dockerfile textarea should contain current content (multiline values
    // need to be checked via the element's value property since
    // getByDisplayValue does not reliably match multiline strings)
    const dockerfileTextarea = screen.getByPlaceholderText("# Custom Dockerfile content...") as HTMLTextAreaElement;
    expect(dockerfileTextarea.value).toBe("FROM the-companion:latest\nWORKDIR /workspace");
    // Init script textarea should contain current content
    expect(screen.getByDisplayValue("bun install")).toBeInTheDocument();
  });

  it("saves edited sandbox with updated values", async () => {
    // Modifying the name in the edit form and clicking Save should call
    // updateSandbox with the sandbox slug and new values.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("My Sandbox"), {
      target: { value: "Renamed Sandbox" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockUpdateSandbox).toHaveBeenCalledWith("my-sandbox", {
        name: "Renamed Sandbox",
        dockerfile: "FROM the-companion:latest\nWORKDIR /workspace",
        initScript: "bun install",
      });
    });
  });

  it("cancels edit and returns to list view", async () => {
    // Clicking Cancel in the edit form should discard changes and
    // return to the non-editable sandbox row view.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("My Sandbox")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("My Sandbox")).not.toBeInTheDocument();
    });
  });

  it("shows error when save fails", async () => {
    // When updateSandbox rejects, the error message should be visible.
    mockUpdateSandbox.mockRejectedValue(new Error("Save failed"));
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Save"));

    await screen.findByText("Save failed");
  });

  it("handles non-Error exceptions during save", async () => {
    // String exceptions thrown during save should also display as errors.
    mockUpdateSandbox.mockRejectedValue("update error string");
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Save"));

    await screen.findByText("update error string");
  });

  it("shows Use template button in edit when dockerfile is empty", async () => {
    // When editing a sandbox that has no dockerfile, the "Use template"
    // link should be available to populate a default template.
    mockListSandboxes.mockResolvedValue([makeSandbox({ dockerfile: undefined })]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    // Should show "Use template" since dockerfile is empty
    expect(screen.getByText("Use template")).toBeInTheDocument();
  });

  it("shows dockerfile warning in edit mode when FROM is not the-companion", async () => {
    // When the edited Dockerfile does not start with FROM the-companion,
    // a warning should be displayed.
    mockListSandboxes.mockResolvedValue([makeSandbox({ dockerfile: "FROM alpine:latest" })]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText(/does not start with FROM the-companion/)).toBeInTheDocument();
  });
});

// ─── Delete Sandbox Flow ───────────────────────────────────────

describe("SandboxManager delete flow", () => {
  it("deletes a sandbox when Delete button is clicked", async () => {
    // Clicking the Delete button on a sandbox row should call
    // deleteSandbox with the sandbox slug and refresh the list.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteSandbox).toHaveBeenCalledWith("my-sandbox");
    });
  });

  it("shows error when delete fails with Error object", async () => {
    // When deleteSandbox rejects, the error should be displayed.
    mockDeleteSandbox.mockRejectedValue(new Error("Cannot delete"));
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("Cannot delete");
  });

  it("handles non-Error exceptions during delete", async () => {
    // String exceptions thrown during delete should also be rendered.
    mockDeleteSandbox.mockRejectedValue("delete error string");
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("delete error string");
  });

  it("can delete a different sandbox while editing another", async () => {
    // When one sandbox is in edit mode and the user deletes a different
    // sandbox, the delete should succeed and the editing state should
    // remain for the sandbox being edited.
    mockListSandboxes.mockResolvedValue([
      makeSandbox(),
      makeSandbox({ name: "Other", slug: "other" }),
    ]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    // Start editing "My Sandbox" — this replaces its row with the edit form
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);
    expect(screen.getByDisplayValue("My Sandbox")).toBeInTheDocument();

    // "Other" sandbox still has its Delete button visible (it's not being edited)
    // After deletion of "Other", the list refreshes without it.
    mockListSandboxes.mockResolvedValue([
      makeSandbox(),
    ]);

    // Click Delete on "Other" (the only visible Delete button now)
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockDeleteSandbox).toHaveBeenCalledWith("other");
    });

    // Edit form for "My Sandbox" should still be visible
    expect(screen.getByDisplayValue("My Sandbox")).toBeInTheDocument();
  });
});

// ─── Build Flow ────────────────────────────────────────────────

describe("SandboxManager build flow", () => {
  it("shows Build Image button in edit mode when dockerfile exists", async () => {
    // The Build Image button should only appear in the edit view when
    // the sandbox has a Dockerfile configured.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: /build image/i })).toBeInTheDocument();
  });

  it("does not show Build Image button in edit mode when dockerfile is empty", async () => {
    // When editing a sandbox without a dockerfile, the Build Image
    // button should not be rendered.
    mockListSandboxes.mockResolvedValue([makeSandbox({ dockerfile: "" })]);
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: /build image/i })).not.toBeInTheDocument();
  });

  it("triggers build and shows building status", async () => {
    // Clicking Build Image should call buildSandboxImage and show
    // "Building..." in the button and a building status indicator.
    mockBuildSandboxImage.mockReturnValue(new Promise(() => {})); // Hang to observe building state
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(mockBuildSandboxImage).toHaveBeenCalledWith("my-sandbox");
    });

    // Should show building indicator
    expect(screen.getByText("Building image...")).toBeInTheDocument();
    expect(screen.getByText("Building...")).toBeInTheDocument();
  });

  it("shows success status after build completes", async () => {
    // When buildSandboxImage resolves successfully, a success message
    // should be displayed with the image tag.
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(screen.getByText(/Build successful/)).toBeInTheDocument();
    });
  });

  it("shows error status when build fails", async () => {
    // When buildSandboxImage rejects, an error message should be displayed.
    mockBuildSandboxImage.mockRejectedValue(new Error("Docker daemon not running"));
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(screen.getByText(/Docker daemon not running/)).toBeInTheDocument();
    });
  });

  it("shows error status when build returns unsuccessful result", async () => {
    // When buildSandboxImage resolves with success: false, a generic
    // build failure error should be displayed.
    mockBuildSandboxImage.mockResolvedValue({ success: false });
    render(<SandboxManager embedded />);
    await screen.findByText("My Sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /build image/i }));

    await waitFor(() => {
      expect(screen.getByText(/Build error: Build failed/)).toBeInTheDocument();
    });
  });
});

// ─── Base Image Banner ─────────────────────────────────────────

describe("SandboxManager base image banner", () => {
  it("shows Ready status when base image is available", async () => {
    // When the base image has status "ready", a green Ready badge
    // should appear in the base image banner.
    render(<SandboxManager embedded />);
    await screen.findByText("Base Image");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows Not downloaded when base image status is idle", async () => {
    // When the base image has status "idle" or null, a "Not downloaded"
    // label should appear with a Pull button.
    mockGetImageStatus.mockResolvedValue({ image: "the-companion:latest", status: "idle", progress: [] });
    render(<SandboxManager embedded />);
    await screen.findByText("Base Image");
    await screen.findByText("Not downloaded");
    expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
  });

  it("shows Pulling status when base image is being pulled", async () => {
    // When the base image status is "pulling", a spinner and
    // "Pulling..." labels should appear (in both the badge and the button).
    // We use getAllByText since "Pulling..." appears in multiple places.
    mockGetImageStatus.mockResolvedValue({
      image: "the-companion:latest",
      status: "pulling",
      progress: ["Downloading layer 1..."],
    });
    render(<SandboxManager embedded />);
    await screen.findByText("Base Image");
    await waitFor(() => {
      const pullingElements = screen.getAllByText("Pulling...");
      expect(pullingElements.length).toBeGreaterThan(0);
    });
  });

  it("shows Pull failed when base image status is error", async () => {
    // When the base image pull status is "error", the banner should
    // show "Pull failed" along with the error message.
    mockGetImageStatus.mockResolvedValue({
      image: "the-companion:latest",
      status: "error",
      progress: [],
      error: "Network timeout",
    });
    render(<SandboxManager embedded />);
    await screen.findByText("Pull failed");
    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("does not show base image banner when Docker is unavailable", async () => {
    // The base image banner is only relevant when Docker is available.
    // When Docker is not available, the banner should not render.
    mockGetContainerStatus.mockResolvedValue({ available: false });
    render(<SandboxManager embedded />);
    await screen.findByText("Sandboxes");
    // Wait for Docker status to resolve
    await screen.findByText("No Docker");
    expect(screen.queryByText("Base Image")).not.toBeInTheDocument();
  });

  it("does not show Pull button when base image is ready", async () => {
    // When the base image is already downloaded and ready, there is
    // no need for a Pull button.
    render(<SandboxManager embedded />);
    await screen.findByText("Ready");
    expect(screen.queryByRole("button", { name: "Pull" })).not.toBeInTheDocument();
  });
});
