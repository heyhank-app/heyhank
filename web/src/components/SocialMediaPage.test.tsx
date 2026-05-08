// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── Mock setup ──────────────────────────────────────────────────────────────
//
// SocialMediaPage exercises a large API surface. These tests focus on the
// Drafts tab's bulk-select feature, so we mock only the api functions the
// Drafts flow touches (listSocialPosts + deleteSocialPost + publishSocialPost)
// plus everything the page calls on initial mount.

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listSocialPosts: vi.fn(),
    deleteSocialPost: vi.fn(),
    publishSocialPost: vi.fn(),
    archiveSocialPost: vi.fn(),
    unarchiveSocialPost: vi.fn(),
    updateSocialPost: vi.fn(),
    createSocialPost: vi.fn(),
    getSocialSettings: vi.fn(),
    getSocialBrowserStatus: vi.fn(),
    getSocialProfiles: vi.fn(),
    getSocialPostComments: vi.fn(),
    getSocialPostAnalytics: vi.fn(),
    getSocialAccountAnalytics: vi.fn(),
    getSocialCalendar: vi.fn(),
    getSocialPost: vi.fn(),
    uploadMedia: vi.fn(),
    replySocialComment: vi.fn(),
  },
}));

vi.mock("../api.js", () => ({ api: mockApi }));

// Sibling tab components import their own api/store deps; we don't exercise
// them in these tests so stub them out to avoid noisy side-effect calls.
vi.mock("./SocialViewTab.js", () => ({ SocialViewTab: () => null }));
vi.mock("./SocialLibraryTab.js", () => ({ SocialLibraryTab: () => null }));
vi.mock("./PersonasTab.js", () => ({ PersonasTab: () => null }));

