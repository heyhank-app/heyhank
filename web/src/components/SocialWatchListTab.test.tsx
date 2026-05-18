// @vitest-environment jsdom
//
// Component tests for SocialWatchListTab. The component talks to
// /api/socialview/watch-list directly via fetch (mirroring SocialLibraryTab's
// pattern), so we mock global.fetch instead of the api module.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SocialWatchListTab } from "./SocialWatchListTab.js";

// Note: vitest-axe's toHaveNoViolations matcher is registered globally in
// src/test-setup.ts — we just dynamic-import `axe` per-test like AgentCard.test.tsx.

interface MockEntry {
  id: string;
  platform: "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";
  handle: string;
  displayName?: string;
  notes?: string;
  enabled: boolean;
  createdAt: string;
  lastCrawledAt: string | null;
  lastCrawlStatus: "ok" | "error" | "never";
  lastCrawlMessage?: string;
  lastCrawlPostsExtracted?: number;
}

function entry(overrides: Partial<MockEntry> = {}): MockEntry {
  return {
    id: "e1",
    platform: "instagram",
    handle: "rileybrown.ai",
    enabled: true,
    createdAt: new Date().toISOString(),
    lastCrawledAt: null,
    lastCrawlStatus: "never",
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Default GET handler — most tests override this per case.
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/api/socialview/watch-list")) {
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const noopShowMessage = vi.fn();

describe("SocialWatchListTab — render", () => {
  // Empty-state message is the first thing a new user sees. Verifying it
  // also confirms the initial GET fired.
  it("renders empty state when no entries exist", async () => {
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => {
      expect(screen.getByText(/no creators yet/i)).toBeInTheDocument();
    });
  });

  // Lists entries with their badges and crawl-status pills.
  it("renders entries from the API", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        entries: [
          entry({ id: "e1", handle: "rileybrown.ai", displayName: "Riley Brown" }),
          entry({ id: "e2", handle: "hormozi", platform: "tiktok", enabled: false }),
        ],
      }), { status: 200 }),
    );
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => {
      expect(screen.getByText("Riley Brown")).toBeInTheDocument();
      // Hormozi is paused so the paused badge must show.
      expect(screen.getByText(/paused/i)).toBeInTheDocument();
    });
    expect(screen.getByText("@rileybrown.ai")).toBeInTheDocument();
  });

  // Axe a11y scan on the loaded state. Confirms the add form's inputs,
  // platform select, and entry buttons have accessible names.
  it("has no axe accessibility violations", async () => {
    const { axe } = await import("vitest-axe");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ entries: [entry()] }), { status: 200 }),
    );
    const { container } = render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText("rileybrown.ai")).toBeInTheDocument());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("SocialWatchListTab — add flow", () => {
  // Happy path: typing a handle + clicking Add fires POST and re-renders the list.
  it("POSTs a new entry and refreshes the list", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      callCount++;
      // First GET: empty list
      // Second call: POST
      // Third GET (after add): list with one entry
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, entry: entry() }), { status: 201 });
      }
      if (callCount === 1) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ entries: [entry()] }), { status: 200 });
    });
    const showMessage = vi.fn();
    render(<SocialWatchListTab showMessage={showMessage} />);
    // Wait initial load
    await waitFor(() => expect(screen.getByText(/no creators yet/i)).toBeInTheDocument());

    const handleInput = screen.getByLabelText(/^handle$/i);
    fireEvent.change(handleInput, { target: { value: "rileybrown.ai" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("Added rileybrown.ai"));
    });
    // POST should have been called exactly once with the right body.
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body).toMatchObject({ platform: "instagram", handle: "rileybrown.ai" });
  });

  // Server returns 409 on duplicate — UI surfaces the error message to the user.
  it("shows error when add returns 409 duplicate", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ error: "already watching" }), { status: 409 });
      }
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    });
    const showMessage = vi.fn();
    render(<SocialWatchListTab showMessage={showMessage} />);
    await waitFor(() => expect(screen.getByText(/no creators yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^handle$/i), { target: { value: "dup" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith("already watching", true);
    });
  });
});

describe("SocialWatchListTab — toggle + delete", () => {
  // Pause button on an enabled entry calls PATCH with enabled=false.
  it("toggles enabled via PATCH when Pause clicked", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true, entry: entry({ enabled: false }) }), { status: 200 });
      }
      return new Response(JSON.stringify({ entries: [entry()] }), { status: 200 });
    });
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText("rileybrown.ai")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /pause rileybrown.ai/i }));
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
      expect(patchCalls).toHaveLength(1);
      expect(JSON.parse(patchCalls[0][1].body as string)).toEqual({ enabled: false });
    });
  });

  // Remove button shows confirm; on accept calls DELETE.
  it("deletes via DELETE when Remove confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ entries: [entry()] }), { status: 200 });
    });
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText("rileybrown.ai")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove rileybrown.ai/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const delCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
      expect(delCalls).toHaveLength(1);
    });
    confirmSpy.mockRestore();
  });

  // If the user clicks Cancel on the confirm dialog, no DELETE fires.
  it("does not delete when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ entries: [entry()] }), { status: 200 }));
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText("rileybrown.ai")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove rileybrown.ai/i }));
    expect(confirmSpy).toHaveBeenCalled();
    const delCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(delCalls).toHaveLength(0);
    confirmSpy.mockRestore();
  });
});

describe("SocialWatchListTab — filters", () => {
  it("passes platform filter as query param", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText(/no creators yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/filter by platform/i), { target: { value: "tiktok" } });
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(([, init]) => !init || !init.method || init.method === "GET");
      const lastGet = gets[gets.length - 1][0] as string;
      expect(lastGet).toContain("platform=tiktok");
    });
  });

  it("passes enabledOnly=true when checkbox toggled", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    render(<SocialWatchListTab showMessage={noopShowMessage} />);
    await waitFor(() => expect(screen.getByText(/no creators yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/enabled only/i));
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(([, init]) => !init || !init.method || init.method === "GET");
      const lastGet = gets[gets.length - 1][0] as string;
      expect(lastGet).toContain("enabledOnly=true");
    });
  });
});
