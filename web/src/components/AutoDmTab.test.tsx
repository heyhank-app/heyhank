// @vitest-environment jsdom
//
// Tests for the Auto-DM tab. Mocks global fetch (the component uses inline
// helpers, not api.ts) and asserts: render, empty state, list rendering with
// real rules, setup-banner when secrets missing, axe a11y, and the create-rule
// flow (form open → submit → POST to /api/automation/rules).

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
};

import { AutoDmTab } from "./AutoDmTab.js";

interface FetchResponse {
  status?: number;
  body?: unknown;
}
type FetchHandler = (url: string, init?: RequestInit) => FetchResponse | Promise<FetchResponse>;

let fetchHandlers: Map<string, FetchHandler> = new Map();

function setFetchHandler(method: string, pathMatch: string, handler: FetchHandler) {
  fetchHandlers.set(`${method.toUpperCase()} ${pathMatch}`, handler);
}

function configuredSecretsBody(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    appId: "1206785405842211",
    pageId: "850520934808190",
    igBusinessId: "17841403941595691",
    appSecretConfigured: true,
    pageAccessTokenConfigured: true,
    webhookVerifyConfigured: true,
    ...overrides,
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    platform: "instagram" as const,
    postId: null,
    keyword: "COURSES",
    dmTemplate: "Here's your link: https://example.com",
    enabled: true,
    sentCount: 5,
    sentTo: [
      { postId: "post-1", commenterId: "user-1", sentAt: "2026-05-24T10:00:00.000Z" },
      { postId: "post-1", commenterId: "user-2", sentAt: "2026-05-24T11:00:00.000Z" },
    ],
    createdAt: "2026-05-24T09:00:00.000Z",
    updatedAt: "2026-05-24T11:00:00.000Z",
    notes: "Smoke",
    ...overrides,
  };
}

beforeEach(() => {
  fetchHandlers = new Map();
  setFetchHandler("GET", "/api/automation/rules", () => ({ body: { rules: [] } }));
  setFetchHandler("GET", "/api/automation/meta-secrets", () => ({ body: configuredSecretsBody() }));
  // Default: empty funnel — tests that assert click data set their own handler.
  setFetchHandler("GET", "/api/automation/funnel", () => ({
    body: { rules: [], totals: { linksSent: 0, linksClicked: 0, totalClicks: 0, clickRate: null } },
  }));
  // Default: no pages connected — every test that wants pages sets its own handler.
  setFetchHandler("GET", "/api/automation/connected-pages", () => ({
    body: { pages: [], needsReconnect: true, reason: "no FB access token configured" },
  }));

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
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

describe("AutoDmTab — empty + setup states", () => {
  it("renders empty state when there are no rules and Meta is configured", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    // No setup banner when Meta is fully configured.
    expect(screen.queryByText(/Meta App nicht vollständig konfiguriert/)).not.toBeInTheDocument();
  });

  it("renders the setup banner when Meta is NOT fully configured", async () => {
    setFetchHandler("GET", "/api/automation/meta-secrets", () => ({
      body: configuredSecretsBody({ configured: false, pageAccessTokenConfigured: false }),
    }));
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Meta App nicht vollständig konfiguriert/)).toBeInTheDocument());
    expect(screen.getByText(/Page Access Token/)).toBeInTheDocument();
  });
});

describe("AutoDmTab — listing existing rules", () => {
  beforeEach(() => {
    setFetchHandler("GET", "/api/automation/rules", () => ({ body: { rules: [makeRule()] } }));
  });

  it("renders a rule card with platform badge, keyword, template preview, and stats", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText("COURSES")).toBeInTheDocument());
    expect(screen.getByText(/instagram/i)).toBeInTheDocument();
    expect(screen.getByText(/Here's your link/)).toBeInTheDocument();
    expect(screen.getByText(/Sent 5× to 2 unique users/)).toBeInTheDocument();
  });

  it("shows 'paused' badge for disabled rules + Enable button instead of Pause", async () => {
    setFetchHandler("GET", "/api/automation/rules", () => ({ body: { rules: [makeRule({ enabled: false })] } }));
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText("paused")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Enable rule/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pause rule/ })).not.toBeInTheDocument();
  });

  it("toggles enabled when Pause is clicked — fires PATCH then reloads", async () => {
    let patchedBody: { enabled?: boolean } | null = null;
    setFetchHandler("PATCH", "/api/automation/rules/rule-1", (_url, init) => {
      patchedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return { body: { ...makeRule(), enabled: false } };
    });

    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Pause rule/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Pause rule/ }));

    await waitFor(() => expect(patchedBody).toEqual({ enabled: false }));
  });
});

