// Unit tests for the cookie normalizer. The function is a pure data-shape
// translation between the formats emitted by browser extensions (Cookie-Editor,
// EditThisCookie, Get-cookies-as-JSON) and the Playwright canonical cookie
// shape. We don't test the Playwright application here — that needs a live
// browser context and is covered by the e2e crawl flow.

import { describe, it, expect } from "vitest";
import { normalizeCookies } from "./browser-manager.js";

describe("normalizeCookies", () => {
  // Cookie-Editor (most common) exports objects with `expirationDate` (float),
  // `hostOnly`, `session`, `storeId`, etc. Only name/value/domain/path are
  // actually needed downstream.
  it("normalizes Cookie-Editor JSON shape", () => {
    const input = [
      {
        name: "sessionid",
        value: "abc123",
        domain: ".instagram.com",
        path: "/",
        expirationDate: 1781234567.123, // float seconds — must coerce to int
        httpOnly: true,
        secure: true,
        sameSite: "no_restriction", // Cookie-Editor's wording for None
        hostOnly: false,
        session: false,
        storeId: "0",
      },
    ];
    const { normalized, errors } = normalizeCookies(input);
    expect(errors).toEqual([]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      name: "sessionid",
      value: "abc123",
      domain: ".instagram.com",
      path: "/",
      expires: 1781234567, // floored
      httpOnly: true,
      secure: true,
      sameSite: "None", // canonicalized
    });
  });

  // EditThisCookie uses `expirationDate` and lowercase sameSite.
  // Coercion of sameSite to canonical capitalization is what we lock in.
  it("normalizes EditThisCookie shape with lowercase sameSite", () => {
    const input = [
      { name: "a", value: "b", domain: "x.com", path: "/", expirationDate: 999, sameSite: "lax" },
      { name: "c", value: "d", domain: "x.com", sameSite: "STRICT" },
    ];
    const { normalized } = normalizeCookies(input);
    expect(normalized.map((c) => c.sameSite)).toEqual(["Lax", "Strict"]);
  });

  // The Playwright-native shape uses `expires`. We must NOT clobber it just
  // because `expirationDate` is missing.
  it("preserves Playwright-native cookies untouched", () => {
    const input = [
      { name: "n", value: "v", domain: ".x.com", path: "/", expires: 1700000000, secure: true },
    ];
    const { normalized, errors } = normalizeCookies(input);
    expect(errors).toEqual([]);
    expect(normalized[0].expires).toBe(1700000000);
    expect(normalized[0].secure).toBe(true);
  });

  // Cookie without name OR value must be rejected with a clear error — these
  // come from Cookie-Editor when the user accidentally exports an empty slot.
  it("rejects entries missing name or value", () => {
    const { normalized, rejected, errors } = normalizeCookies([
      { value: "x", domain: ".y.com" }, // missing name
      { name: "x", domain: ".y.com" },  // missing value
      { name: "ok", value: "yes", domain: ".y.com" },
    ]);
    expect(normalized).toHaveLength(1);
    expect(rejected).toBe(2);
    expect(errors).toHaveLength(2);
  });

  // Without domain AND url, Playwright can't apply the cookie — must reject
  // to give the user a clear error instead of a confusing Playwright crash.
  it("rejects entries with no domain and no url", () => {
    const { normalized, errors } = normalizeCookies([
      { name: "x", value: "y" },
    ]);
    expect(normalized).toHaveLength(0);
    expect(errors[0]).toMatch(/neither domain nor url/);
  });

  // url-only is allowed (Playwright accepts either). Common when the export
  // tool lacks a clean domain-extraction step.
  it("allows url-only entries (no domain)", () => {
    const { normalized, errors } = normalizeCookies([
      { name: "x", value: "y", url: "https://instagram.com/" },
    ]);
    expect(errors).toEqual([]);
    expect(normalized[0].url).toBe("https://instagram.com/");
  });

  // Path defaults to "/" — covers extensions that omit it for top-level cookies.
  it("defaults missing path to /", () => {
    const { normalized } = normalizeCookies([{ name: "x", value: "y", domain: ".x.com" }]);
    expect(normalized[0].path).toBe("/");
  });

  // Defensive: non-array input must not crash, returns an error.
  it("returns an error for non-array input", () => {
    const { normalized, errors } = normalizeCookies({ name: "wrong shape" });
    expect(normalized).toEqual([]);
    expect(errors[0]).toMatch(/not an array/);
  });

  // Negative expires (already expired, or malformed) is silently dropped —
  // Playwright would reject the cookie outright otherwise.
  it("drops non-positive expires", () => {
    const { normalized } = normalizeCookies([
      { name: "x", value: "y", domain: ".x.com", expires: -5 },
      { name: "x", value: "y", domain: ".x.com", expires: 0 },
    ]);
    expect(normalized[0].expires).toBeUndefined();
    expect(normalized[1].expires).toBeUndefined();
  });
});
