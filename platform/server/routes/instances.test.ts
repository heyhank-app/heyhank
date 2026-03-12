import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route tests for instance management with mocked auth, DB, and provisioner.
 *
 * These tests validate that routes now invoke the real provisioning workflow
 * boundaries (Provisioner + DB persistence) rather than returning stubs.
 */

const MOCK_USER_ID = "user-test-1";
const MOCK_ORG_ID = "org-test-1";

const provisionMock = vi.fn();
const deprovisionMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();
const createInstanceTokenMock = vi.fn();
const provisionerCtorMock = vi.fn();
const ensureAppExistsMock = vi.fn();
const ensurePublicIpsMock = vi.fn();
const destroyAppIfExistsMock = vi.fn();
const flyAppsCtorMock = vi.fn();

const findManyMock = vi.fn();
const findFirstMock = vi.fn();
const insertReturningMock = vi.fn();
const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));
const deleteWhereMock = vi.fn();
const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (c: any, next: any) => {
    c.set("auth", {
      userId: MOCK_USER_ID,
      user: { id: MOCK_USER_ID, email: "test@example.com", name: "Test" },
      activeOrganizationId: MOCK_ORG_ID,
    });
    await next();
  }),
  requireOrganization: vi.fn(async (c: any, next: any) => {
    c.set("organizationId", MOCK_ORG_ID);
    await next();
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(() => ({
    query: {
      instances: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
    },
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  })),
}));

vi.mock("../services/provisioner.js", () => ({
  Provisioner: class {
    constructor(...args: any[]) {
      provisionerCtorMock(...args);
    }
    provision = provisionMock;
    deprovision = deprovisionMock;
    start = startMock;
    stop = stopMock;
  },
}));

vi.mock("../services/fly-apps.js", () => ({
  FlyAppsClient: class {
    constructor(...args: any[]) {
      flyAppsCtorMock(...args);
    }
    ensureAppExists = ensureAppExistsMock;
    ensurePublicIps = ensurePublicIpsMock;
    destroyAppIfExists = destroyAppIfExistsMock;
  },
}));

vi.mock("../lib/token.js", () => ({
  createInstanceToken: createInstanceTokenMock,
}));

const { instances } = await import("./instances");

