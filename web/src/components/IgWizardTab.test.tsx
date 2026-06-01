// @vitest-environment jsdom
//
// Tests for IgWizardTab. Mocks igWizardApi so we don't hit the real Claude API,
// and verifies: render, empty state, generate happy path, error path, copy
// interaction (with mocked clipboard), category switching, trigger-keyword
// extraction badge for Leads CTAs, and axe a11y.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IgWizardTab, extractTriggerWord } from "./IgWizardTab.js";

const axeRules = {
  rules: {
    "color-contrast": { enabled: false }, // Contrast is theme-driven, tested visually
  },
};

// Mock both API surfaces the component uses: wizard generation AND auto-DM
// rule creation. Tests override the resolved/rejected value per scenario.
const mockGenerate = vi.fn();
const mockCreateRule = vi.fn();
const mockCaption = vi.fn();
const mockPlan = vi.fn();
const mockComposeDraft = vi.fn();
const mockResearch = vi.fn();
// Wizard Saved Posts workbench (auto-save + curate).
const mockPostsList = vi.fn();
const mockPostsCreate = vi.fn();
const mockPostsUpdate = vi.fn();
const mockPostsRemove = vi.fn();
const mockPostsBulkRemove = vi.fn();
const mockPostsImage = vi.fn();
const mockPostsCarousel = vi.fn();
const mockPostsReel = vi.fn();
const mockPostsToDraft = vi.fn();
const mockPostsBulkToDraft = vi.fn();
vi.mock("../api.js", () => ({
  igWizardApi: {
    generate: (...args: unknown[]) => mockGenerate(...args),
    caption: (...args: unknown[]) => mockCaption(...args),
    research: (...args: unknown[]) => mockResearch(...args),
    plan: (...args: unknown[]) => mockPlan(...args),
    composeAndSaveDraft: (...args: unknown[]) => mockComposeDraft(...args),
    posts: {
      list: (...args: unknown[]) => mockPostsList(...args),
      create: (...args: unknown[]) => mockPostsCreate(...args),
      update: (...args: unknown[]) => mockPostsUpdate(...args),
      remove: (...args: unknown[]) => mockPostsRemove(...args),
      bulkRemove: (...args: unknown[]) => mockPostsBulkRemove(...args),
      generateImage: (...args: unknown[]) => mockPostsImage(...args),
      generateCarousel: (...args: unknown[]) => mockPostsCarousel(...args),
      generateReel: (...args: unknown[]) => mockPostsReel(...args),
      toDraft: (...args: unknown[]) => mockPostsToDraft(...args),
      bulkToDraft: (...args: unknown[]) => mockPostsBulkToDraft(...args),
    },
  },
  autoDmRulesApi: { create: (...args: unknown[]) => mockCreateRule(...args) },
}));

function makeWizardPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "wp-1",
    topic: "AI tools",
    hook: "AI wrote this in 3 minutes",
    body: "Here's the workflow.",
    cta: "Comment BUILD",
    hashtags: ["ai"],
    caption: "AI wrote this in 3 minutes\n\nHere's the workflow.\n\nComment BUILD\n\n#ai",
    platforms: ["instagram"],
    imageUrl: null,
    imageFilename: null,
    style: "cozy",
    source: "single",
    day: null,
    promotedDraftId: null,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

function samplePlan(overrides: Record<string, unknown> = {}) {
  return {
    topic: "AI tools",
    language: "en",
    model: "internal-ai",
    briefs: Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      angle: `Angle ${i + 1}`,
      hook: `Plan hook ${i + 1}`,
      ctaType: (i % 3 === 0 ? "lead" : i % 3 === 1 ? "engagement" : "growth") as "lead" | "engagement" | "growth",
    })),
    ...overrides,
  };
}

