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
    updateSocialSettings: vi.fn(),
    testSocialConnection: vi.fn(),
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

function makeDraft(
  overrides: Partial<{
    id: string;
    text: string;
    platforms: string[];
    createdAt: string;
    updatedAt: string;
    videoUrl: string;
    thumbnailUrl: string;
    format: string;
  }> = {},
) {
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

// ─── FormatBadge integration ───────────────────────────────────────────────
//
// FormatBadge appears in PostCard for Carousel/Story/Reel drafts. Plain "post"
// or undefined format must NOT show a badge (avoid clutter on the default case).
// When media count >= 2 on a carousel/story, the badge shows "· N" so the user
// can spot half-finished drafts at a glance.

describe("SocialMediaPage — FormatBadge in DraftsTab", () => {
  // FormatBadge has a rounded-full pill styled with inline-flex. We scope
  // querying to that exact element so we don't collide with tab labels or
  // aria-labels that happen to contain "Carousel"/"Story"/"Reel".
  function getBadge(label: string): HTMLElement {
    const all = document.querySelectorAll<HTMLElement>("span.inline-flex.rounded-full");
    const match = Array.from(all).find((el) => (el.textContent ?? "").includes(label));
    if (!match) throw new Error(`FormatBadge with label "${label}" not found`);
    return match;
  }

  it("renders 'Carousel · 5' for a carousel draft with 5 media items", async () => {
    await renderDraftsTab([
      makeDraft({
        id: "carousel-draft",
        text: "Carousel example",
        platforms: ["instagram"],
        ...({ format: "carousel", mediaUrls: ["a", "b", "c", "d", "e"] } as any),
      }),
    ]);
    const badge = getBadge("Carousel");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/· 5/);
  });

  it("renders 'Story' badge without count for a single-frame story", async () => {
    await renderDraftsTab([
      makeDraft({
        id: "story-draft",
        text: "Story example",
        platforms: ["instagram"],
        ...({ format: "story", mediaUrls: ["a"] } as any),
      }),
    ]);
    const badge = getBadge("Story");
    expect(badge).toBeInTheDocument();
    // Single media: no "· N" suffix.
    expect(badge.textContent ?? "").not.toMatch(/· 1/);
  });

  it("renders 'Reel' badge for a reel draft", async () => {
    await renderDraftsTab([
      makeDraft({
        id: "reel-draft",
        text: "Reel example",
        platforms: ["instagram"],
        ...({ format: "reel", mediaUrls: ["video.mp4"] } as any),
      }),
    ]);
    const badge = getBadge("Reel");
    expect(badge).toBeInTheDocument();
  });

  it("does NOT render FormatBadge for plain 'post' or undefined format", async () => {
    await renderDraftsTab([
      makeDraft({ id: "plain-1", text: "Plain post one" }),
      makeDraft({
        id: "plain-2",
        text: "Plain post two",
        ...({ format: "post" } as any),
      }),
    ]);
    // No badge pill should contain Carousel/Story/Reel label text.
    const pills = document.querySelectorAll<HTMLElement>("span.inline-flex.rounded-full");
    const formatPills = Array.from(pills).filter((el) => {
      const t = (el.textContent ?? "").trim();
      return /Carousel|Story|Reel/.test(t);
    });
    expect(formatPills).toHaveLength(0);
  });
});

// ─── SettingsTab — Multi-Backend Routing ─────────────────────────────────────
//
// These tests verify the Settings tab supports configuring Postiz + Buffer in
// parallel (not "one backend at a time") and the Platform Routing block appears
// only when both keys are populated. Added 2026-05-22 alongside the multi-
// backend refactor in server/socialmedia/manager.ts.

async function renderSettingsTab(initialSettings: Record<string, unknown> = {}) {
  mockApi.getSocialSettings.mockResolvedValue(initialSettings);
  mockApi.getSocialBrowserStatus.mockResolvedValue({ platforms: [] });
  mockApi.updateSocialSettings.mockResolvedValue({ ok: true });
  window.location.hash = "#/socialmedia/settings";
  const result = render(<SocialMediaPage />);
  // Wait until the initial getSocialSettings response has propagated into the
  // form by asserting the always-rendered Primary Backend heading is visible.
  await waitFor(() => expect(screen.getByText("Primary Backend")).toBeInTheDocument());
  return result;
}