describe("instances routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FLY_API_TOKEN = "fly-token";
    process.env.FLY_APP_NAME = "companion-app";
    process.env.FLY_ORG_SLUG = "org-slug";
    process.env.COMPANION_IMAGE = "registry.fly.io/companion:latest";
    delete process.env.COMPANION_LOGIN_URL;

    findManyMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([]);
    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    createInstanceTokenMock.mockResolvedValue("token-abc");
    ensureAppExistsMock.mockResolvedValue(undefined);
    ensurePublicIpsMock.mockResolvedValue(undefined);
    destroyAppIfExistsMock.mockResolvedValue(undefined);
  });

  describe("GET /", () => {
    it("returns instances visible to the current org context", async () => {
      findManyMock.mockResolvedValue([{ id: "inst-1" }]);

      const res = await instances.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.instances).toEqual([{ id: "inst-1" }]);
      expect(body.organizationId).toBe(MOCK_ORG_ID);
      expect(body.userId).toBe(MOCK_USER_ID);
    });
  });

  describe("POST /", () => {
    it("provisions a Fly machine and persists the created instance", async () => {
      provisionMock.mockResolvedValue({
        flyMachineId: "mach-123",
        flyVolumeId: "vol-123",
        authSecret: "secret-123",
        hostname: "org-test-1-abcd1234",
      });

      const persisted = {
        id: "8c9bbf79-9c44-4e4f-9840-12edd3eff2db",
        organizationId: MOCK_ORG_ID,
        ownerId: MOCK_USER_ID,
        ownerType: "shared",
        flyMachineId: "mach-123",
        flyVolumeId: "vol-123",
        region: "iad",
        hostname: "org-test-1-abcd1234",
        machineStatus: "started",
      };
      insertReturningMock.mockResolvedValue([persisted]);

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter", ownerType: "shared" }),
      });

      expect(res.status).toBe(200);
      expect(provisionMock).toHaveBeenCalledTimes(1);
      expect(flyAppsCtorMock).toHaveBeenCalledWith("fly-token", "org-slug");
      expect(ensureAppExistsMock).toHaveBeenCalledWith("comp-user-test-1-org-test-1");
      expect(ensurePublicIpsMock).toHaveBeenCalledWith("comp-user-test-1-org-test-1");
      expect(provisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: MOCK_ORG_ID,
          plan: "starter",
          region: "iad",
          loginUrl: "",
        }),
      );
      expect(provisionerCtorMock).toHaveBeenCalledWith(
        "fly-token",
        "comp-user-test-1-org-test-1",
        "registry.fly.io/companion:latest",
      );

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: MOCK_ORG_ID,
          ownerId: MOCK_USER_ID,
          ownerType: "shared",
          flyMachineId: "mach-123",
          flyVolumeId: "vol-123",
          authSecret: "secret-123",
          config: { plan: "starter", flyAppName: "comp-user-test-1-org-test-1" },
        }),
      );

      const body = await res.json();
      expect(body.message).toBe("Instance provisioned");
      expect(body.instance).toEqual(persisted);
    });

    it("returns 500 when Fly provisioning env vars are missing", async () => {
      delete process.env.FLY_API_TOKEN;

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter" }),
      });

      expect(res.status).toBe(500);
      expect(provisionMock).not.toHaveBeenCalled();

      const body = await res.json();
      expect(body.error).toContain("FLY_API_TOKEN");
    });

    it("supports per-request flyAppName when env FLY_APP_NAME is not set", async () => {
      delete process.env.FLY_APP_NAME;
      provisionMock.mockResolvedValue({
        flyMachineId: "mach-123",
        flyVolumeId: "vol-123",
        authSecret: "secret-123",
        hostname: "org-test-1-abcd1234",
      });
      insertReturningMock.mockResolvedValue([{ id: "inst-1" }]);

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter", flyAppName: "customer-app-123" }),
      });

      expect(res.status).toBe(200);
      expect(provisionerCtorMock).toHaveBeenCalledWith(
        "fly-token",
        "customer-app-123",
        "registry.fly.io/companion:latest",
      );
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { plan: "starter", flyAppName: "customer-app-123" },
        }),
      );
      expect(ensureAppExistsMock).toHaveBeenCalledWith("customer-app-123");
      expect(ensurePublicIpsMock).toHaveBeenCalledWith("customer-app-123");
    });

    it("generates flyAppName from user/org and stores the mapping when not provided", async () => {
      delete process.env.FLY_APP_NAME;
      provisionMock.mockResolvedValue({
        flyMachineId: "mach-123",
        flyVolumeId: "vol-123",
        authSecret: "secret-123",
        hostname: "org-test-1-abcd1234",
      });
      insertReturningMock.mockResolvedValue([{ id: "inst-1" }]);

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter" }),
      });

      expect(res.status).toBe(200);
      expect(provisionerCtorMock).toHaveBeenCalledWith(
        "fly-token",
        "comp-user-test-1-org-test-1",
        "registry.fly.io/companion:latest",
      );
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { plan: "starter", flyAppName: "comp-user-test-1-org-test-1" },
        }),
      );
      expect(ensureAppExistsMock).toHaveBeenCalledWith("comp-user-test-1-org-test-1");
      expect(ensurePublicIpsMock).toHaveBeenCalledWith("comp-user-test-1-org-test-1");
    });

    it("returns 502 when ensureAppExists fails", async () => {
      ensureAppExistsMock.mockRejectedValueOnce(new Error("fly app create failed"));

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter" }),
      });

      expect(res.status).toBe(502);
      expect(provisionMock).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.error).toContain("fly app create failed");
    });

    it("returns 502 when ensurePublicIps fails", async () => {
      ensurePublicIpsMock.mockRejectedValueOnce(new Error("fly ip allocation failed"));

      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter" }),
      });

      expect(res.status).toBe(502);
      expect(provisionMock).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.error).toContain("fly ip allocation failed");
    });

    it("rejects unknown plans", async () => {
      const res = await instances.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "unknown" }),
      });

      expect(res.status).toBe(400);
      expect(provisionMock).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /:id", () => {
    it("deprovisions machine+volume and deletes the DB row", async () => {
      findFirstMock.mockResolvedValue({
        id: "inst-1",
        flyMachineId: "mach-1",
        flyVolumeId: "vol-1",
        config: { flyAppName: "customer-app-123" },
      });

      const res = await instances.request("/inst-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(deprovisionMock).toHaveBeenCalledWith("mach-1", "vol-1");
      expect(flyAppsCtorMock).toHaveBeenCalledWith("fly-token", "org-slug");
      expect(destroyAppIfExistsMock).toHaveBeenCalledWith("customer-app-123");
      expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    });

    it("does not allow deleting an instance owned by another user", async () => {
      findFirstMock.mockResolvedValue(null);

      const res = await instances.request("/inst-1", { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(deprovisionMock).not.toHaveBeenCalled();
      expect(deleteWhereMock).not.toHaveBeenCalled();
    });

    it("still deletes DB row when Fly machine/volume are already deleted (404)", async () => {
      findFirstMock.mockResolvedValue({
        id: "inst-1",
        flyMachineId: "mach-1",
        flyVolumeId: "vol-1",
        config: { flyAppName: "customer-app-123" },
      });
      deprovisionMock.mockRejectedValueOnce(
        new Error("Fly API DELETE /machines/mach-1 failed (404): not found"),
      );

      const res = await instances.request("/inst-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(deleteWhereMock).toHaveBeenCalledTimes(1);
      expect(destroyAppIfExistsMock).toHaveBeenCalledWith("customer-app-123");
    });
  });

  describe("POST /:id/start", () => {
    it("starts the Fly machine and updates local machine status", async () => {
      findFirstMock.mockResolvedValue({ id: "inst-1", flyMachineId: "mach-1" });

      const res = await instances.request("/inst-1/start", { method: "POST" });
      expect(res.status).toBe(200);
      expect(startMock).toHaveBeenCalledWith("mach-1");
      expect(updateSetMock).toHaveBeenCalledWith({ machineStatus: "started" });
    });
  });

  describe("POST /:id/stop", () => {
    it("stops the Fly machine and updates local machine status", async () => {
      findFirstMock.mockResolvedValue({ id: "inst-1", flyMachineId: "mach-1" });

      const res = await instances.request("/inst-1/stop", { method: "POST" });
      expect(res.status).toBe(200);
      expect(stopMock).toHaveBeenCalledWith("mach-1");
      expect(updateSetMock).toHaveBeenCalledWith({ machineStatus: "stopped" });
    });
  });

  describe("POST /:id/restart", () => {
    it("runs stop then start for restart", async () => {
      findFirstMock.mockResolvedValue({ id: "inst-1", flyMachineId: "mach-1" });

      const res = await instances.request("/inst-1/restart", { method: "POST" });
      expect(res.status).toBe(200);
      expect(stopMock).toHaveBeenCalledWith("mach-1");
      expect(startMock).toHaveBeenCalledWith("mach-1");
    });
  });

  describe("POST /:id/token", () => {
    it("issues an instance auth token from persisted auth secret", async () => {
      findFirstMock.mockResolvedValue({ id: "inst-1", authSecret: "secret-1" });

      const res = await instances.request("/inst-1/token", { method: "POST" });
      expect(res.status).toBe(200);
      expect(createInstanceTokenMock).toHaveBeenCalledWith("secret-1");

      const body = await res.json();
      expect(body).toEqual({ id: "inst-1", token: "token-abc" });
    });
  });

  describe("GET /:id/embed", () => {
    it("redirects to persisted hostname for authorized UUID instance ids", async () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      findFirstMock.mockResolvedValue({ id: uuid, hostname: "my-inst.companion.run", authSecret: "sec-1" });
      createInstanceTokenMock.mockResolvedValueOnce("embed-token-xyz");

      const res = await instances.request(`/${uuid}/embed`, {
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://my-inst.companion.run/?token=embed-token-xyz");
    });

    it("returns 400 for non-UUID ids to prevent open redirects", async () => {
      const res = await instances.request("/evil.com%23/embed", {
        redirect: "manual",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid instance ID");
    });
  });
});