function sampleResult(overrides: Partial<{ language: string; niche: string }> = {}) {
  return {
    hooks: Array.from({ length: 20 }, (_, i) => `Hook ${i + 1}`),
    ctas: {
      engagement: Array.from({ length: 10 }, (_, i) => `Engagement ${i + 1}`),
      // Lead packages now include trigger + dmTemplate so the UI can build a
      // one-click Auto-DM rule. Mirror the production shape from
      // server/ig-wizard.ts LeadPackage.
      leads: [
        { cta: "Comment GUIDE to get my free PDF", trigger: "GUIDE", dmTemplate: "Here's your free PDF: [LINK]" },
        { cta: "DM LINK for the workflow template", trigger: "LINK", dmTemplate: "The workflow template is ready: [LINK]" },
        { cta: "Reply YES to my story for the trial", trigger: "YES", dmTemplate: "Awesome — here's your trial: [LINK]" },
        ...Array.from({ length: 7 }, (_, i) => ({
          cta: `Comment WORD${i + 4} for the guide`,
          trigger: `WORD${i + 4}`,
          dmTemplate: `Here's the guide you asked for ${i + 4}: [LINK]`,
        })),
      ],
      growth: Array.from({ length: 10 }, (_, i) => `Follow me for tip ${i + 1}`),
    },
    niche: "AI productivity",
    language: "en",
    model: "internal-ai",
    ...overrides,
  };
}

function sampleCaption(overrides: Record<string, unknown> = {}) {
  return {
    hook: "AI wrote this in 3 minutes",
    body: "Here's the workflow.\n\nNo fluff.",
    cta: "Comment BUILD for the template",
    hashtags: ["ai", "automation"],
    caption: "AI wrote this in 3 minutes\n\nHere's the workflow.\n\nNo fluff.\n\nComment BUILD for the template\n\n#ai #automation",
    language: "en",
    model: "internal-ai",
    ...overrides,
  };
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockCreateRule.mockReset();
  mockCaption.mockReset();
  mockResearch.mockReset();
  mockPlan.mockReset();
  mockComposeDraft.mockReset();
  mockPostsList.mockReset();
  mockPostsCreate.mockReset();
  mockPostsUpdate.mockReset();
  mockPostsRemove.mockReset();
  mockPostsBulkRemove.mockReset();
  mockPostsImage.mockReset();
  mockPostsCarousel.mockReset();
  mockPostsReel.mockReset();
  mockPostsToDraft.mockReset();
  mockPostsBulkToDraft.mockReset();
  // Sensible defaults: auto-save succeeds, list is empty.
  mockPostsCreate.mockResolvedValue({ ok: true, post: makeWizardPost() });
  mockPostsUpdate.mockResolvedValue(makeWizardPost());
  mockPostsList.mockResolvedValue({ posts: [] });
  // jsdom doesn't ship a clipboard impl by default. Provide one.
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe("IgWizardTab — empty state", () => {
  it("renders the niche input and Generate button", () => {
    render(<IgWizardTab showMessage={() => {}} />);
    expect(screen.getByLabelText(/^Niche$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate/i })).toBeInTheDocument();
  });

  it("shows guidance copy before any generation", () => {
    render(<IgWizardTab showMessage={() => {}} />);
    // The "Replaces hooksgenerator.ai" guidance copy should be visible — sanity
    // that the empty state actually rendered.
    expect(screen.getByText(/Replaces hooksgenerator.ai/i)).toBeInTheDocument();
  });

  it("disables Generate while a call is in-flight", async () => {
    // Make the mock return a promise that doesn't resolve yet so we can observe
    // the disabled intermediate state.
    let resolve: (v: unknown) => void = () => {};
    mockGenerate.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<IgWizardTab showMessage={() => {}} />);
    const input = screen.getByLabelText(/^Niche$/);
    fireEvent.change(input, { target: { value: "AI productivity" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    // Now it should be disabled and show "Generating…"
    await waitFor(() => {
      expect(screen.getByText(/Generating/i)).toBeInTheDocument();
    });
    // Resolve so the test can clean up
    resolve(sampleResult());
  });
});

describe("IgWizardTab — generate happy path", () => {
  it("renders 20 hooks and the leads tab is active by default", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "AI productivity" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

    await waitFor(() => {
      expect(screen.getByText(/^Hooks/)).toBeInTheDocument();
    });

    // 20 hooks rendered
    expect(screen.getByRole("button", { name: /Copy hook: Hook 1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy hook: Hook 20$/ })).toBeInTheDocument();

    // Leads tab is selected by default (it's the funnel-driving category)
    const leadsTab = screen.getByRole("tab", { name: /Leads/ });
    expect(leadsTab).toHaveAttribute("aria-selected", "true");

    // First Leads CTA visible
    expect(screen.getByRole("button", { name: /Copy CTA: Comment GUIDE/ })).toBeInTheDocument();
  });

  it("switches between CTA categories when tabs are clicked", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Engagement/ })).toBeInTheDocument());

    // Switch to engagement
    fireEvent.click(screen.getByRole("tab", { name: /Engagement/ }));
    expect(screen.getByRole("tab", { name: /Engagement/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Copy CTA: Engagement 1$/ })).toBeInTheDocument();
  });

  it("shows trigger-keyword badge for Leads CTAs", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy CTA: Comment GUIDE/ })).toBeInTheDocument());

    // The "GUIDE" trigger keyword should appear as a badge
    expect(screen.getByLabelText(/Trigger keyword: GUIDE/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Trigger keyword: LINK/)).toBeInTheDocument();
  });

  it("submits with Enter key while focused on niche", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);

    const input = screen.getByLabelText(/^Niche$/);
    fireEvent.change(input, { target: { value: "AI" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith("AI", "en"));
  });

  it("respects the language dropdown when generating", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult({ language: "de" }));
    render(<IgWizardTab showMessage={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Output language/i), { target: { value: "de" } });
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "Solo-Berater" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith("Solo-Berater", "de"));
  });
});