describe("AutoDmTab — create form", () => {
  it("opens the form when '+ New Rule' is clicked", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));
    expect(screen.getByText("New Auto-DM Rule")).toBeInTheDocument();
    expect(screen.getByLabelText(/Keyword/)).toBeInTheDocument();
    expect(screen.getByLabelText(/DM Template/)).toBeInTheDocument();
  });

  it("submitting the form POSTs the rule fields to /api/automation/rules", async () => {
    let postedBody: Record<string, unknown> | null = null;
    setFetchHandler("POST", "/api/automation/rules", (_url, init) => {
      postedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return { status: 201, body: { ok: true, rule: makeRule({ keyword: "PROMPTS" }) } };
    });

    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));
    fireEvent.change(screen.getByLabelText(/Keyword/), { target: { value: "PROMPTS" } });
    fireEvent.change(screen.getByLabelText(/DM Template/), { target: { value: "Here's the pack: https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/ }));

    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody).toMatchObject({
      platform: "instagram",
      keyword: "PROMPTS",
      dmTemplate: "Here's the pack: https://example.com",
      postId: null,
    });
  });

  it("switching platform to Facebook updates the form's submitted value", async () => {
    let postedBody: Record<string, unknown> | null = null;
    setFetchHandler("POST", "/api/automation/rules", (_url, init) => {
      postedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return { status: 201, body: { ok: true, rule: makeRule({ platform: "facebook" }) } };
    });

    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));
    fireEvent.click(screen.getByRole("button", { name: /Set platform to facebook/ }));
    fireEvent.change(screen.getByLabelText(/Keyword/), { target: { value: "TEST" } });
    fireEvent.change(screen.getByLabelText(/DM Template/), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/ }));

    await waitFor(() => expect(postedBody?.platform).toBe("facebook"));
  });
});

// ─── Connected Pages panel ───────────────────────────────────────────────────
//
// New panel added 2026-05-25 to demonstrate pages_show_list + business_management
// for Meta App Review. Renders Page list from /me/accounts plus Refresh +
// Reconnect Facebook buttons that re-trigger the Graph call.

describe("AutoDmTab — Connected Pages panel", () => {
  it("renders 'Connected Facebook Pages' card on initial load", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText("Connected Facebook Pages")).toBeInTheDocument());
    // Explanation line names the demonstrated permissions (Meta-reviewer aid).
    expect(screen.getByText(/pages_show_list/)).toBeInTheDocument();
    expect(screen.getByText(/business_management/)).toBeInTheDocument();
  });

  it("shows the empty state with reason when no pages are returned", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No pages found/)).toBeInTheDocument());
    expect(screen.getByText(/no FB access token configured/)).toBeInTheDocument();
  });

  it("lists pages with name + Active badge when /me/accounts returns data", async () => {
    setFetchHandler("GET", "/api/automation/connected-pages", () => ({
      body: {
        pages: [
          { id: "850520934808190", name: "Markus Stoeger", picture: "https://example/pic.jpg", isActive: true },
          { id: "111111111111111", name: "Side Project Page", picture: null, isActive: false },
        ],
        activePageId: "850520934808190",
        source: "user-token",
        needsReconnect: false,
      },
    }));
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText("Markus Stoeger")).toBeInTheDocument());
    expect(screen.getByText("Side Project Page")).toBeInTheDocument();
    // The active page gets a green "Active" badge — the inactive one does not.
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("calls /me/accounts again when Refresh is clicked", async () => {
    let callCount = 0;
    setFetchHandler("GET", "/api/automation/connected-pages", () => {
      callCount++;
      return { body: { pages: [], needsReconnect: false } };
    });
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1));
    const initial = callCount;
    fireEvent.click(screen.getByRole("button", { name: /Refresh connected pages/ }));
    await waitFor(() => expect(callCount).toBeGreaterThan(initial));
  });

  it("opens the OAuth dialog URL when Reconnect Facebook is clicked", async () => {
    setFetchHandler("GET", "/api/automation/fb-oauth-url", () => ({
      body: { url: "https://www.facebook.com/v21.0/dialog/oauth?...", redirectUri: "" },
    }));
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Reconnect Facebook/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reconnect Facebook/ }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/facebook\.com\/v21\.0\/dialog\/oauth/);
  });
});

// ─── Click Funnel panel ──────────────────────────────────────────────────────
//
// Conversion tracking added 2026-05-31. The panel surfaces the comment→DM→click
// funnel from /api/automation/funnel. Only DMs that carried a {{link}} tracking
// link are measurable; the rule's targetUrl + {{link}} placeholder opt it in.