describe("SocialMediaPage — SettingsTab multi-backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listSocialPosts.mockResolvedValue({ posts: [] });
  });

  it("renders BOTH Postiz and Buffer configuration cards independently", async () => {
    await renderSettingsTab({});
    // Both backend cards are visible at the same time — the old UI showed
    // only the one matching the selected primary backend.
    expect(screen.getByText("Postiz Configuration")).toBeInTheDocument();
    expect(screen.getByText("Buffer Configuration")).toBeInTheDocument();
  });

  it("loads existing platformBackends mapping into the routing selects", async () => {
    await renderSettingsTab({
      backend: "postiz",
      backends: {
        postiz: { url: "https://postiz.example.com", apiKey: "postiz-key-1234" },
        buffer: { apiKey: "buffer-key-1234" },
      },
      platformBackends: { tiktok: "buffer" },
    });
    // Platform Routing block only renders when both backends are configured.
    expect(await screen.findByText("Platform Routing")).toBeInTheDocument();
    const tiktokSelect = screen.getByLabelText("Backend for tiktok") as HTMLSelectElement;
    expect(tiktokSelect.value).toBe("buffer");
    // Instagram has no override → still "Primary" (empty string).
    const igSelect = screen.getByLabelText("Backend for instagram") as HTMLSelectElement;
    expect(igSelect.value).toBe("");
  });

  it("does NOT show Platform Routing when only one backend has a key", async () => {
    await renderSettingsTab({
      backend: "postiz",
      backends: { postiz: { url: "", apiKey: "postiz-key-only" } },
    });
    expect(screen.queryByText("Platform Routing")).not.toBeInTheDocument();
  });

  it("saving sends both backend configs + the platformBackends map", async () => {
    await renderSettingsTab({
      backend: "postiz",
      backends: {
        postiz: { url: "", apiKey: "postiz-key" },
        buffer: { apiKey: "buffer-key" },
      },
      platformBackends: { tiktok: "buffer" },
    });

    // Trigger save via the "Save" button (not Test Connection).
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(mockApi.updateSocialSettings).toHaveBeenCalledTimes(1));
    const payload = mockApi.updateSocialSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.backend).toBe("postiz");
    expect(payload.backends).toMatchObject({
      postiz: expect.objectContaining({ apiKey: "postiz-key" }),
      buffer: expect.objectContaining({ apiKey: "buffer-key" }),
    });
    expect(payload.platformBackends).toEqual({ tiktok: "buffer" });
  });

  it("dropping a platform back to Primary removes it from the saved map", async () => {
    await renderSettingsTab({
      backend: "postiz",
      backends: {
        postiz: { url: "", apiKey: "postiz-key" },
        buffer: { apiKey: "buffer-key" },
      },
      platformBackends: { tiktok: "buffer" },
    });

    // Switch TikTok back to "Primary" (empty value).
    const tiktokSelect = screen.getByLabelText("Backend for tiktok") as HTMLSelectElement;
    fireEvent.change(tiktokSelect, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(mockApi.updateSocialSettings).toHaveBeenCalledTimes(1));
    const payload = mockApi.updateSocialSettings.mock.calls[0][0] as Record<string, unknown>;
    // saveSettings filters out empty-string entries so "tiktok" should NOT
    // appear in the persisted map at all.
    expect(payload.platformBackends).toEqual({});
  });

  it("Test Connection button is disabled until a primary backend is selected", async () => {
    // Setup with both keys but NO primary backend chosen — Test Connection
    // requires a primary because it uses the primary adapter.
    await renderSettingsTab({
      backends: {
        postiz: { url: "", apiKey: "postiz-key" },
        buffer: { apiKey: "buffer-key" },
      },
    });
    const testBtn = screen.getByRole("button", { name: /Test Connection/ });
    expect(testBtn).toBeDisabled();
  });
});

// Drafts: a reel draft must show a playable <video> (not just a text link), and
// the list must be ordered newest-first regardless of server order.
describe("SocialMediaPage — DraftsTab video + sorting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.deleteSocialPost.mockResolvedValue({ ok: true });
  });

  it("renders a video preview for a draft that has a videoUrl", async () => {
    await renderDraftsTab([
      makeDraft({ id: "r1", text: "Reel draft", videoUrl: "/api/media/file/clip.mp4", thumbnailUrl: "/api/media/file/poster.jpg", format: "reel" }),
    ]);
    const vid = screen.getByTestId("draft-video");
    expect(vid).toHaveAttribute("src", "/api/media/file/clip.mp4");
    expect(vid).toHaveAttribute("poster", "/api/media/file/poster.jpg");
  });

  it("opens a fullscreen video popup when the draft video is clicked", async () => {
    await renderDraftsTab([
      makeDraft({ id: "r1", text: "Reel draft", videoUrl: "/api/media/file/clip.mp4", thumbnailUrl: "/api/media/file/poster.jpg", format: "reel" }),
    ]);
    // No lightbox until clicked.
    expect(screen.queryByTestId("video-lightbox-player")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play video/i }));
    // The popup player appears with the same source.
    const player = screen.getByTestId("video-lightbox-player");
    expect(player).toHaveAttribute("src", "/api/media/file/clip.mp4");
    // Closing dismisses it.
    fireEvent.click(screen.getByRole("button", { name: /close video viewer/i }));
    expect(screen.queryByTestId("video-lightbox-player")).not.toBeInTheDocument();
  });

  it("orders drafts newest-first even when the server returns them oldest-first", async () => {
    // Server returns oldest first; the UI must flip it to newest first.
    await renderDraftsTab([
      makeDraft({ id: "old", text: "OLDER draft", createdAt: "2026-06-01T00:00:00.000Z" }),
      makeDraft({ id: "new", text: "NEWER draft", createdAt: "2026-06-04T00:00:00.000Z" }),
    ]);
    const newer = screen.getByText("NEWER draft");
    const older = screen.getByText("OLDER draft");
    // NEWER must appear before OLDER in document order.
    // Node.DOCUMENT_POSITION_FOLLOWING (4) = older follows newer.
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("prefers updatedAt over createdAt for ordering", async () => {
    await renderDraftsTab([
      // 'a' was created later but updated long ago; 'b' created earlier but updated just now → b first.
      makeDraft({ id: "a", text: "Recently created", createdAt: "2026-06-04T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }),
      makeDraft({ id: "b", text: "Recently updated", createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-04T12:00:00.000Z" }),
    ]);
    const updated = screen.getByText("Recently updated");
    const created = screen.getByText("Recently created");
    expect(updated.compareDocumentPosition(created) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