describe("IgWizardTab — copy interaction", () => {
  it("copies a hook to the clipboard when clicked", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    const msg = vi.fn();
    render(<IgWizardTab showMessage={msg} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy hook: Hook 1$/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Copy hook: Hook 1$/ }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hook 1"));
    expect(msg).toHaveBeenCalledWith(expect.stringMatching(/Copied hook/));
  });

  it("copies a CTA to the clipboard when clicked", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    const msg = vi.fn();
    render(<IgWizardTab showMessage={msg} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy CTA: Comment GUIDE/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Copy CTA: Comment GUIDE/ }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Comment GUIDE to get my free PDF"),
    );
  });
});

describe("IgWizardTab — error path", () => {
  it("renders an alert when generation fails", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("Claude rate limit"));
    const msg = vi.fn();
    render(<IgWizardTab showMessage={msg} />);

    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Claude rate limit/);
    });
    expect(msg).toHaveBeenCalledWith(expect.stringMatching(/Generate failed/), true);
  });
});

describe("IgWizardTab — a11y", () => {
  it("passes axe accessibility checks on initial empty state", async () => {
    const { container } = render(<IgWizardTab showMessage={() => {}} />);
    const { axe } = await import("vitest-axe");
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });

  it("passes axe accessibility checks after generating results", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    const { container } = render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByText(/^Hooks/)).toBeInTheDocument());
    const { axe } = await import("vitest-axe");
    const results = await axe(container, axeRules);
    expect(results).toHaveNoViolations();
  });
});

describe("extractTriggerWord", () => {
  it("extracts the ALL-CAPS keyword from a Comment-style CTA", () => {
    expect(extractTriggerWord("Comment GUIDE to get my PDF")).toBe("GUIDE");
    expect(extractTriggerWord("Comment 'PACK' for the workflow")).toBe("PACK");
    expect(extractTriggerWord("DM LINK for the trial")).toBe("LINK");
    expect(extractTriggerWord("Reply YES to my story")).toBe("YES");
    expect(extractTriggerWord("Tag a friend with COURSES")).toBe("COURSES");
  });

  it("returns null for CTAs with no ALL-CAPS keyword", () => {
    expect(extractTriggerWord("save this post if you love AI")).toBe(null);
    expect(extractTriggerWord("double tap if you agree")).toBe(null);
  });

  it("ignores standalone stop-words like 'DM' or 'AI' that are part of the verb", () => {
    // "DM me" — DM is the verb, not the trigger. Without a clear post-verb
    // ALL-CAPS word the function should return null (we don't want to suggest
    // "DM" as an auto-DM keyword).
    expect(extractTriggerWord("DM me your questions")).toBe(null);
  });
});

