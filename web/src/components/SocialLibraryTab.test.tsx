// @vitest-environment jsdom
//
// Smoke tests for SocialLibraryTab — the legacy library view + the new
// multi-select + RemixWizard pieces. Heavy mock of fetch since the component
// hits /api/socialview/library on mount and /api/content/remix-batch when
// the wizard fires. Earlier filter/sort logic is covered by library.test.ts.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SocialLibraryTab } from "./SocialLibraryTab.js";

interface MockPost {
  id: string;
  platform: "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";
  source: "own" | "role-model";
  url: string;
  author: { handle: string; displayName?: string };
  text: string;
  hook: string;
  cta: string | null;
  hashtags: string[];
  mentions: string[];
  media: any[];
  engagement: { likes: number | null; comments: number | null };
  engagementRate: number | null;
  postType: string;
  postedAt: string | null;
  tags: string[];
  isGold: boolean;
  extractedAt: string;
  notes: string;
}

function post(overrides: Partial<MockPost> & { id: string }): MockPost {
  return {
    id: overrides.id,
    platform: overrides.platform ?? "instagram",
    source: overrides.source ?? "role-model",
    url: `https://example/${overrides.id}`,
    author: overrides.author ?? { handle: "rileybrown.ai" },
    text: overrides.text ?? "viral post body",
    hook: overrides.hook ?? "viral hook",
    cta: null,
    hashtags: [],
    mentions: [],
    media: [],
    engagement: { likes: 1000, comments: 20 },
    engagementRate: 0.02,
    postType: "reel",
    postedAt: "2026-05-15T00:00:00Z",
    tags: [],
    isGold: false,
    extractedAt: "2026-05-17T00:00:00Z",
    notes: "",
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const noopShowMessage = vi.fn();

describe("SocialLibraryTab — Latest Hits preset", () => {
  // The preset button must flip three filters at once and trigger a re-fetch
  // with the matching query string. This is the headline "view what's hot"
  // UX so it deserves dedicated coverage.
  it("clicking Latest Hits sets role-model + sortBy=posted + last 7 days", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ posts: [] }), { status: 200 }));
    render(<SocialLibraryTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText(/no posts yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Latest Hits/i }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain("source=role-model");
      expect(lastCall).toContain("sortBy=posted");
      expect(lastCall).toContain("postedWithinDays=7");
    });
  });
});

describe("SocialLibraryTab — selection bar", () => {
  // Checkboxes only render for role-model posts (selecting your own posts
  // for remix would be pointless). Bar appears once at least one is picked.
  it("shows the batch action bar after selecting a role-model post", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      posts: [post({ id: "rm1", source: "role-model" })],
    }), { status: 200 }));
    render(<SocialLibraryTab showMessage={noopShowMessage} />);

    // Switch filter to role-model so the action bar can render.
    await waitFor(() => expect(screen.getByLabelText(/filter by source/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/filter by source/i), { target: { value: "role-model" } });
    await waitFor(() => expect(screen.getByText("viral hook")).toBeInTheDocument());

    // Bar isn't there yet.
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/select post by rileybrown.ai/i));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remix into drafts/i })).toBeInTheDocument();
  });
});

describe("SocialLibraryTab — RemixWizard", () => {
  // Wizard opens when the user clicks "Remix into drafts →" and surfaces
  // the count of selected posts in the heading.
  it("opens the wizard modal showing the selected count", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      posts: [
        post({ id: "p1", source: "role-model", author: { handle: "creator_a" } }),
        post({ id: "p2", source: "role-model", author: { handle: "creator_b" } }),
      ],
    }), { status: 200 }));
    render(<SocialLibraryTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByLabelText(/filter by source/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/filter by source/i), { target: { value: "role-model" } });
    await waitFor(() => expect(screen.getByLabelText(/select post by creator_a/i)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/select post by creator_a/i));
    fireEvent.click(screen.getByLabelText(/select post by creator_b/i));
    fireEvent.click(screen.getByRole("button", { name: /Remix into drafts/i }));

    expect(screen.getByRole("dialog", { name: /Remix selected posts into drafts/i })).toBeInTheDocument();
    expect(screen.getByText(/Remix 2 posts into drafts/i)).toBeInTheDocument();
  });

  // Submitting the wizard hits /content/remix-batch and surfaces success via showMessage.
  it("submits remix-batch and calls onSuccess with succeeded count", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/content/remix-batch") && init?.method === "POST") {
        return new Response(JSON.stringify({
          drafts: [{ id: "d1", text: "t", platforms: ["instagram"] }],
          errors: [],
          attempted: 1,
          succeeded: 1,
          failed: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        posts: [post({ id: "p1", source: "role-model" })],
      }), { status: 200 });
    });
    const showMessage = vi.fn();
    render(<SocialLibraryTab showMessage={showMessage} />);
    await waitFor(() => expect(screen.getByLabelText(/filter by source/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/filter by source/i), { target: { value: "role-model" } });
    await waitFor(() => expect(screen.getByLabelText(/select post by rileybrown.ai/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/select post by rileybrown.ai/i));
    fireEvent.click(screen.getByRole("button", { name: /Remix into drafts/i }));

    // Fill the URL (required) and submit.
    fireEvent.change(screen.getByPlaceholderText(/markusstoeger.com/i), { target: { value: "https://markusstoeger.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 1 drafts/i }));

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("1 drafts created"));
    });
  });
});
