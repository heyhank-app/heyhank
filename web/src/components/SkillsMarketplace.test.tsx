// @vitest-environment jsdom
/**
 * Tests for SkillsMarketplace component.
 *
 * SkillsMarketplace lets users browse skills from configured GitHub-based
 * marketplace sources and install/update/uninstall them. Skills are stored
 * under ~/.claude/skills/<slug>/ and consumed by Claude Code.
 *
 * Coverage targets:
 * - Render test + axe accessibility scan in default state.
 * - Source tabs are rendered and switching between sources triggers refetch.
 * - Search filter narrows the displayed skill list (slug/name/description).
 * - Install button calls the marketplace install API and refreshes the
 *   installed-skills list afterwards.
 * - Already-installed skills show "Installed" badge + Update/Uninstall
 *   actions instead of Install. Uninstall confirms via window.confirm.
 * - When the GitHub-backed list endpoint fails, an error banner is shown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── API Mocks ─────────────────────────────────────────────────
const mockMarketplaceListSources = vi.fn();
const mockMarketplaceListSkills = vi.fn();
const mockMarketplaceInstall = vi.fn();
const mockListSkills = vi.fn();
const mockDeleteSkill = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    marketplaceListSources: (...args: unknown[]) => mockMarketplaceListSources(...args),
    marketplaceListSkills: (...args: unknown[]) => mockMarketplaceListSkills(...args),
    marketplaceInstall: (...args: unknown[]) => mockMarketplaceInstall(...args),
    listSkills: (...args: unknown[]) => mockListSkills(...args),
    deleteSkill: (...args: unknown[]) => mockDeleteSkill(...args),
  },
}));

import { SkillsMarketplace } from "./SkillsMarketplace.js";

const SOURCE = {
  id: "charlie947-social-media-skills",
  name: "Charlie Hills' Social Media Skills",
  owner: "Charlie Hills",
  url: "https://github.com/charlie947/social-media-skills",
  description: "17 social media skills",
};

const SKILL_A = {
  slug: "post-writer",
  name: "Post Writer",
  description: "Writes LinkedIn posts",
  sourceId: SOURCE.id,
};

const SKILL_B = {
  slug: "voice-builder",
  name: "Voice Builder",
  description: "Builds your authentic brand voice",
  sourceId: SOURCE.id,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMarketplaceListSources.mockResolvedValue([SOURCE]);
  mockMarketplaceListSkills.mockResolvedValue([SKILL_A, SKILL_B]);
  mockMarketplaceInstall.mockResolvedValue({
    ok: true,
    slug: SKILL_A.slug,
    path: `/root/.claude/skills/${SKILL_A.slug}`,
  });
  mockListSkills.mockResolvedValue([]);
  mockDeleteSkill.mockResolvedValue({ ok: true, slug: SKILL_A.slug });
});

describe("SkillsMarketplace render & accessibility", () => {
  it("renders heading + skills and passes an axe accessibility scan", async () => {
    // Validates the component mounts with no a11y violations and renders
    // the loaded skills in the default state. With a single configured
    // source the source picker card is intentionally hidden — see
    // showSourcePicker in SkillsMarketplace.tsx.
    const { axe } = await import("vitest-axe");
    const { container } = render(<SkillsMarketplace embedded />);
    await screen.findByRole("heading", { name: /^Skills$/i });
    await screen.findByText(SKILL_A.name);
    await screen.findByText(SKILL_B.name);
    // Single source: no source picker card should be rendered.
    expect(screen.queryByText(SOURCE.name)).not.toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("shows the source picker when more than one source is configured", async () => {
    // With multiple sources the picker card is rendered so users can switch.
    const SECOND_SOURCE = {
      id: "another-source",
      name: "Another Source",
      owner: "Someone Else",
      url: "https://github.com/example/skills",
      description: "Another marketplace",
    };
    mockMarketplaceListSources.mockResolvedValueOnce([SOURCE, SECOND_SOURCE]);
    render(<SkillsMarketplace embedded />);
    await screen.findByText(SOURCE.name);
    expect(screen.getByText(SECOND_SOURCE.name)).toBeInTheDocument();
  });
});

describe("SkillsMarketplace behavior", () => {
  it("loads sources and the active source's skills on mount", async () => {
    // The first source returned should be auto-selected and its skills
    // fetched immediately.
    render(<SkillsMarketplace embedded />);
    await waitFor(() => {
      expect(mockMarketplaceListSources).toHaveBeenCalledTimes(1);
      expect(mockListSkills).toHaveBeenCalledTimes(1);
      expect(mockMarketplaceListSkills).toHaveBeenCalledWith(SOURCE.id);
    });
  });

  it("filters skills via the search box (matches slug/name/description)", async () => {
    // Typing in the search input narrows the visible skill list.
    render(<SkillsMarketplace embedded />);
    await screen.findByText(SKILL_A.name);
    await screen.findByText(SKILL_B.name);

    const searchInput = screen.getByPlaceholderText(/Search skills/i);
    fireEvent.change(searchInput, { target: { value: "voice" } });

    await waitFor(() => {
      expect(screen.queryByText(SKILL_A.name)).not.toBeInTheDocument();
    });
    expect(screen.getByText(SKILL_B.name)).toBeInTheDocument();
  });

  it("installs an uninstalled skill and refreshes the installed list", async () => {
    // Clicking Install calls the marketplace install API with the active
    // source id + slug, then re-fetches installed skills so the badge flips.
    render(<SkillsMarketplace embedded />);
    // Wait for skills to load — there are two skills, so two Install buttons.
    await screen.findByText(SKILL_A.name);
    const installButtons = await screen.findAllByRole("button", { name: /^Install$/i });
    expect(installButtons).toHaveLength(2);

    // After install, listSkills is called again — this time it returns the
    // newly installed skill so the row should show "Installed".
    mockListSkills.mockResolvedValueOnce([
      { slug: SKILL_A.slug, name: SKILL_A.name, description: SKILL_A.description, path: "/p" },
    ]);

    fireEvent.click(installButtons[0]);

    await waitFor(() => {
      expect(mockMarketplaceInstall).toHaveBeenCalledWith(SOURCE.id, SKILL_A.slug, false);
    });
    await waitFor(() => {
      expect(mockListSkills).toHaveBeenCalledTimes(2);
    });
    // The green "Installed" status badge appears next to the skill row.
    // Use exact match to avoid clashing with the "Installed (N)" tab button.
    await screen.findByText("Installed");
  });

  it("shows Update + Uninstall actions for already-installed skills", async () => {
    // When a skill is already in the local installed list, the row should
    // not offer "Install" — only "Update" (re-install with overwrite) and
    // "Uninstall".
    mockListSkills.mockResolvedValueOnce([
      { slug: SKILL_A.slug, name: SKILL_A.name, description: SKILL_A.description, path: "/p" },
    ]);
    render(<SkillsMarketplace embedded />);
    await screen.findByText(SKILL_A.name);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Update$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Uninstall$/i })).toBeInTheDocument();
    });
  });

  it("uninstalls a skill after window.confirm approval", async () => {
    // The uninstall flow MUST be guarded by window.confirm to prevent
    // accidental deletion of installed skill folders.
    mockListSkills.mockResolvedValueOnce([
      { slug: SKILL_A.slug, name: SKILL_A.name, description: SKILL_A.description, path: "/p" },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SkillsMarketplace embedded />);
    const uninstallBtn = await screen.findByRole("button", { name: /^Uninstall$/i });

    // After uninstall, listSkills returns empty list so the row should flip
    // back to "Install".
    mockListSkills.mockResolvedValueOnce([]);

    fireEvent.click(uninstallBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(mockDeleteSkill).toHaveBeenCalledWith(SKILL_A.slug);
    });
    confirmSpy.mockRestore();
  });

  it("Installed tab shows every locally-installed skill regardless of source", async () => {
    // The Installed tab lists all skills under ~/.claude/skills/, including
    // ones that didn't come from a configured marketplace source. This is
    // the user's single pane of glass for managing installations.
    const FOREIGN_SKILL = {
      slug: "manual-skill",
      name: "Manual Skill",
      description: "Installed manually, not from any source",
      path: "/root/.claude/skills/manual-skill",
    };
    mockListSkills.mockResolvedValueOnce([
      { slug: SKILL_A.slug, name: SKILL_A.name, description: SKILL_A.description, path: "/p" },
      FOREIGN_SKILL,
    ]);
    render(<SkillsMarketplace embedded />);
    await screen.findByText(SKILL_A.name);

    // Switch to Installed tab.
    fireEvent.click(screen.getByRole("tab", { name: /^Installed/i }));

    expect(screen.getByText(FOREIGN_SKILL.name)).toBeInTheDocument();
    expect(screen.getByText(FOREIGN_SKILL.path)).toBeInTheDocument();
    // Available skills that are NOT installed should not appear here.
    expect(screen.queryByText(SKILL_B.name)).not.toBeInTheDocument();
  });

  it("shows an error banner when the marketplace skills endpoint fails", async () => {
    // Failures from the GitHub-backed listing endpoint must be surfaced
    // visibly so the user can retry / pick a different source.
    mockMarketplaceListSkills.mockRejectedValueOnce(new Error("GitHub API 502"));
    render(<SkillsMarketplace embedded />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/GitHub API 502/);
  });
});