describe("IgWizardTab — Create Auto-DM Rule flow", () => {
  it("renders the DM template preview under each Lead CTA card", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByText(/Here's your free PDF/)).toBeInTheDocument());
    expect(screen.getByText(/The workflow template is ready/)).toBeInTheDocument();
  });

  it("renders a Create Auto-DM Rule button per Lead CTA that POSTs the package", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    mockCreateRule.mockResolvedValueOnce({ ok: true, rule: { id: "r1", platform: "instagram", keyword: "GUIDE", dmTemplate: "Here's your free PDF: [LINK]", enabled: true, sentCount: 0, createdAt: "", updatedAt: "" } });
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i }));

    await waitFor(() =>
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "instagram",
          keyword: "GUIDE",
          dmTemplate: "Here's your free PDF: [LINK]",
        }),
      ),
    );
  });

  it("swaps the Create button for a success badge after the rule is created", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    mockCreateRule.mockResolvedValueOnce({ ok: true, rule: { id: "r1", platform: "instagram", keyword: "GUIDE", dmTemplate: "x", enabled: true, sentCount: 0, createdAt: "", updatedAt: "" } });
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i }));

    // After success: button is gone (swapped for status badge), badge is visible
    await waitFor(() => expect(screen.getByLabelText(/^Rule created$/i)).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i }),
    ).not.toBeInTheDocument();
  });

  it("calls showMessage with error=true when create-rule fails", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    mockCreateRule.mockRejectedValueOnce(new Error("Meta secrets not configured"));
    const msg = vi.fn();
    render(<IgWizardTab showMessage={msg} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i }));

    await waitFor(() =>
      expect(msg).toHaveBeenCalledWith(expect.stringMatching(/Failed to create Auto-DM rule/), true),
    );
  });

  it("disables Create button while creating, so the user can't double-submit", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    // Hold the create call open so we observe the pending state.
    let resolveCreate: (v: unknown) => void = () => {};
    mockCreateRule.mockReturnValueOnce(new Promise((r) => { resolveCreate = r; }));
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i }));
    await waitFor(() => expect(screen.getByText(/Creating/i)).toBeInTheDocument());

    const btn = screen.getByRole("button", { name: /Create Auto-DM rule for trigger GUIDE/i });
    expect(btn).toBeDisabled();
    resolveCreate({ ok: true, rule: { id: "r1", platform: "instagram", keyword: "GUIDE", dmTemplate: "x", enabled: true, sentCount: 0, createdAt: "", updatedAt: "" } });
  });
});

// ─── Caption Composer ──────────────────────────────────────────────────────────

describe("IgWizardTab — Caption Composer", () => {
  async function generateFirst() {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "AI tools" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate/i }));
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());
  }

  it("composes a caption from the niche and renders it in a copyable box", async () => {
    await generateFirst();
    mockCaption.mockResolvedValueOnce(sampleCaption());

    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));

    await waitFor(() => expect(screen.getByLabelText(/Composed caption/i)).toBeInTheDocument());
    const box = screen.getByLabelText(/Composed caption/i) as HTMLTextAreaElement;
    expect(box.value).toContain("AI wrote this in 3 minutes");
    expect(box.value).toContain("#ai #automation");
    // The compose call received the niche as topic.
    expect(mockCaption).toHaveBeenCalledWith(expect.objectContaining({ topic: "AI tools" }));
  });

  it("'✍️ Use' on a hook fills the composer Hook field", async () => {
    await generateFirst();
    // Each hook row has a "Use" button; click the first.
    const useButtons = screen.getAllByRole("button", { name: /Use hook in caption composer/i });
    fireEvent.click(useButtons[0]);
    const hookField = screen.getByLabelText(/Hook \(optional\)/i) as HTMLInputElement;
    expect(hookField.value).toBe("Hook 1");
  });

  it("'✍️ Use' on a lead CTA fills the composer CTA field", async () => {
    await generateFirst();
    const useCtaButtons = screen.getAllByRole("button", { name: /Use this CTA in the caption composer/i });
    fireEvent.click(useCtaButtons[0]);
    const ctaField = screen.getByLabelText(/Lead CTA \(optional\)/i) as HTMLInputElement;
    expect(ctaField.value).toBe("Comment GUIDE to get my free PDF");
  });

  it("passes a manually entered hook + CTA to the compose call", async () => {
    await generateFirst();
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.change(screen.getByLabelText(/Hook \(optional\)/i), { target: { value: "My hook" } });
    fireEvent.change(screen.getByLabelText(/Lead CTA \(optional\)/i), { target: { value: "My CTA" } });
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() =>
      expect(mockCaption).toHaveBeenCalledWith(expect.objectContaining({ hook: "My hook", cta: "My CTA" })),
    );
  });
});

