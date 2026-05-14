// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── API mock ────────────────────────────────────────────────────────────────

const mockApi = {
  listMedia: vi.fn(),
  deleteMedia: vi.fn(),
  bulkDeleteMedia: vi.fn(),
  listReferences: vi.fn(),
  createReferenceCategory: vi.fn(),
  deleteReferenceCategory: vi.fn(),
  uploadReference: vi.fn(),
  deleteReference: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    listMedia: (...args: unknown[]) => mockApi.listMedia(...args),
    deleteMedia: (...args: unknown[]) => mockApi.deleteMedia(...args),
    bulkDeleteMedia: (...args: unknown[]) => mockApi.bulkDeleteMedia(...args),
    listReferences: (...args: unknown[]) => mockApi.listReferences(...args),
    createReferenceCategory: (...args: unknown[]) => mockApi.createReferenceCategory(...args),
    deleteReferenceCategory: (...args: unknown[]) => mockApi.deleteReferenceCategory(...args),
    uploadReference: (...args: unknown[]) => mockApi.uploadReference(...args),
    deleteReference: (...args: unknown[]) => mockApi.deleteReference(...args),
  },
}));

import { MediaPage } from "./MediaPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listMedia.mockResolvedValue({ files: [] });
  mockApi.listReferences.mockResolvedValue({ categories: [] });
});

// ─── Rendering & tabs ────────────────────────────────────────────────────────

