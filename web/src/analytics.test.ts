// @vitest-environment jsdom
const posthogInitMock = vi.fn();
const posthogCaptureMock = vi.fn();
const posthogCaptureExceptionMock = vi.fn();
const posthogOptInMock = vi.fn();
const posthogOptOutMock = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: posthogInitMock,
    capture: posthogCaptureMock,
    captureException: posthogCaptureExceptionMock,
    opt_in_capturing: posthogOptInMock,
    opt_out_capturing: posthogOptOutMock,
  },
}));

describe("analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    localStorage.clear();
    posthogInitMock.mockReset();
    posthogCaptureMock.mockReset();
    posthogCaptureExceptionMock.mockReset();
    posthogOptInMock.mockReset();
    posthogOptOutMock.mockReset();
  });

  it("stays disabled without a PostHog key", async () => {
    // Validates that telemetry is a hard no-op unless a project key is configured.
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "");
    const mod = await import("./analytics.js");

    expect(mod.initAnalytics()).toBe(false);
    expect(mod.isAnalyticsEnabled()).toBe(false);
    mod.captureEvent("event");
    mod.captureException(new Error("boom"));

    expect(posthogInitMock).not.toHaveBeenCalled();
    expect(posthogCaptureMock).not.toHaveBeenCalled();
    expect(posthogCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("always returns false for HeyHank (self-hosted) even when key is configured", async () => {
    // Analytics module is now entirely no-op for self-hosted HeyHank.
    // Even with a PostHog key, initAnalytics returns false and no events are captured.
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
    const mod = await import("./analytics.js");

    expect(mod.initAnalytics()).toBe(false);
    expect(mod.isAnalyticsEnabled()).toBe(false);

    // PostHog should never be initialized for self-hosted
    expect(posthogInitMock).not.toHaveBeenCalled();

    mod.captureEvent("test_event", { foo: "bar" });
    mod.captureException(new Error("boom"), { source: "unit_test" });
    mod.capturePageView("#/settings");

    // All capture calls are no-ops
    expect(posthogCaptureMock).not.toHaveBeenCalled();
    expect(posthogCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("respects telemetry preference opt-out (always disabled for self-hosted)", async () => {
    // Even with a key and opt-out preference, everything is a no-op for self-hosted.
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    localStorage.setItem("cc-telemetry-enabled", "false");
    const mod = await import("./analytics.js");

    expect(mod.initAnalytics()).toBe(false);
    expect(mod.isAnalyticsEnabled()).toBe(false);
    // PostHog is never initialized, so opt-out is never called
    expect(posthogOptOutMock).not.toHaveBeenCalled();
    mod.captureEvent("test_event");
    expect(posthogCaptureMock).not.toHaveBeenCalled();
  });
});