// ─── Research grounding ────────────────────────────────────────────────────────

function sampleBrief(overrides: Record<string, unknown> = {}) {
  return {
    topic: "AI tools",
    niche: "",
    language: "en",
    angles: ["Self-host Claude on a $5 box"],
    facts: [{ fact: "ZAYA1-8B runs ~760M active params", source: "https://example.com/z" }],
    freshItems: [{ headline: "Zyphra ships ZAYA1-8B", detail: "Apache 2.0 MoE", source: "https://example.com/z", date: "May 2026" }],
    painPoints: ["Vendor lock-in"],
    myths: ["You need a GPU farm"],
    hotDataPoint: "72.2% on SWE-bench from an open model",
    ownTakes: [],
    sources: ["https://example.com/z"],
    generatedAt: "2026-06-01T00:00:00Z",
    cached: false,
    ...overrides,
  };
}

describe("IgWizardTab — Research grounding", () => {
  async function generateFirst() {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "AI tools" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate/i }));
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());
  }

  it("shows the research panel with the auto-ground toggle on by default", async () => {
    await generateFirst();
    const auto = screen.getByLabelText(/Auto-research before composing/i) as HTMLInputElement;
    expect(auto.checked).toBe(true);
    expect(screen.getByRole("button", { name: /Research this topic now/i })).toBeInTheDocument();
  });

  it("🔬 Research now calls the research API and renders the brief", async () => {
    await generateFirst();
    mockResearch.mockResolvedValueOnce(sampleBrief());
    fireEvent.click(screen.getByRole("button", { name: /Research this topic now/i }));
    await waitFor(() => expect(screen.getByText(/Zyphra ships ZAYA1-8B/i)).toBeInTheDocument());
    expect(mockResearch).toHaveBeenCalledWith(expect.objectContaining({ topic: "AI tools" }));
    // The stat + content-brief disclosure render too.
    expect(screen.getByText(/SWE-bench/i)).toBeInTheDocument();
  });

  it("composes with a client-built grounding string once a brief is loaded (no second search)", async () => {
    await generateFirst();
    mockResearch.mockResolvedValueOnce(sampleBrief());
    fireEvent.click(screen.getByRole("button", { name: /Research this topic now/i }));
    await waitFor(() => expect(screen.getByText(/Zyphra ships ZAYA1-8B/i)).toBeInTheDocument());

    mockCaption.mockResolvedValueOnce(sampleCaption({ grounded: true }));
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(mockCaption).toHaveBeenCalled());
    const arg = mockCaption.mock.calls[0][0];
    expect(typeof arg.grounding).toBe("string");
    expect(arg.grounding).toMatch(/Zyphra ships ZAYA1-8B/);
    expect(arg.autoResearch).toBe(false); // grounding present → don't re-search
  });

  it("without a brief but auto-on, compose asks the backend to research inline", async () => {
    await generateFirst();
    mockCaption.mockResolvedValueOnce(sampleCaption({ grounded: true }));
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(mockCaption).toHaveBeenCalled());
    const arg = mockCaption.mock.calls[0][0];
    expect(arg.grounding).toBeUndefined();
    expect(arg.autoResearch).toBe(true);
  });

  it("renders the 🔬 grounded badge when the caption was grounded", async () => {
    await generateFirst();
    mockCaption.mockResolvedValueOnce(sampleCaption({ grounded: true }));
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(screen.getByText(/grounded in research/i)).toBeInTheDocument());
  });

  it("turning the auto toggle off composes ungrounded", async () => {
    await generateFirst();
    fireEvent.click(screen.getByLabelText(/Auto-research before composing/i));
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(mockCaption).toHaveBeenCalled());
    const arg = mockCaption.mock.calls[0][0];
    expect(arg.autoResearch).toBe(false);
    expect(arg.grounding).toBeUndefined();
  });
});

