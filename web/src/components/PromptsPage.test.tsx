// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  currentSessionId: string | null;
  sessions: Map<string, { cwd?: string }>;
  sdkSessions: Array<{ sessionId: string; cwd: string }>;
}

let mockState: MockStoreState;

const mockApi = {
  listPrompts: vi.fn(),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  listDirs: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    listPrompts: (...args: unknown[]) => mockApi.listPrompts(...args),
    createPrompt: (...args: unknown[]) => mockApi.createPrompt(...args),
    updatePrompt: (...args: unknown[]) => mockApi.updatePrompt(...args),
    deletePrompt: (...args: unknown[]) => mockApi.deletePrompt(...args),
    listDirs: (...args: unknown[]) => mockApi.listDirs(...args),
  },
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

// Mock createPortal for FolderPicker
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

import { PromptsPage } from "./PromptsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = {
    currentSessionId: "s1",
    sessions: new Map([["s1", { cwd: "/repo" }]]),
    sdkSessions: [],
  };
  mockApi.listPrompts.mockResolvedValue([]);
  mockApi.createPrompt.mockResolvedValue({
    id: "p1",
    name: "review-pr",
    content: "Review this PR",
    scope: "global",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mockApi.updatePrompt.mockResolvedValue({
    id: "p1",
    name: "updated",
    content: "Updated prompt content",
    scope: "global",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mockApi.deletePrompt.mockResolvedValue({ ok: true });
  mockApi.listDirs.mockResolvedValue({ path: "/", dirs: [], home: "/" });
});

describe("PromptsPage", () => {
  it("loads prompts on mount using current session cwd (no scope filter)", async () => {
    // Validates prompt listing now fetches all scopes visible for cwd.
    render(<PromptsPage embedded />);
    await waitFor(() => {
      expect(mockApi.listPrompts).toHaveBeenCalledWith("/repo");
    });
  });

  it("creates a global prompt by default", async () => {
    // Validates create payload defaults to global scope.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "review-pr" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Review this PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Prompt" }));

    await waitFor(() => {
      expect(mockApi.createPrompt).toHaveBeenCalledWith({
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
      });
    });
  });

  it("creates a project-scoped prompt with cwd pre-filled", async () => {
    // Validates clicking "Project folders" scope sets projectPaths from cwd.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "project-prompt" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Project content" } });

    // Switch to project scope
    fireEvent.click(screen.getByRole("button", { name: "Project folders" }));

    fireEvent.click(screen.getByRole("button", { name: "Create Prompt" }));

    await waitFor(() => {
      expect(mockApi.createPrompt).toHaveBeenCalledWith({
        name: "project-prompt",
        content: "Project content",
        scope: "project",
        projectPaths: ["/repo"],
      });
    });
  });

  it("can create a global prompt without cwd", async () => {
    // Edge case: creation should work with no active session in global-only mode.
    mockState = {
      currentSessionId: null,
      sessions: new Map(),
      sdkSessions: [],
    };
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "global" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Always do X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Prompt" }));

    await waitFor(() => {
      expect(mockApi.createPrompt).toHaveBeenCalledWith({
        name: "global",
        content: "Always do X",
        scope: "global",
      });
    });
  });

  it("deletes an existing prompt", async () => {
    // Validates delete action wiring from list item to API.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("review-pr");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockApi.deletePrompt).toHaveBeenCalledWith("p1");
    });
  });

  it("edits an existing prompt", async () => {
    // Validates inline edit mode persists name, content, scope through updatePrompt.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("review-pr");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const nameInput = screen.getByDisplayValue("review-pr");
    const contentInput = screen.getByDisplayValue("Review this PR");
    fireEvent.change(nameInput, { target: { value: "review-updated" } });
    fireEvent.change(contentInput, { target: { value: "Updated content" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updatePrompt).toHaveBeenCalledWith("p1", {
        name: "review-updated",
        content: "Updated content",
        scope: "global",
      });
    });
  });

  it("edits a project prompt and preserves scope/paths", async () => {
    // Validates that editing a project-scoped prompt preserves scope and paths.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p2",
        name: "local-check",
        content: "Run local checks",
        scope: "project",
        projectPath: "/repo",
        projectPaths: ["/repo"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("local-check");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByDisplayValue("local-check"), { target: { value: "local-check-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updatePrompt).toHaveBeenCalledWith("p2", {
        name: "local-check-v2",
        content: "Run local checks",
        scope: "project",
        projectPaths: ["/repo"],
      });
    });
  });

  it("filters prompts by search query", async () => {
    // Validates in-page filtering over prompt name/content/scope.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "p2",
        name: "write-tests",
        content: "Write missing tests",
        scope: "project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("review-pr");

    fireEvent.change(screen.getByPlaceholderText("Search by title or content..."), {
      target: { value: "write" },
    });
    expect(screen.getByText("write-tests")).toBeInTheDocument();
    expect(screen.queryByText("review-pr")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by title or content..."), {
      target: { value: "not-found" },
    });
    expect(screen.getByText("No prompts match your search.")).toBeInTheDocument();
  });

  it("shows scope badge with folder name for project prompts", async () => {
    // Validates the scope badge shows folder directory name for project-scoped prompts.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "project-prompt",
        content: "Content",
        scope: "project",
        projectPath: "/home/user/my-project",
        projectPaths: ["/home/user/my-project"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("project-prompt");
    // The scope badge should show the folder name
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("shows scope selector in create form with Global and Project folders buttons", async () => {
    // Validates the scope selector UI is rendered.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Global" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project folders" })).toBeInTheDocument();
  });

  it("shows folder chips and Add folder button when project scope selected", async () => {
    // Validates the folder chip UI renders with remove buttons when project scope is active.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.click(screen.getByRole("button", { name: "Project folders" }));

    // cwd "/repo" should be auto-filled as a chip
    expect(screen.getByText("repo")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove folder /repo")).toBeInTheDocument();
    expect(screen.getByText("Add folder")).toBeInTheDocument();
  });

  it("removes a folder chip when remove button clicked", async () => {
    // Validates folder removal interaction in the scope selector.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.click(screen.getByRole("button", { name: "Project folders" }));

    // Remove the auto-filled folder
    fireEvent.click(screen.getByLabelText("Remove folder /repo"));

    // No chips should remain, but Add folder should still be visible
    expect(screen.queryByText("repo")).not.toBeInTheDocument();
    expect(screen.getByText("Add folder")).toBeInTheDocument();
  });

  it("shows error when creating project prompt with no folders selected", async () => {
    // Validates client-side validation for empty folder list.
    render(<PromptsPage embedded />);
    fireEvent.click(screen.getByRole("button", { name: /new prompt/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "test" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "content" } });
    fireEvent.click(screen.getByRole("button", { name: "Project folders" }));

    // Remove auto-filled folder
    fireEvent.click(screen.getByLabelText("Remove folder /repo"));

    fireEvent.click(screen.getByRole("button", { name: "Create Prompt" }));

    expect(screen.getByText("Select at least one project folder")).toBeInTheDocument();
    expect(mockApi.createPrompt).not.toHaveBeenCalled();
  });

  it("displays multi-folder scope badge with count", async () => {
    // Validates the scope badge shows +N count for prompts with multiple folders.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "multi-folder",
        content: "Content",
        scope: "project",
        projectPath: "/home/user/repo-a",
        projectPaths: ["/home/user/repo-a", "/home/user/repo-b", "/home/user/repo-c"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("multi-folder");
    expect(screen.getByText("repo-a +2")).toBeInTheDocument();
  });

  it("shows Back button in non-embedded mode", async () => {
    // Validates the Back button renders when not embedded.
    render(<PromptsPage />);
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("cancels editing and resets state", async () => {
    // Validates cancel in edit mode clears edit state.
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(<PromptsPage embedded />);
    await screen.findByText("review-pr");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("review-pr")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Should be back to display mode
    expect(screen.queryByDisplayValue("review-pr")).not.toBeInTheDocument();
    expect(screen.getByText("review-pr")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    // Validates loading indicator appears before prompts load.
    render(<PromptsPage embedded />);
    expect(screen.getByText("Loading prompts...")).toBeInTheDocument();
  });

  it("passes axe accessibility checks", async () => {
    // Ensures the PromptsPage meets WCAG accessibility standards.
    const { axe } = await import("vitest-axe");
    mockApi.listPrompts.mockResolvedValueOnce([
      {
        id: "p1",
        name: "review-pr",
        content: "Review this PR",
        scope: "global",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    const { container } = render(<PromptsPage embedded />);
    await screen.findByText("review-pr");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