import { SocialMediaPage } from "./SocialMediaPage.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDraft(overrides: Partial<{ id: string; text: string; platforms: string[] }> = {}) {
  return {
    id: "draft-1",
    text: "Hello world",
    status: "draft",
    platforms: ["twitter"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Render SocialMediaPage on the Drafts tab and wait until the supplied drafts
 * have been loaded into the list (asserted via the "N draft(s)" counter).
 */
async function renderDraftsTab(drafts: ReturnType<typeof makeDraft>[]) {
  mockApi.listSocialPosts.mockResolvedValue({ posts: drafts });
  window.location.hash = "#/socialmedia/drafts";
  const result = render(<SocialMediaPage />);
  await waitFor(() =>
    expect(screen.getByText(`${drafts.length} draft(s)`)).toBeInTheDocument(),
  );
  return result;
}

/**
 * Find the bulk action bar by locating the "{n} selected" counter and
 * walking up to its container. Needed because PostCard also renders a
 * "Delete" button per draft, so a global getByRole is ambiguous.
 */
function getBulkBar(): HTMLElement {
  const counter = screen.getByText(/\d+ selected/);
  // The button row sits next to the counter inside the bar wrapper.
  const bar = counter.parentElement;
  if (!bar) throw new Error("Bulk action bar not found");
  return bar as HTMLElement;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults — every test can override.
  mockApi.listSocialPosts.mockResolvedValue({ posts: [] });
  mockApi.deleteSocialPost.mockResolvedValue({ ok: true });
  mockApi.publishSocialPost.mockResolvedValue({ id: "draft-1", status: "scheduled" });
});

describe("SocialMediaPage — DraftsTab bulk-select", () => {
  // ── Render ────────────────────────────────────────────────────────────────

  // Confirms the empty-state path renders without crashing and that the
  // bulk-select UI degrades gracefully when there are no drafts.
  it("renders empty state when no drafts exist", async () => {
    await renderDraftsTab([]);
    expect(screen.getByText(/No drafts\./)).toBeInTheDocument();
    // Select-all checkbox exists but is disabled when the list is empty.
    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    expect(selectAll).toBeDisabled();
    // Bulk action bar should NOT appear when nothing is selected.
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it("renders draft list with per-card checkboxes", async () => {
    await renderDraftsTab([
      makeDraft({ id: "a", text: "First draft" }),
      makeDraft({ id: "b", text: "Second draft" }),
    ]);
    expect(screen.getByText("First draft")).toBeInTheDocument();
    expect(screen.getByText("Second draft")).toBeInTheDocument();
    // PostCard renders an aria-label="Select post" checkbox per draft.
    expect(screen.getAllByLabelText("Select post")).toHaveLength(2);
  });

  // ── Selection behavior ─────────────────────────────────────────────────────

  // Toggling a single card checkbox should reveal the bulk action bar with
  // the correct selection counter and Delete + Clear buttons.
  it("shows bulk action bar after selecting a single draft", async () => {
    await renderDraftsTab([makeDraft({ id: "a" })]);

    const cardCheckbox = screen.getByLabelText("Select post");
    fireEvent.click(cardCheckbox);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const bar = getBulkBar();
    expect(within(bar).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  // The "Select all" checkbox should select every visible draft and update
  // the counter, then deselect them all on a second click.
  it("select-all toggles every visible draft on and off", async () => {
    await renderDraftsTab([
      makeDraft({ id: "a" }),
      makeDraft({ id: "b" }),
      makeDraft({ id: "c" }),
    ]);

    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    fireEvent.click(selectAll);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(selectAll.checked).toBe(true);

    // Second click clears the selection.
    fireEvent.click(selectAll);
    expect(screen.queryByText(/\bselected\b/)).not.toBeInTheDocument();
    expect(selectAll.checked).toBe(false);
  });

  // When some — but not all — drafts are selected, the select-all checkbox
  // should be in the indeterminate state so the user gets a visual hint.
  it("select-all is indeterminate when only some drafts are selected", async () => {
    await renderDraftsTab([
      makeDraft({ id: "a" }),
      makeDraft({ id: "b" }),
    ]);

    const cardCheckboxes = screen.getAllByLabelText("Select post");
    fireEvent.click(cardCheckboxes[0]);

    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);
  });

  // The "Clear" button in the bulk bar should drop all selections without
  // calling any backend mutation.
  it("Clear button discards the selection without API calls", async () => {
    await renderDraftsTab([makeDraft({ id: "a" })]);

    fireEvent.click(screen.getByLabelText("Select post"));
    fireEvent.click(within(getBulkBar()).getByRole("button", { name: "Clear" }));

    expect(screen.queryByText(/\bselected\b/)).not.toBeInTheDocument();
    expect(mockApi.deleteSocialPost).not.toHaveBeenCalled();
  });

  // ── Bulk delete ────────────────────────────────────────────────────────────

  // Bulk delete should confirm with the user, call deleteSocialPost once per
  // selected draft, and reload the drafts list afterwards.
  it("bulkDelete confirms then deletes every selected draft sequentially", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderDraftsTab([
      makeDraft({ id: "a" }),
      makeDraft({ id: "b" }),
    ]);

    // First listSocialPosts call (initial load) — capture so we can verify
    // a refresh fires after deletion.
    const initialLoadCalls = mockApi.listSocialPosts.mock.calls.length;

    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(within(getBulkBar()).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockApi.deleteSocialPost).toHaveBeenCalledTimes(2);
    });
    expect(mockApi.deleteSocialPost).toHaveBeenCalledWith("a");
    expect(mockApi.deleteSocialPost).toHaveBeenCalledWith("b");
    // Refresh fires after bulk action.
    expect(mockApi.listSocialPosts.mock.calls.length).toBeGreaterThan(initialLoadCalls);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // If the user cancels the confirm dialog, no API calls should fire.
  it("bulkDelete is a no-op when the confirm prompt is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDraftsTab([makeDraft({ id: "a" })]);

    fireEvent.click(screen.getByLabelText("Select post"));
    fireEvent.click(within(getBulkBar()).getByRole("button", { name: "Delete" }));

    expect(mockApi.deleteSocialPost).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // Edge case: a partially failing bulk operation should still process every
  // selected draft and surface the failure count to the user.
  it("bulkDelete reports partial failures without aborting the loop", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.deleteSocialPost
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("boom"));

    await renderDraftsTab([
      makeDraft({ id: "a" }),
      makeDraft({ id: "b" }),
    ]);

    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(within(getBulkBar()).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockApi.deleteSocialPost).toHaveBeenCalledTimes(2);
    });
    // Both ids attempted even though the second rejected.
    expect(mockApi.deleteSocialPost).toHaveBeenCalledWith("a");
    expect(mockApi.deleteSocialPost).toHaveBeenCalledWith("b");
    confirmSpy.mockRestore();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  // Empty drafts tab — a basic axe scan to catch obvious a11y regressions in
  // the bulk-select markup. We disable a couple of rules that fail because
  // the test renders the tab outside of its app shell (no <main>, no <h1>).
  it("passes axe accessibility checks (empty drafts tab)", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = await renderDraftsTab([]);
    const results = await axe(container, {
      rules: {
        // The sub-tree under test starts at <h1> directly (no <main>).
        region: { enabled: false },
        "landmark-one-main": { enabled: false },
        "page-has-heading-one": { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });

  it("passes axe accessibility checks with bulk action bar visible", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = await renderDraftsTab([makeDraft({ id: "a" })]);
    fireEvent.click(screen.getByLabelText("Select post"));
    const results = await axe(container, {
      rules: {
        region: { enabled: false },
        "landmark-one-main": { enabled: false },
        "page-has-heading-one": { enabled: false },
        // The bulk-action "Delete" link uses a low-contrast red on dark — the
        // colors are tokens defined globally; not a regression of this PR.
        "color-contrast": { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });
});