// ─── 30-Day Plan mode ────────────────────────────────────────────────────────

describe("IgWizardTab — 30-Day Plan mode", () => {
  async function generatePlan() {
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /30-Day Plan/i }));
    mockPlan.mockResolvedValueOnce(samplePlan());
    fireEvent.change(screen.getByLabelText(/^Topic$/), { target: { value: "AI tools" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 30-day plan/i }));
    // Hooks now render in editable inputs (one per day).
    await waitFor(() => expect(screen.getByLabelText(/Hook for day 1$/i)).toBeInTheDocument());
  }

  it("switches to plan mode and generates 30 editable-hook briefs", async () => {
    await generatePlan();
    expect((screen.getByLabelText(/Hook for day 1$/i) as HTMLInputElement).value).toBe("Plan hook 1");
    expect((screen.getByLabelText(/Hook for day 30$/i) as HTMLInputElement).value).toBe("Plan hook 30");
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ topic: "AI tools" }));
  });

  it("editing one day's hook does NOT clear the other days", async () => {
    await generatePlan();
    // Edit day 1's hook.
    fireEvent.change(screen.getByLabelText(/Hook for day 1$/i), { target: { value: "My edited hook" } });
    // Day 1 changed; days 2 + 30 are still present + unchanged.
    expect((screen.getByLabelText(/Hook for day 1$/i) as HTMLInputElement).value).toBe("My edited hook");
    expect((screen.getByLabelText(/Hook for day 2$/i) as HTMLInputElement).value).toBe("Plan hook 2");
    expect((screen.getByLabelText(/Hook for day 30$/i) as HTMLInputElement).value).toBe("Plan hook 30");
  });

  it("composing a day expands IN PLACE — the plan stays visible (no mode switch)", async () => {
    await generatePlan();
    mockCaption.mockResolvedValueOnce(sampleCaption());

    // Expand day 1, then compose its caption.
    fireEvent.click(screen.getByRole("button", { name: /Compose caption for day 1$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate caption for day 1$/i }));

    await waitFor(() => expect(screen.getByLabelText(/Composed caption for day 1$/i)).toBeInTheDocument());
    // Still in Plan mode: the other days are right there.
    expect(screen.getByLabelText(/Hook for day 2$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Hook for day 30$/i)).toBeInTheDocument();
    // The edited hook flowed into the caption call.
    expect(mockCaption).toHaveBeenCalledWith(expect.objectContaining({ topic: "AI tools", hook: "Plan hook 1" }));
  });

  it("auto-saves a composed day as a wizard post (source=plan, day)", async () => {
    await generatePlan();
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.click(screen.getByRole("button", { name: /Compose caption for day 1$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate caption for day 1$/i }));
    await waitFor(() => expect(screen.getByLabelText(/Composed caption for day 1$/i)).toBeInTheDocument());

    // The day auto-saved to the workbench with source=plan + the day number.
    expect(mockPostsCreate).toHaveBeenCalledWith(expect.objectContaining({ source: "plan", day: 1 }));
    // The "saved to your posts" confirmation shows.
    expect(screen.getByText(/✓ Saved to your posts/)).toBeInTheDocument();
  });

  it("shows the plan empty-state guidance before generating", async () => {
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /30-Day Plan/i }));
    expect(screen.getByText(/One topic → 30 distinct post ideas/)).toBeInTheDocument();
  });
});