describe("MediaPage rendering", () => {
  it("renders the page title and two tabs", async () => {
    render(<MediaPage />);
    expect(screen.getByRole("heading", { name: /Media/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Generated" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "References" })).toBeInTheDocument();
    // Generated is active by default → loads media
    await waitFor(() => expect(mockApi.listMedia).toHaveBeenCalled());
  });

  it("switches to the References tab and loads references", async () => {
    render(<MediaPage />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));
    await waitFor(() => expect(mockApi.listReferences).toHaveBeenCalled());
  });
});

// ─── Generated tab ───────────────────────────────────────────────────────────

describe("Generated tab", () => {
  it("shows empty state when no media files exist", async () => {
    render(<MediaPage />);
    await waitFor(() =>
      expect(screen.getByText(/No media files yet/i)).toBeInTheDocument(),
    );
  });

  it("renders a grid of media files", async () => {
    mockApi.listMedia.mockResolvedValue({
      files: [
        { filename: "a.png", path: "/a" },
        { filename: "b.png", path: "/b" },
      ],
    });
    render(<MediaPage />);
    expect(await screen.findByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });

  it("selects a file via checkbox and shows the delete-N button", async () => {
    mockApi.listMedia.mockResolvedValue({
      files: [{ filename: "a.png", path: "/a" }, { filename: "b.png", path: "/b" }],
    });
    render(<MediaPage />);
    const checkbox = await screen.findByLabelText("Select a.png");
    fireEvent.click(checkbox);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete 1/ })).toBeInTheDocument();
  });

  it("bulk-deletes selected files after confirmation", async () => {
    mockApi.listMedia.mockResolvedValueOnce({
      files: [{ filename: "a.png", path: "/a" }, { filename: "b.png", path: "/b" }],
    });
    mockApi.bulkDeleteMedia.mockResolvedValue({ ok: true, deleted: 2, errors: [] });
    mockApi.listMedia.mockResolvedValueOnce({ files: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MediaPage />);
    fireEvent.click(await screen.findByLabelText("Select a.png"));
    fireEvent.click(screen.getByLabelText("Select b.png"));
    fireEvent.click(screen.getByRole("button", { name: /Delete 2/ }));

    await waitFor(() =>
      expect(mockApi.bulkDeleteMedia).toHaveBeenCalledWith(["a.png", "b.png"]),
    );
  });

  it("does not bulk-delete when user cancels confirmation", async () => {
    mockApi.listMedia.mockResolvedValue({
      files: [{ filename: "a.png", path: "/a" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<MediaPage />);
    fireEvent.click(await screen.findByLabelText("Select a.png"));
    fireEvent.click(screen.getByRole("button", { name: /Delete 1/ }));

    expect(mockApi.bulkDeleteMedia).not.toHaveBeenCalled();
  });

  it("deletes a single file via the per-row trash button", async () => {
    mockApi.listMedia.mockResolvedValueOnce({
      files: [{ filename: "a.png", path: "/a" }],
    });
    mockApi.deleteMedia.mockResolvedValue({ ok: true });
    mockApi.listMedia.mockResolvedValueOnce({ files: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MediaPage />);
    fireEvent.click(await screen.findByLabelText("Delete a.png"));

    await waitFor(() => expect(mockApi.deleteMedia).toHaveBeenCalledWith("a.png"));
  });

  it("selects all files when 'Select all' is clicked", async () => {
    mockApi.listMedia.mockResolvedValue({
      files: [{ filename: "a.png", path: "/a" }, { filename: "b.png", path: "/b" }],
    });
    render(<MediaPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Select all/ }));
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });
});

// ─── References tab ──────────────────────────────────────────────────────────

describe("References tab", () => {
  beforeEach(() => {
    mockApi.listReferences.mockResolvedValue({
      categories: [
        {
          name: "logos",
          count: 1,
          files: [
            {
              filename: "logo.png",
              url: "/api/references/file/logos/logo.png",
              path: "/x",
              size: 100,
              uploadedAt: Date.now(),
            },
          ],
        },
        { name: "person", count: 0, files: [] },
      ],
    });
  });

  function gotoReferences() {
    render(<MediaPage />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));
  }

  it("renders categories in the sidebar with file counts", async () => {
    gotoReferences();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^logos/ })).toBeInTheDocument(),
    );
    expect(screen.getByText("person")).toBeInTheDocument();
    // The "logos" category has 1 file → count shown
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("creates a new category via prompt", async () => {
    mockApi.createReferenceCategory.mockResolvedValue({
      ok: true,
      created: true,
      name: "brand",
    });
    vi.spyOn(window, "prompt").mockReturnValue("brand");

    gotoReferences();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^logos/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /New category/ }));

    await waitFor(() =>
      expect(mockApi.createReferenceCategory).toHaveBeenCalledWith("brand"),
    );
  });

  it("deletes a single reference file after confirmation", async () => {
    mockApi.deleteReference.mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    gotoReferences();
    // The first category "logos" is auto-selected; its one image is shown
    const delBtn = await screen.findByLabelText("Delete logo.png");
    fireEvent.click(delBtn);

    await waitFor(() =>
      expect(mockApi.deleteReference).toHaveBeenCalledWith("logos", "logo.png"),
    );
  });

  it("uploads files via the hidden file input", async () => {
    mockApi.uploadReference.mockResolvedValue({
      ok: true,
      category: "logos",
      file: { filename: "ref_x.png", url: "/u", size: 1, uploadedAt: 0 },
    });

    gotoReferences();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^logos/ })).toBeInTheDocument(),
    );

    const input = screen.getByLabelText("Upload reference images") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(mockApi.uploadReference).toHaveBeenCalledWith("logos", file),
    );
  });

  it("deletes an empty category via the trash icon on hover", async () => {
    mockApi.deleteReferenceCategory.mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    gotoReferences();
    // "person" has 0 files → its delete button is rendered
    const personRow = (await screen.findByText("person")).closest("div")!;
    const deleteBtn = within(personRow).getByLabelText("Delete category person");
    fireEvent.click(deleteBtn);

    await waitFor(() =>
      expect(mockApi.deleteReferenceCategory).toHaveBeenCalledWith("person"),
    );
  });
});

// ─── Accessibility ───────────────────────────────────────────────────────────

describe("MediaPage accessibility", () => {
  // Known issues we suppress:
  // - color-contrast: theme tokens are mocked in jsdom and resolve to defaults
  // - heading-order: MediaPage uses h1 only, but axe may flag tab content patterns
  const axeRules = {
    rules: {
      "color-contrast": { enabled: false },
    },
  };

  it("passes axe checks on the empty Generated tab", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<MediaPage />);
    await waitFor(() =>
      expect(screen.getByText(/No media files yet/i)).toBeInTheDocument(),
    );
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });

  it("passes axe checks on the References tab with default categories", async () => {
    const { axe } = await import("vitest-axe");
    mockApi.listReferences.mockResolvedValue({
      categories: [
        { name: "person", count: 0, files: [] },
        { name: "logos", count: 0, files: [] },
      ],
    });
    const { container } = render(<MediaPage />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^logos/ })).toBeInTheDocument(),
    );
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });
});
