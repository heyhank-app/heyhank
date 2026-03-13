import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Provisioner } from "./provisioner";
import type { Plan } from "./provisioner";

/**
 * Tests for the Provisioner class — orchestrates Fly.io machine and volume
 * lifecycle for customer instance provisioning/deprovisioning.
 *
 * Strategy: mock `global.fetch` so the underlying FlyMachinesClient and
 * FlyVolumesClient HTTP calls are intercepted. Also mock `node:crypto`
 * randomBytes for deterministic authSecret values.
 *
 * We use global.fetch mocking (rather than vi.mock for class constructors)
 * because vitest relative-path module mocking has resolution issues with
 * Bun's bundler-mode module resolution.
 */

// ── Mock randomBytes ────────────────────────────────────────────────────
const FAKE_AUTH_SECRET = "ab".repeat(32); // 64 hex chars
vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({
    toString: (encoding: string) => {
      if (encoding === "hex") return FAKE_AUTH_SECRET;
      return "mock";
    },
  })),
}));

// ── Fetch mock helpers ──────────────────────────────────────────────────

const TEST_TOKEN = "fly-token";
const TEST_APP = "companion-app";
const TEST_IMAGE = "registry.fly.io/companion:latest";
const FLY_BASE = `https://api.machines.dev/v1/apps/${TEST_APP}`;

let fetchMock: ReturnType<typeof vi.fn>;
let savedFetch: typeof global.fetch;

/** Create a mock Response. */
function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

/**
 * Set up the fetch mock to respond correctly for a full provision flow:
 * 1. POST /volumes → volume response
 * 2. POST /machines → machine response
 * 3. GET /machines/:id → started state (for waitForState)
 */
function setupProvisionFetchMock(overrides: {
  volumeId?: string;
  machineId?: string;
  machineState?: string;
} = {}) {
  const volumeId = overrides.volumeId ?? "vol-123";
  const machineId = overrides.machineId ?? "mach-456";
  const machineState = overrides.machineState ?? "started";

  fetchMock.mockImplementation((url: string, opts: RequestInit) => {
    const method = opts.method ?? "GET";

    // Volume creation
    if (url === `${FLY_BASE}/volumes` && method === "POST") {
      return Promise.resolve(okResponse({ id: volumeId }));
    }
    // Machine creation
    if (url === `${FLY_BASE}/machines` && method === "POST") {
      return Promise.resolve(okResponse({ id: machineId }));
    }
    // getMachine (for waitForState polling)
    if (url === `${FLY_BASE}/machines/${machineId}` && method === "GET") {
      return Promise.resolve(okResponse({ id: machineId, state: machineState }));
    }
    // startMachine
    if (url === `${FLY_BASE}/machines/${machineId}/start` && method === "POST") {
      return Promise.resolve(okResponse({}));
    }
    // stopMachine
    if (url === `${FLY_BASE}/machines/${machineId}/stop` && method === "POST") {
      return Promise.resolve(okResponse({}));
    }
    // destroyMachine (with or without force)
    if (url.startsWith(`${FLY_BASE}/machines/${machineId}`) && method === "DELETE") {
      return Promise.resolve(okResponse({}));
    }
    // deleteVolume
    if (url === `${FLY_BASE}/volumes/${volumeId}` && method === "DELETE") {
      return Promise.resolve(okResponse({}));
    }

    // Fallback: unexpected call
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
      text: () => Promise.resolve(`Unexpected fetch: ${method} ${url}`),
    } as unknown as Response);
  });
}

function baseInput(overrides: Partial<Parameters<Provisioner["provision"]>[0]> = {}) {
  return {
    organizationId: "org-1",
    plan: "starter" as Plan,
    region: "iad",
    hostname: "acme",
    loginUrl: "https://acme.example.com/login",
    ...overrides,
  };
}