// ─── Engagement / Growth CTA "Use" buttons ───────────────────────────────────

describe("IgWizardTab — Use on engagement/growth CTAs", () => {
  it("'✍️ Use' on an engagement CTA fills the composer CTA field", async () => {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate/i }));
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());

    // Switch to the Engagement CTA tab, then Use the first one.
    fireEvent.click(screen.getByRole("tab", { name: /Engagement/i }));
    const useButtons = screen.getAllByRole("button", { name: /Use CTA in caption composer/i });
    fireEvent.click(useButtons[0]);

    const ctaField = screen.getByLabelText(/Lead CTA \(optional\)/i) as HTMLInputElement;
    expect(ctaField.value).toBe("Engagement 1");
  });
});

// ─── Auto-save to the Saved Posts workbench ──────────────────────────────────

describe("IgWizardTab — auto-save on compose", () => {
  async function composeSingle() {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "self-hosting AI" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate/i }));
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(screen.getByLabelText(/Composed caption/i)).toBeInTheDocument());
  }

  it("auto-saves the composed caption as a single wizard post", async () => {
    await composeSingle();
    await waitFor(() =>
      expect(mockPostsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: "single", topic: "self-hosting AI", hook: "AI wrote this in 3 minutes" }),
      ),
    );
    // The "saved" confirmation + a link to Saved Posts appears.
    expect(screen.getByText(/✓ Saved to your posts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Saved Posts/i })).toBeInTheDocument();
  });

  it("Redo updates the same post instead of creating a duplicate", async () => {
    await composeSingle();
    await waitFor(() => expect(mockPostsCreate).toHaveBeenCalledTimes(1));
    // Redo (compose again) → updates the existing post.
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(mockPostsUpdate).toHaveBeenCalledWith("wp-1", expect.any(Object)));
    expect(mockPostsCreate).toHaveBeenCalledTimes(1); // still only one create
  });
});

// ─── Saved Posts workbench (list, delete, bulk, image, → Drafts) ─────────────

