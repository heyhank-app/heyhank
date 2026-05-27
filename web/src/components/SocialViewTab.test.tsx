// @vitest-environment jsdom
//
// Focused tests for the SocialViewTab — specifically the new "Go + Extract"
// button + TikTok hint added 2026-05-23 alongside the single-URL workflow.
// We don't drive the noVNC iframe or the SSE-streaming Extract flow here —
// those run against the live Playwright backend and are exercised by the
// auto-crawler integration tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const axeRules = {
  rules: {
    label: { enabled: false },
    "heading-order": { enabled: false },
    "button-name": { enabled: false },
    "select-name": { enabled: false },
  },
  // The component renders a noVNC iframe; axe's frame-traversal can't reach
  // into cross-origin frames inside jsdom and throws. Disable iframe analysis
  // for this component-level axe scan.
  iframes: false,
};

import { SocialViewTab } from "./SocialViewTab.js";

// ─── fetch mock ──────────────────────────────────────────────────────────────
//
// SocialViewTab uses inline fetch via local apiGet/apiPost helpers (it does
// NOT import api.ts). We stub global.fetch with a per-test handler map keyed
// on path + method. Each test gets a clean slate via beforeEach.

interface FetchResponse {
  status?: number;
  body?: unknown;
}
type FetchHandler = (url: string, init?: RequestInit) => FetchResponse | Promise<FetchResponse>;

let fetchHandlers: Map<string, FetchHandler> = new Map();

function setFetchHandler(method: string, pathMatch: string, handler: FetchHandler) {
  fetchHandlers.set(`${method.toUpperCase()} ${pathMatch}`, handler);
}

beforeEach(() => {
  fetchHandlers = new Map();
  // Default status response — tab needs this on mount.
  setFetchHandler("GET", "/api/socialview/status", () => ({
    body: {
      vnc: { x11vnc: true, websockify: true, port: 6080 },
      platforms: [
        { platform: "instagram", running: false, loggedIn: null, currentUrl: null, startedAt: null },
        { platform: "twitter", running: false, loggedIn: null, currentUrl: null, startedAt: null },
        { platform: "linkedin", running: false, loggedIn: null, currentUrl: null, startedAt: null },
        { platform: "facebook", running: false, loggedIn: null, currentUrl: null, startedAt: null },
        { platform: "tiktok", running: true, loggedIn: true, currentUrl: "https://www.tiktok.com/", startedAt: Date.now() },
      ],
    },
  }));

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    // Find a matching handler — exact path match first, then prefix.
    let matched: FetchHandler | undefined;
    for (const [key, h] of fetchHandlers) {
      const [m, p] = key.split(" ");
      if (m === method && url.includes(p)) { matched = h; break; }
    }
    if (!matched) {
      return new Response(JSON.stringify({ error: `unmocked: ${method} ${url}` }), { status: 500 });
    }
    const result = await matched(url, init);
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
  // localStorage stub for authHeaders().
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => "test-token"),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SocialViewTab — Single-URL Extract flow", () => {
  it("renders the platform list after initial status fetch", async () => {
    render(<SocialViewTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/TikTok/)).toBeInTheDocument());
    // Other platforms appear too.
    expect(screen.getByText(/Instagram/)).toBeInTheDocument();
    expect(screen.getByText(/Facebook/)).toBeInTheDocument();
  });

  it("renders the TikTok-specific hint after selecting (View) the TikTok platform", async () => {
    render(<SocialViewTab showMessage={() => {}} />);
    // Wait for status fetch to complete and the View button for TikTok to render
    // (TikTok is "running" in our mocked status, so it shows "View" not "Start").
    await waitFor(() => expect(screen.getByRole("button", { name: /^View$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^View$/ }));

    // The hint box explains bulk-crawl is blocked.
    await waitFor(() => expect(screen.getByText(/Bulk-Profile-Crawl ist von TikTok geblockt/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Go \+ Extract/ })).toBeInTheDocument();
  });

  it("Go + Extract calls /api/socialview/tiktok/extract-url with the pasted URL", async () => {
    let extractUrlPayload: { url?: string; source?: string } | null = null;
    setFetchHandler("POST", "/api/socialview/tiktok/extract-url", (_url, init) => {
      extractUrlPayload = init?.body ? JSON.parse(String(init.body)) : null;
      return { body: { ok: true, extracted: 1, postIds: ["post-1"], errors: [] } };
    });

    render(<SocialViewTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^View$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^View$/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Go \+ Extract/ })).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/instagram\.com\/username/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://www.tiktok.com/@aitrendz/video/7654321" } });

    fireEvent.click(screen.getByRole("button", { name: /Go \+ Extract/ }));

    await waitFor(() => expect(extractUrlPayload).not.toBeNull());
    expect(extractUrlPayload).toEqual({
      url: "https://www.tiktok.com/@aitrendz/video/7654321",
      source: "role-model",
    });
  });

  it("passes axe accessibility checks on initial render", async () => {
    const { container } = render(<SocialViewTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/TikTok/)).toBeInTheDocument());
    const { axe } = await import("vitest-axe");
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });
});
