import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FlyMachinesClient } from "./fly-machines";

/**
 * Tests for FlyMachinesClient — a thin wrapper around the Fly Machines REST API.
 *
 * Strategy: mock global.fetch to verify that each method sends the correct
 * HTTP method, URL, headers, and body, and that it properly handles success
 * and error responses.
 */

const TEST_TOKEN = "fly-test-token-abc123";
const TEST_APP = "my-fly-app";
const BASE = `https://api.machines.dev/v1/apps/${TEST_APP}`;

/** Helper: build a minimal FlyMachine-shaped object for mock responses. */
function fakeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: "machine-1",
    name: "test-machine",
    state: "started",
    region: "iad",
    instance_id: "inst-1",
    private_ip: "fdaa::1",
    config: {
      image: "registry.fly.io/my-app:latest",
      guest: { cpus: 1, memory_mb: 256, cpu_kind: "shared" },
      env: {},
      services: [],
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Helper: create a mock Response that resolves .json() to the given data. */
function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

/** Helper: create a mock non-ok Response. */
function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("FlyMachinesClient", () => {
  let client: FlyMachinesClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new FlyMachinesClient(TEST_TOKEN, TEST_APP);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── createMachine ────────────────────────────────────────────────────

  describe("createMachine", () => {
    it("sends POST to /machines with auth header and body, returns parsed response", async () => {
      const input = {
        region: "iad",
        config: {
          image: "registry.fly.io/my-app:latest",
          guest: { cpus: 1, memory_mb: 256, cpu_kind: "shared" as const },
          env: { NODE_ENV: "production" },
          services: [],
        },
      };
      const expected = fakeMachine({ state: "created" });
      fetchMock.mockResolvedValueOnce(okResponse(expected));

      const result = await client.createMachine(input);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(opts.body)).toEqual(input);
      expect(result).toEqual(expected);
    });
  });

  // ── getMachine ───────────────────────────────────────────────────────

  describe("getMachine", () => {
    it("sends GET to /machines/:id with auth header and returns parsed response", async () => {
      const expected = fakeMachine();
      fetchMock.mockResolvedValueOnce(okResponse(expected));

      const result = await client.getMachine("machine-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines/machine-1`);
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      // GET requests should not include a body
      expect(opts.body).toBeUndefined();
      expect(result).toEqual(expected);
    });
  });

  // ── startMachine ────────────────────────────────────────────────────

  describe("startMachine", () => {
    it("sends POST to /machines/:id/start", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({}));

      await client.startMachine("machine-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines/machine-1/start`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    });
  });

  // ── stopMachine ─────────────────────────────────────────────────────

  describe("stopMachine", () => {
    it("sends POST to /machines/:id/stop", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({}));

      await client.stopMachine("machine-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines/machine-1/stop`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    });
  });

  // ── destroyMachine ──────────────────────────────────────────────────

  describe("destroyMachine", () => {
    it("sends DELETE to /machines/:id without force query param by default", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({}));

      await client.destroyMachine("machine-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines/machine-1`);
      expect(opts.method).toBe("DELETE");
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    });

    it("sends DELETE with ?force=true when force=true", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({}));

      await client.destroyMachine("machine-1", true);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/machines/machine-1?force=true`);
    });
  });

  // ── Error handling (private request method) ─────────────────────────

  describe("error handling", () => {
    it("throws an error with status and body text when the API returns a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(
        errorResponse(422, "Unprocessable Entity: invalid config"),
      );

      await expect(client.getMachine("bad-id")).rejects.toThrow(
        'Fly API GET /machines/bad-id failed (422): Unprocessable Entity: invalid config',
      );
    });

    it("includes the HTTP method and path in the error message", async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500, "Internal Server Error"));

      await expect(client.createMachine({ region: "iad", config: {} as any })).rejects.toThrow(
        /Fly API POST \/machines failed \(500\)/,
      );
    });
  });

  // ── waitForState ────────────────────────────────────────────────────

  describe("waitForState", () => {
    it("returns the machine immediately when it already has the target state", async () => {
      const machine = fakeMachine({ state: "started" });
      fetchMock.mockResolvedValueOnce(okResponse(machine));

      const result = await client.waitForState("machine-1", "started");

      // Only one getMachine call needed since the state matches immediately
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result).toEqual(machine);
    });

    it("polls until the machine reaches the target state", async () => {
      vi.useFakeTimers();
      const creating = fakeMachine({ state: "created" });
      const started = fakeMachine({ state: "started" });

      fetchMock
        .mockResolvedValueOnce(okResponse(creating))
        .mockResolvedValueOnce(okResponse(creating))
        .mockResolvedValueOnce(okResponse(started));

      const promise = client.waitForState("machine-1", "started");

      // First poll happens immediately — flush it
      await vi.advanceTimersByTimeAsync(0);
      // Advance past first 2000ms sleep to trigger second poll
      await vi.advanceTimersByTimeAsync(2000);
      // Advance past second 2000ms sleep to trigger third poll
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.state).toBe("started");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it("throws when the machine does not reach the target state within the timeout", async () => {
      vi.useFakeTimers();

      // Always return "created" — never the desired "started" state.
      fetchMock.mockImplementation(() =>
        Promise.resolve(okResponse(fakeMachine({ state: "created" }))),
      );

      // Use a small timeout so the test completes quickly.
      // Immediately attach the rejection expectation to avoid unhandled rejections.
      const resultPromise = client.waitForState("machine-1", "started", 5000);

      // Attach the assertion immediately so the rejection is always handled.
      const assertionPromise = expect(resultPromise).rejects.toThrow(
        'Machine machine-1 did not reach state "started" within 5000ms',
      );

      // Advance time past the 5000ms timeout in increments matching the
      // 2000ms poll interval used by waitForState.
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      await assertionPromise;

      vi.useRealTimers();
    });
  });
});