describe("IgWizardTab — Saved Posts workbench", () => {
  async function openSaved(posts: ReturnType<typeof makeWizardPost>[]) {
    mockPostsList.mockResolvedValue({ posts });
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Saved Posts/i }));
    await waitFor(() => expect(mockPostsList).toHaveBeenCalled());
  }

  it("lists persisted posts on open (restores across restarts)", async () => {
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" }), makeWizardPost({ id: "b", hook: "Post B" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    expect(screen.getByText("Post B")).toBeInTheDocument();
  });

  it("shows an empty state when there are no saved posts", async () => {
    await openSaved([]);
    await waitFor(() => expect(screen.getByText(/No saved posts yet/)).toBeInTheDocument());
  });

  it("deletes a single post", async () => {
    mockPostsRemove.mockResolvedValueOnce({ ok: true });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Delete Post A/i }));
    await waitFor(() => expect(mockPostsRemove).toHaveBeenCalledWith("a"));
  });

  it("bulk-deletes selected posts", async () => {
    mockPostsBulkRemove.mockResolvedValueOnce({ ok: true, removed: 2 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" }), makeWizardPost({ id: "b", hook: "Post B" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());

    // Select all, then bulk-delete.
    fireEvent.click(screen.getByLabelText(/Select all posts/i));
    fireEvent.click(screen.getByRole("button", { name: /Delete 2 selected posts/i }));
    await waitFor(() => expect(mockPostsBulkRemove).toHaveBeenCalledWith(["a", "b"]));
  });

  it("generates a branded image for a post", async () => {
    mockPostsImage.mockResolvedValueOnce({ ok: true, post: makeWizardPost({ id: "a", imageUrl: "/api/media/file/x.png" }), image: { url: "/api/media/file/x.png" } });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Generate image for Post A/i }));
    await waitFor(() => expect(mockPostsImage).toHaveBeenCalledWith("a", "notebook", "cozy", true));
  });

  it("changing the style dropdown passes the chosen style to image generation", async () => {
    mockPostsImage.mockResolvedValueOnce({ ok: true, post: makeWizardPost({ id: "a", style: "pointing", imageUrl: "/x.png" }), image: { url: "/x.png" } });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A", style: "cozy" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());

    // Switch the style to Pointing, then generate.
    fireEvent.change(screen.getByLabelText(/Image style for Post A/i), { target: { value: "pointing" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate image for Post A/i }));
    await waitFor(() => expect(mockPostsImage).toHaveBeenCalledWith("a", "notebook", "pointing", true));
  });

  it("defaults the style dropdown to the AI-suggested style", async () => {
    await openSaved([makeWizardPost({ id: "a", hook: "Post A", style: "business" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    expect((screen.getByLabelText(/Image style for Post A/i) as HTMLSelectElement).value).toBe("business");
  });

  it("generates a carousel with the chosen slide count + shows the format badge", async () => {
    mockPostsCarousel.mockResolvedValueOnce({
      ok: true,
      post: makeWizardPost({ id: "a", format: "carousel", mediaUrls: ["/m/1.png", "/m/2.png", "/m/3.png", "/m/4.png", "/m/5.png"] }),
      slides: [], mediaUrls: ["/m/1.png", "/m/2.png", "/m/3.png", "/m/4.png", "/m/5.png"],
    });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());

    // Default slide count is 5.
    fireEvent.click(screen.getByRole("button", { name: /Generate carousel for Post A/i }));
    await waitFor(() => expect(mockPostsCarousel).toHaveBeenCalledWith("a", 5, "notebook", "cozy", true));
    // After generation both the format badge AND the button read "🎠 Carousel"
    // (before, only the button existed) — proving the badge was added.
    await waitFor(() => expect(screen.getAllByText(/🎠 Carousel/).length).toBeGreaterThanOrEqual(2));
  });

  it("generates a reel (Veo + voiceover) + shows the Reel badge", async () => {
    mockPostsReel.mockResolvedValueOnce({ ok: true, post: makeWizardPost({ id: "a", format: "reel", videoUrl: "/api/media/file/r.mp4" }), videoUrl: "/api/media/file/r.mp4" });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Generate reel for Post A/i }));
    await waitFor(() => expect(mockPostsReel).toHaveBeenCalledWith("a", 8));
    // Badge + button both read "🎬 Reel" after generation (only the button before).
    await waitFor(() => expect(screen.getAllByText(/🎬 Reel/).length).toBeGreaterThanOrEqual(2));
  });

  it("promotes a post to Drafts", async () => {
    mockPostsToDraft.mockResolvedValueOnce({ ok: true, draft: { id: "d1" }, post: makeWizardPost({ id: "a", promotedDraftId: "d1" }) });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Send Post A to Drafts/i }));
    await waitFor(() => expect(mockPostsToDraft).toHaveBeenCalledWith("a"));
    // The "in Drafts" badge shows after promotion.
    await waitFor(() => expect(screen.getByText(/in Drafts/i)).toBeInTheDocument());
  });

  it("bulk-sends selected posts to Drafts", async () => {
    mockPostsBulkToDraft.mockResolvedValueOnce({ ok: true, promoted: 2, results: [{ id: "a", ok: true, draftId: "d1" }, { id: "b", ok: true, draftId: "d2" }] });
    await openSaved([makeWizardPost({ id: "a", hook: "Post A" }), makeWizardPost({ id: "b", hook: "Post B" })]);
    await waitFor(() => expect(screen.getByText("Post A")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Select all posts/i));
    fireEvent.click(screen.getByRole("button", { name: /Send 2 selected posts to Drafts/i }));
    await waitFor(() => expect(mockPostsBulkToDraft).toHaveBeenCalledWith(["a", "b"]));
    // Both flip to "in Drafts".
    await waitFor(() => expect(screen.getAllByText(/in Drafts/i).length).toBe(2));
  });
});
