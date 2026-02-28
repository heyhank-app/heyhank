import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock settings-manager to control updateChannel
const mockGetSettings = vi.fn(() => ({
  updateChannel: "stable" as "stable" | "prerelease",
}));
vi.mock("./settings-manager.js", () => ({
  getSettings: () => mockGetSettings(),
}));

let checker: typeof import("./update-checker.js");

beforeEach(async () => {
  vi.resetModules();
  mockFetch.mockReset();
  mockGetSettings.mockReturnValue({ updateChannel: "stable" });
  checker = await import("./update-checker.js");
});

afterEach(() => {
  checker.stopPeriodicCheck();
});

// ===========================================================================
// isNewerVersion — stable versions
// ===========================================================================
describe("isNewerVersion", () => {
  it("returns true when major version is higher", () => {
    expect(checker.isNewerVersion("2.0.0", "1.0.0")).toBe(true);
  });

  it("returns true when minor version is higher", () => {
    expect(checker.isNewerVersion("1.1.0", "1.0.0")).toBe(true);
  });

  it("returns true when patch version is higher", () => {
    expect(checker.isNewerVersion("1.0.1", "1.0.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(checker.isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns false when version is lower", () => {
    expect(checker.isNewerVersion("1.0.0", "1.0.1")).toBe(false);
    expect(checker.isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  });
});

// ===========================================================================
// isNewerVersion — prerelease versions
// ===========================================================================
describe("isNewerVersion (prerelease)", () => {
  // Stable release is newer than prerelease of the same core version
  it("stable is newer than prerelease of same core version", () => {
    expect(checker.isNewerVersion("1.0.0", "1.0.0-preview.1")).toBe(true);
  });

  // Prerelease is older than stable of the same core version
  it("prerelease is older than stable of same core version", () => {
    expect(checker.isNewerVersion("1.0.0-preview.1", "1.0.0")).toBe(false);
  });

  // Higher core version prerelease is newer than lower core stable
  it("higher core prerelease is newer than lower core stable", () => {
    expect(checker.isNewerVersion("1.1.0-preview.1", "1.0.0")).toBe(true);
  });

  // Later prerelease of same core is newer
  it("later prerelease of same core is newer", () => {
    expect(checker.isNewerVersion("1.0.0-preview.2", "1.0.0-preview.1")).toBe(true);
  });

  // Earlier prerelease of same core is older
  it("earlier prerelease of same core is older", () => {
    expect(checker.isNewerVersion("1.0.0-preview.1", "1.0.0-preview.2")).toBe(false);
  });

  // Handles timestamp-based prerelease identifiers
  it("compares timestamp-based prerelease identifiers correctly", () => {
    expect(checker.isNewerVersion(
      "0.66.0-preview.20260228140000.abc1234",
      "0.66.0-preview.20260228120000.def5678",
    )).toBe(true);
  });

  // Equal prerelease versions
  it("returns false for equal prerelease versions", () => {
    expect(checker.isNewerVersion("1.0.0-preview.1", "1.0.0-preview.1")).toBe(false);
  });

  // Alphanumeric prerelease identifiers compared lexically
  it("compares alphanumeric prerelease identifiers lexically", () => {
    expect(checker.isNewerVersion("1.0.0-beta.1", "1.0.0-alpha.1")).toBe(true);
    expect(checker.isNewerVersion("1.0.0-alpha.1", "1.0.0-beta.1")).toBe(false);
  });
});

// ===========================================================================
// getCurrentVersion
// ===========================================================================
describe("getCurrentVersion", () => {
  it("returns a semver string", () => {
    const version = checker.getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ===========================================================================
// getUpdateState
// ===========================================================================
describe("getUpdateState", () => {
  it("returns initial state with current version and no latest version", () => {
    const state = checker.getUpdateState();
    expect(state.currentVersion).toBe(checker.getCurrentVersion());
    expect(state.latestVersion).toBeNull();
    expect(state.isServiceMode).toBe(false);
    expect(state.checking).toBe(false);
    expect(state.updateInProgress).toBe(false);
    expect(state.channel).toBe("stable");
  });
});

// ===========================================================================
// checkForUpdate
// ===========================================================================
describe("checkForUpdate", () => {
  it("fetches from stable dist-tag by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: "99.0.0" }),
    });

    await checker.checkForUpdate();

    // Should use /latest for stable channel
    expect(mockFetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/the-companion/latest",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
    const state = checker.getUpdateState();
    expect(state.latestVersion).toBe("99.0.0");
    expect(state.lastChecked).toBeGreaterThan(0);
    expect(state.channel).toBe("stable");
  });

  it("fetches from next dist-tag when channel is prerelease", async () => {
    mockGetSettings.mockReturnValue({ updateChannel: "prerelease" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: "99.0.0-preview.1" }),
    });

    await checker.checkForUpdate();

    // Should use /next for prerelease channel
    expect(mockFetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/the-companion/next",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
    const state = checker.getUpdateState();
    expect(state.latestVersion).toBe("99.0.0-preview.1");
    expect(state.channel).toBe("prerelease");
  });

  // When switching channels, the previous channel's latestVersion must be
  // cleared to avoid cross-channel stale comparisons.
  it("clears latestVersion when channel changes to avoid stale comparison", async () => {
    // First check on stable channel sets a latestVersion
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: "99.0.0" }),
    });
    await checker.checkForUpdate();
    expect(checker.getUpdateState().latestVersion).toBe("99.0.0");

    // Switch to prerelease but fetch fails
    mockGetSettings.mockReturnValue({ updateChannel: "prerelease" });
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    await checker.checkForUpdate();

    // latestVersion should be null (not the stale stable version)
    const state = checker.getUpdateState();
    expect(state.latestVersion).toBeNull();
    expect(state.channel).toBe("prerelease");
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await checker.checkForUpdate();

    const state = checker.getUpdateState();
    expect(state.latestVersion).toBeNull();
  });

  it("handles non-ok response gracefully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await checker.checkForUpdate();

    const state = checker.getUpdateState();
    expect(state.latestVersion).toBeNull();
  });
});

// ===========================================================================
// isUpdateAvailable
// ===========================================================================
describe("isUpdateAvailable", () => {
  it("returns false when no latest version is set", () => {
    expect(checker.isUpdateAvailable()).toBe(false);
  });

  it("returns true when latest is newer than current", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: "99.0.0" }),
    });

    await checker.checkForUpdate();
    expect(checker.isUpdateAvailable()).toBe(true);
  });

  it("returns false when latest equals current", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: checker.getCurrentVersion() }),
    });

    await checker.checkForUpdate();
    expect(checker.isUpdateAvailable()).toBe(false);
  });
});

// ===========================================================================
// setServiceMode / setUpdateInProgress
// ===========================================================================
describe("state setters", () => {
  it("setServiceMode updates isServiceMode", () => {
    checker.setServiceMode(true);
    expect(checker.getUpdateState().isServiceMode).toBe(true);
    checker.setServiceMode(false);
    expect(checker.getUpdateState().isServiceMode).toBe(false);
  });

  it("setUpdateInProgress updates updateInProgress", () => {
    checker.setUpdateInProgress(true);
    expect(checker.getUpdateState().updateInProgress).toBe(true);
    checker.setUpdateInProgress(false);
    expect(checker.getUpdateState().updateInProgress).toBe(false);
  });
});
