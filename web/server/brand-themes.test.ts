import { describe, it, expect } from "vitest";
import { BRAND_THEMES, getTheme, resolveBrandSlug } from "./brand-themes.js";

describe("brand-themes", () => {
  describe("BRAND_THEMES registry", () => {
    it("contains neutral as fallback theme", () => {
      expect(BRAND_THEMES.neutral).toBeDefined();
      expect(BRAND_THEMES.neutral.slug).toBe("neutral");
    });

    it("includes core AI tool themes", () => {
      // Sanity that the registry actually carries the brands the user works with.
      for (const slug of ["claude", "openai", "gemini", "notion", "linear", "cursor"]) {
        expect(BRAND_THEMES[slug]).toBeDefined();
        expect(BRAND_THEMES[slug].slug).toBe(slug);
      }
    });

    it("uses #RRGGBB hex format for all colour fields", () => {
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;
      for (const theme of Object.values(BRAND_THEMES)) {
        expect(theme.bg).toMatch(hexPattern);
        expect(theme.headline).toMatch(hexPattern);
        expect(theme.accent).toMatch(hexPattern);
        expect(theme.badgeBg).toMatch(hexPattern);
        expect(theme.badgeText).toMatch(hexPattern);
        expect(theme.body).toMatch(hexPattern);
      }
    });
  });

  describe("resolveBrandSlug()", () => {
    it("returns 'neutral' for topics without a known brand token", () => {
      expect(resolveBrandSlug("10 AI image prompts you have to learn in 2026")).toBe("neutral");
      expect(resolveBrandSlug("")).toBe("neutral");
      expect(resolveBrandSlug("random gibberish text")).toBe("neutral");
    });

    it("matches canonical brand names case-insensitively", () => {
      expect(resolveBrandSlug("10 Claude Skills you need")).toBe("claude");
      expect(resolveBrandSlug("CLAUDE Code tricks")).toBe("claude");
      expect(resolveBrandSlug("Best Notion templates 2026")).toBe("notion");
    });

    it("maps known aliases to their canonical slug", () => {
      expect(resolveBrandSlug("ChatGPT prompts for builders")).toBe("openai");
      expect(resolveBrandSlug("GPT-5 system prompt tricks")).toBe("openai");
      expect(resolveBrandSlug("DALL-E image quality test")).toBe("openai");
      expect(resolveBrandSlug("Sonnet vs Opus")).toBe("claude");
      expect(resolveBrandSlug("Anthropic released a new model")).toBe("claude");
    });

    it("picks the longer alias when multiple match (avoids false positives)", () => {
      // "github copilot" should beat plain "copilot" if both were aliased the same.
      // More importantly, this guards against single-letter or sub-word collisions.
      expect(resolveBrandSlug("Github Copilot vs Cursor comparison")).toBe("copilot");
    });
  });

  describe("getTheme()", () => {
    it("returns the requested theme by slug", () => {
      const claude = getTheme("claude");
      expect(claude.slug).toBe("claude");
      expect(claude.accent).toBe("#D97757");
    });

    it("falls back to 'neutral' on unknown slug", () => {
      const theme = getTheme("nonexistent-brand-xyz");
      expect(theme.slug).toBe("neutral");
    });
  });
});
