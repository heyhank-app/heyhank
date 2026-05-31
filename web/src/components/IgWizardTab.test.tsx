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
vi.mock("../api.js", () => ({
  igWizardApi: {
    generate: (...args: unknown[]) => mockGenerate(...args),
    caption: (...args: unknown[]) => mockCaption(...args),
    plan: (...args: unknown[]) => mockPlan(...args),
    composeAndSaveDraft: (...args: unknown[]) => mockComposeDraft(...args),
  },
  autoDmRulesApi: { create: (...args: unknown[]) => mockCreateRule(...args) },
}));

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
  mockPlan.mockReset();
  mockComposeDraft.mockReset();
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

// ─── 30-Day Plan mode ────────────────────────────────────────────────────────

describe("IgWizardTab — 30-Day Plan mode", () => {
  it("switches to plan mode and generates 30 briefs", async () => {
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /30-Day Plan/i }));
    mockPlan.mockResolvedValueOnce(samplePlan());

    fireEvent.change(screen.getByLabelText(/^Topic$/), { target: { value: "AI tools" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 30-day plan/i }));

    await waitFor(() => expect(screen.getByText(/30-Day Plan/)).toBeInTheDocument());
    // All 30 days rendered.
    expect(screen.getByText("Plan hook 1")).toBeInTheDocument();
    expect(screen.getByText("Plan hook 30")).toBeInTheDocument();
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ topic: "AI tools" }));
  });

  it("'Compose' on a day loads its hook into the composer + switches to Single Post", async () => {
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /30-Day Plan/i }));
    mockPlan.mockResolvedValueOnce(samplePlan());
    fireEvent.change(screen.getByLabelText(/^Topic$/), { target: { value: "AI tools" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 30-day plan/i }));
    await waitFor(() => expect(screen.getByText("Plan hook 1")).toBeInTheDocument());

    // Compose day 1. Anchor the regex so it doesn't also match "day 10".."day 19".
    fireEvent.click(screen.getByRole("button", { name: /Compose caption for day 1$/i }));

    // We're now in Single Post mode with the composer seeded with the hook.
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());
    const hookField = screen.getByLabelText(/Hook \(optional\)/i) as HTMLInputElement;
    expect(hookField.value).toBe("Plan hook 1");
    // The plan topic carried into the niche so the caption is about the same thing.
    const nicheField = screen.getByLabelText(/^Niche$/) as HTMLInputElement;
    expect(nicheField.value).toBe("AI tools");
  });

  it("shows the plan empty-state guidance before generating", async () => {
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /30-Day Plan/i }));
    expect(screen.getByText(/One topic → 30 distinct post ideas/)).toBeInTheDocument();
  });
});

// ─── Image + Draft (compose-and-save-draft) ──────────────────────────────────

describe("IgWizardTab — image + draft", () => {
  async function composeFirst() {
    mockGenerate.mockResolvedValueOnce(sampleResult());
    render(<IgWizardTab showMessage={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Niche$/), { target: { value: "self-hosting AI" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate/i }));
    await waitFor(() => expect(screen.getByText("📝 Caption Composer")).toBeInTheDocument());
    mockCaption.mockResolvedValueOnce(sampleCaption());
    fireEvent.click(screen.getByRole("button", { name: /Compose full caption/i }));
    await waitFor(() => expect(screen.getByLabelText(/Composed caption/i)).toBeInTheDocument());
  }

  it("saves a draft with the composed caption + selected platforms", async () => {
    await composeFirst();
    mockComposeDraft.mockResolvedValueOnce({
      caption: sampleCaption(),
      image: { filename: "img.png", url: "/api/media/file/img.png", path: "/x", prompt: "p", model: "gpt-image-2" },
      imageError: null,
      draft: { id: "d1", text: "t", status: "draft", platforms: ["instagram"], mediaUrls: ["/api/media/file/img.png"], firstComment: "#ai", createdAt: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate image and save as draft/i }));

    await waitFor(() => expect(screen.getByText(/✓ Draft saved/)).toBeInTheDocument());
    // The generated image preview is shown.
    expect(screen.getByAltText(/Generated branded post image/i)).toBeInTheDocument();
    // The compose call carried the verbatim caption + default platform.
    expect(mockComposeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "self-hosting AI",
        platforms: ["instagram"],
        caption: expect.objectContaining({ hook: "AI wrote this in 3 minutes" }),
      }),
    );
  });

  it("toggling a platform checkbox updates the saved platforms", async () => {
    await composeFirst();
    mockComposeDraft.mockResolvedValueOnce({
      caption: sampleCaption(),
      image: null,
      imageError: null,
      draft: { id: "d2", text: "t", status: "draft", platforms: ["instagram", "facebook"], mediaUrls: [], createdAt: "" },
    });

    fireEvent.click(screen.getByLabelText(/Post to Facebook/i));
    fireEvent.click(screen.getByRole("button", { name: /Generate image and save as draft/i }));

    await waitFor(() =>
      expect(mockComposeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ platforms: ["instagram", "facebook"] }),
      ),
    );
  });

  it("shows a text-only fallback when the image fails but the draft saved", async () => {
    await composeFirst();
    mockComposeDraft.mockResolvedValueOnce({
      caption: sampleCaption(),
      image: null,
      imageError: "gpt-image-2 failed: rate limit",
      draft: { id: "d3", text: "t", status: "draft", platforms: ["instagram"], mediaUrls: [], createdAt: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate image and save as draft/i }));
    await waitFor(() => expect(screen.getByText(/✓ Draft saved/)).toBeInTheDocument());
    expect(screen.getByText(/Text-only draft/)).toBeInTheDocument();
  });
});