describe("Provisioner", () => {
  let provisioner: Provisioner;

  beforeEach(() => {
    savedFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    setupProvisionFetchMock();
    provisioner = new Provisioner(TEST_TOKEN, TEST_APP, TEST_IMAGE);
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  // ── provision ───────────────────────────────────────────────────────

  describe("provision", () => {
    it("creates a volume with the correct plan-based size, then creates a machine, and waits for started state", async () => {
      await provisioner.provision(baseInput());

      // Collect all fetch calls to verify the sequence.
      const calls = fetchMock.mock.calls;

      // 1st call: create volume (POST /volumes)
      expect(calls[0][0]).toBe(`${FLY_BASE}/volumes`);
      expect(calls[0][1].method).toBe("POST");
      const volumeBody = JSON.parse(calls[0][1].body);
      expect(volumeBody.name).toBe("companion_acme");
      expect(volumeBody.region).toBe("iad");
      expect(volumeBody.size_gb).toBe(10);

      // 2nd call: create machine (POST /machines)
      expect(calls[1][0]).toBe(`${FLY_BASE}/machines`);
      expect(calls[1][1].method).toBe("POST");
      const machineBody = JSON.parse(calls[1][1].body);
      expect(machineBody.name).toBe("companion-acme");
      expect(machineBody.region).toBe("iad");
      expect(machineBody.config.image).toBe(TEST_IMAGE);
      expect(machineBody.config.mounts).toEqual([{ volume: "vol-123", path: "/data" }]);

      // 3rd call: waitForState → GET /machines/:id
      expect(calls[2][0]).toBe(`${FLY_BASE}/machines/mach-456`);
      expect(calls[2][1].method).toBe("GET");
    });

    it("sanitizes and truncates volume names to Fly constraints", async () => {
      await provisioner.provision(
        baseInput({ hostname: "ACME-VERY-LONG-HOSTNAME-WITH-SYMBOLS!!!and-more" }),
      );

      const volumeBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(volumeBody.name).toBe("companion_acme_very_long_hostn");
      expect(volumeBody.name.length).toBeLessThanOrEqual(30);
      expect(volumeBody.name).toMatch(/^[a-z0-9_]+$/);
    });

    it.each([
      ["starter", { cpus: 2, memory_mb: 2048, cpu_kind: "shared", storage_gb: 10 }],
      ["pro", { cpus: 4, memory_mb: 4096, cpu_kind: "shared", storage_gb: 50 }],
      ["enterprise", { cpus: 4, memory_mb: 8192, cpu_kind: "performance", storage_gb: 100 }],
    ] as const)(
      "uses correct CPU, memory, cpu_kind, and storage for the %s plan",
      async (plan, expected) => {
        await provisioner.provision(baseInput({ plan }));

        const calls = fetchMock.mock.calls;

        // Verify volume size in the first call (POST /volumes).
        const volumeBody = JSON.parse(calls[0][1].body);
        expect(volumeBody.size_gb).toBe(expected.storage_gb);

        // Verify machine guest config in the second call (POST /machines).
        const machineBody = JSON.parse(calls[1][1].body);
        expect(machineBody.config.guest).toEqual({
          cpus: expected.cpus,
          memory_mb: expected.memory_mb,
          cpu_kind: expected.cpu_kind,
        });
      },
    );

    it("includes TAILSCALE_AUTH_KEY in machine env when tailscaleAuthKey is provided", async () => {
      await provisioner.provision(baseInput({ tailscaleAuthKey: "tskey-secret-123" }));

      const machineBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(machineBody.config.env.TAILSCALE_AUTH_KEY).toBe("tskey-secret-123");
    });

    it("does NOT include TAILSCALE_AUTH_KEY in machine env when tailscaleAuthKey is omitted", async () => {
      await provisioner.provision(baseInput());

      const machineBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(machineBody.config.env).not.toHaveProperty("TAILSCALE_AUTH_KEY");
    });

    it("returns the correct result shape with flyMachineId, flyVolumeId, authSecret, and hostname", async () => {
      const result = await provisioner.provision(baseInput());

      expect(result).toEqual({
        flyMachineId: "mach-456",
        flyVolumeId: "vol-123",
        authSecret: FAKE_AUTH_SECRET,
        hostname: "acme",
      });
    });

    it("calls onProgress callback at each provisioning step when provided", async () => {
      const progressCalls: Array<[string, string, string]> = [];
      const onProgress = vi.fn((step: string, label: string, status: string) => {
        progressCalls.push([step, label, status]);
      });

      await provisioner.provision(baseInput({ onProgress }));

      // Verify progress was called for each step (in_progress + done)
      expect(onProgress).toHaveBeenCalled();

      // Check the step names are correct and in order
      const stepNames = progressCalls.map(([step]) => step);
      expect(stepNames).toContain("creating_volume");
      expect(stepNames).toContain("creating_machine");
      expect(stepNames).toContain("waiting_start");

      // Each step should have both "in_progress" and "done" calls
      const volumeStatuses = progressCalls.filter(([s]) => s === "creating_volume").map(([, , status]) => status);
      expect(volumeStatuses).toEqual(["in_progress", "done"]);

      const machineStatuses = progressCalls.filter(([s]) => s === "creating_machine").map(([, , status]) => status);
      expect(machineStatuses).toEqual(["in_progress", "done"]);

      const waitStatuses = progressCalls.filter(([s]) => s === "waiting_start").map(([, , status]) => status);
      expect(waitStatuses).toEqual(["in_progress", "done"]);
    });

    it("works without onProgress callback (backward compatible)", async () => {
      // Should not throw when onProgress is not provided
      const result = await provisioner.provision(baseInput());
      expect(result.flyMachineId).toBe("mach-456");
    });

    it("sets standard env vars on the machine config", async () => {
      await provisioner.provision(baseInput());

      const machineBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      const env = machineBody.config.env;
      expect(env.NODE_ENV).toBe("production");
      expect(env.COMPANION_HOME).toBe("/data/companion");
      expect(env.COMPANION_SESSION_DIR).toBe("/data/sessions");
      expect(env.COMPANION_AUTH_ENABLED).toBe("1");
      expect(env.COMPANION_AUTH_SECRET).toBe(FAKE_AUTH_SECRET);
      expect(env.COMPANION_LOGIN_URL).toBe("https://acme.example.com/login");
    });
  });

  // ── deprovision ─────────────────────────────────────────────────────

  describe("deprovision", () => {
    it("stops the machine, waits for stopped state, then destroys machine and deletes volume", async () => {
      // Override to return "stopped" for waitForState during deprovision.
      setupProvisionFetchMock({ machineState: "stopped" });

      await provisioner.deprovision("mach-456", "vol-123");

      const calls = fetchMock.mock.calls;
      const methods = calls.map((c: any[]) => `${c[1].method} ${c[0]}`);

      // Verify sequence: stop → getMachine (waitForState) → destroy → deleteVolume
      expect(methods).toContain(`POST ${FLY_BASE}/machines/mach-456/stop`);
      expect(methods).toContain(`GET ${FLY_BASE}/machines/mach-456`);
      expect(methods).toContain(`DELETE ${FLY_BASE}/machines/mach-456?force=true`);
      expect(methods).toContain(`DELETE ${FLY_BASE}/volumes/vol-123`);
    });

    it("still destroys machine and deletes volume even if stopMachine throws (machine already stopped)", async () => {
      // Make stop fail with a 422, but destroy and delete succeed.
      fetchMock.mockImplementation((url: string, opts: RequestInit) => {
        const method = opts.method ?? "GET";
        if (url.endsWith("/stop") && method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve("machine already stopped"),
          } as unknown as Response);
        }
        if (url.startsWith(`${FLY_BASE}/machines/mach-456`) && method === "DELETE") {
          return Promise.resolve(okResponse({}));
        }
        if (url === `${FLY_BASE}/volumes/vol-123` && method === "DELETE") {
          return Promise.resolve(okResponse({}));
        }
        return Promise.resolve(okResponse({}));
      });

      // Should not throw despite stopMachine failing.
      await expect(provisioner.deprovision("mach-456", "vol-123")).resolves.toBeUndefined();

      // Verify destroy and delete were still called.
      const calls = fetchMock.mock.calls;
      const methods = calls.map((c: any[]) => `${c[1].method} ${c[0]}`);
      expect(methods).toContain(`DELETE ${FLY_BASE}/machines/mach-456?force=true`);
      expect(methods).toContain(`DELETE ${FLY_BASE}/volumes/vol-123`);
    });
  });

  // ── start ───────────────────────────────────────────────────────────

  describe("start", () => {
    it("starts the machine and waits for started state with 60s timeout", async () => {
      await provisioner.start("mach-456");

      const calls = fetchMock.mock.calls;
      const methods = calls.map((c: any[]) => `${c[1].method} ${c[0]}`);

      // Should call start then getMachine (for waitForState)
      expect(methods).toContain(`POST ${FLY_BASE}/machines/mach-456/start`);
      expect(methods).toContain(`GET ${FLY_BASE}/machines/mach-456`);
    });
  });

  // ── stop ────────────────────────────────────────────────────────────

  describe("stop", () => {
    it("stops the machine and waits for stopped state with 30s timeout", async () => {
      setupProvisionFetchMock({ machineState: "stopped" });

      await provisioner.stop("mach-456");

      const calls = fetchMock.mock.calls;
      const methods = calls.map((c: any[]) => `${c[1].method} ${c[0]}`);

      expect(methods).toContain(`POST ${FLY_BASE}/machines/mach-456/stop`);
      expect(methods).toContain(`GET ${FLY_BASE}/machines/mach-456`);
    });
  });

  // ── getStatus ───────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns the machine state from getMachine", async () => {
      const status = await provisioner.getStatus("mach-456");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe(`${FLY_BASE}/machines/mach-456`);
      expect(status).toBe("started");
    });

    it("returns the stopped state when machine is stopped", async () => {
      setupProvisionFetchMock({ machineState: "stopped" });

      const status = await provisioner.getStatus("mach-456");

      expect(status).toBe("stopped");
    });
  });
});