describe("AutoDmTab — Click Funnel panel", () => {
  it("renders the empty hint when no clicks are tracked yet", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText("Click Funnel")).toBeInTheDocument());
    expect(screen.getByText(/No tracked clicks yet/)).toBeInTheDocument();
  });

  it("shows overall CTR + per-rule rows when funnel data is present", async () => {
    setFetchHandler("GET", "/api/automation/rules", () => ({ body: { rules: [makeRule({ id: "rule-1", keyword: "COURSES" })] } }));
    setFetchHandler("GET", "/api/automation/funnel", () => ({
      body: {
        rules: [
          { ruleId: "rule-1", keyword: "COURSES", linksSent: 4, linksClicked: 3, totalClicks: 5, clickRate: 0.75, lastClickAt: "2026-05-30T10:00:00.000Z" },
        ],
        totals: { linksSent: 4, linksClicked: 3, totalClicks: 5, clickRate: 0.75 },
      },
    }));
    render(<AutoDmTab showMessage={() => {}} />);
    // 75% appears twice: the overall CTR badge + the single rule's own rate.
    await waitFor(() => expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(2));
    // Per-rule row shows the clicked/sent ratio.
    expect(screen.getByText(/3\/4 clicked/)).toBeInTheDocument();
    // Summary stats.
    expect(screen.getByText("Links sent")).toBeInTheDocument();
  });
});

// ─── Tracking link field (targetUrl + {{link}}) ──────────────────────────────

describe("AutoDmTab — tracking link", () => {
  it("submits targetUrl + a {{link}} template when the link is set up", async () => {
    let postedBody: Record<string, unknown> | null = null;
    setFetchHandler("POST", "/api/automation/rules", (_url, init) => {
      postedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return { status: 201, body: { ok: true, rule: makeRule() } };
    });

    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));

    fireEvent.change(screen.getByLabelText(/Keyword/), { target: { value: "GUIDE" } });
    fireEvent.change(screen.getByLabelText(/DM Template/), { target: { value: "Here you go: {{link}}" } });
    fireEvent.change(screen.getByLabelText(/Target URL/), { target: { value: "https://markusstoeger.substack.com/p/guide" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/ }));

    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody).toMatchObject({
      keyword: "GUIDE",
      dmTemplate: "Here you go: {{link}}",
      targetUrl: "https://markusstoeger.substack.com/p/guide",
    });
  });

  it("the {{link}} insert button appends the placeholder to the DM template", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));

    const template = screen.getByLabelText(/DM Template/) as HTMLTextAreaElement;
    fireEvent.change(template, { target: { value: "Here you go:" } });
    fireEvent.click(screen.getByRole("button", { name: /Insert tracking link placeholder/ }));
    expect(template.value).toBe("Here you go: {{link}}");
  });

  it("warns when {{link}} is present but no Target URL is set", async () => {
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));
    fireEvent.change(screen.getByLabelText(/DM Template/), { target: { value: "Broken {{link}}" } });
    expect(screen.getByText(/will be sent literally/)).toBeInTheDocument();
  });

  it("shows a '🔗 tracked' badge on a rule card with targetUrl + {{link}}", async () => {
    setFetchHandler("GET", "/api/automation/rules", () => ({
      body: { rules: [makeRule({ dmTemplate: "Tap: {{link}}", targetUrl: "https://markusstoeger.substack.com/p/x" })] },
    }));
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/tracked/)).toBeInTheDocument());
  });
});

// ─── Public reply combo (publicReply on AutoDmRule) ──────────────────────────

describe("AutoDmTab — public reply combo", () => {
  it("submits publicReply alongside the DM fields", async () => {
    let postedBody: Record<string, unknown> | null = null;
    setFetchHandler("POST", "/api/automation/rules", (_url, init) => {
      postedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return { status: 201, body: { ok: true, rule: makeRule() } };
    });

    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add new Auto-DM rule/ }));

    fireEvent.change(screen.getByLabelText(/Keyword/), { target: { value: "GUIDE" } });
    fireEvent.change(screen.getByLabelText(/DM Template/), { target: { value: "Sent!" } });
    fireEvent.change(screen.getByLabelText(/Public Reply/), { target: { value: "Just sent it 📩" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/ }));

    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody).toMatchObject({ keyword: "GUIDE", publicReply: "Just sent it 📩" });
  });

  it("shows a '💬 reply' badge + reply count on a rule card with publicReply", async () => {
    setFetchHandler("GET", "/api/automation/rules", () => ({
      body: { rules: [makeRule({ publicReply: "Sent 📩", publicReplyCount: 3 })] },
    }));
    render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/reply/)).toBeInTheDocument());
    expect(screen.getByText(/3 public replies/)).toBeInTheDocument();
  });
});

describe("AutoDmTab — a11y", () => {
  it("passes axe accessibility checks on initial render", async () => {
    const { container } = render(<AutoDmTab showMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Rules/)).toBeInTheDocument());
    const { axe } = await import("vitest-axe");
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });
});
