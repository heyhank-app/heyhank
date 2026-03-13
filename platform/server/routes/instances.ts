import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import {
  requireAuth,
  requireOrganization,
  type AuthEnv,
} from "../middleware/auth.js";
import { getDb } from "../db/index.js";
import { instances as instancesTable } from "../db/schema.js";
import { createInstanceToken } from "../lib/token.js";
import { FlyAppsClient } from "../services/fly-apps.js";
import { Provisioner, type Plan } from "../services/provisioner.js";

/**
 * Instance management routes.
 *
 * All routes require authentication (requireAuth) and an active organization
 * (requireOrganization). Instances are scoped to the active organization.
 *
 * Instance ownership model:
 * - "shared" instances (ownerType = "shared"): accessible by all organization
 *   members for read access, but still tracked with an ownerId for
 *   destructive/admin actions.
 * - "personal" instances (ownerType = "personal", ownerId = userId): only
 *   accessible by the owning user.
 *
 * GET    /instances          — List organization's instances (shared + user's personal)
 * POST   /instances          — Provision new instance
 * GET    /instances/:id      — Instance details + status
 * DELETE /instances/:id      — Destroy instance
 * POST   /instances/:id/start
 * POST   /instances/:id/stop
 * POST   /instances/:id/restart
 * POST   /instances/:id/token  — Issue auth JWT for instance access
 * GET    /instances/:id/embed  — Redirect to instance with token
 */

const instances = new Hono<AuthEnv>();
const VALID_PLANS: Plan[] = ["starter", "pro", "enterprise"];

function getProvisioner(flyAppNameOverride?: string): Provisioner {
  const flyToken = process.env.FLY_API_TOKEN;
  const flyAppName = flyAppNameOverride || process.env.FLY_APP_NAME;
  const companionImage = process.env.COMPANION_IMAGE;

  const missing = [
    !flyToken && "FLY_API_TOKEN",
    !flyAppName && "FLY_APP_NAME (or request.flyAppName)",
    !companionImage && "COMPANION_IMAGE",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return new Provisioner(flyToken!, flyAppName!, companionImage!);
}

function getAppsClient(): FlyAppsClient {
  const flyToken = process.env.FLY_API_TOKEN;
  if (!flyToken) {
    throw new Error("Missing required environment variables: FLY_API_TOKEN");
  }
  const orgSlug = process.env.FLY_ORG_SLUG || "personal";
  return new FlyAppsClient(flyToken, orgSlug);
}

function normalizeHostname(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/\/.*$/, "");
}

function makeHostname(flyAppName: string, requested?: string): string {
  if (requested?.trim()) return normalizeHostname(requested);
  return `${flyAppName}.fly.dev`;
}

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("localhost:") ||
    normalized.startsWith("127.0.0.1:") ||
    normalized.startsWith("[::1]:")
  );
}

function resolveLoginUrl(c: any): string {
  const explicit = process.env.COMPANION_LOGIN_URL?.trim();
  if (explicit) return explicit;

  const forwardedHost = c.req.header("x-forwarded-host");
  const forwardedProto = c.req.header("x-forwarded-proto");
  const reqUrl = new URL(c.req.url);
  const host = (forwardedHost || reqUrl.host || "").trim();
  const proto = (forwardedProto || reqUrl.protocol.replace(/:$/, "") || "https").trim();

  // Avoid producing broken redirects like http://localhost:3458/login in local dev.
  if (!host || isLocalHost(host)) return "";
  return `${proto}://${host}/login`;
}

function slugPart(input: string, max = 12): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || "x").slice(0, max);
}

function makeFlyAppName(userId: string, orgId: string): string {
  // Keep stable per (user, org) so mapping is deterministic and stored in DB.
  const name = `comp-${slugPart(userId)}-${slugPart(orgId)}`;
  return name.slice(0, 30);
}

function getFlyAppNameFromConfig(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const flyAppName = (config as Record<string, unknown>).flyAppName;
  return typeof flyAppName === "string" && flyAppName.trim() ? flyAppName : undefined;
}

function isFlyNotFoundError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || "");
  return message.includes("failed (404)");
}

async function getAuthorizedInstance(instanceId: string, orgId: string, userId: string) {
  const db = getDb();
  const row = await db.query.instances.findFirst({
    where: and(
      eq(instancesTable.id, instanceId),
      eq(instancesTable.organizationId, orgId),
      or(eq(instancesTable.ownerType, "shared"), eq(instancesTable.ownerId, userId)),
    ),
  });

  return row ?? null;
}

async function getOwnedInstance(instanceId: string, orgId: string, userId: string) {
  const db = getDb();
  const row = await db.query.instances.findFirst({
    where: and(
      eq(instancesTable.id, instanceId),
      eq(instancesTable.organizationId, orgId),
      or(
        eq(instancesTable.ownerId, userId),
        and(eq(instancesTable.ownerType, "shared"), isNull(instancesTable.ownerId)),
      ),
    ),
  });

  return row ?? null;
}

// All instance routes require auth + active organization.
instances.use("/*", requireAuth, requireOrganization);

/** Strip sensitive fields before returning instance data to clients */
function sanitizeInstance(row: Record<string, unknown>) {
  const { authSecret, ...safe } = row as Record<string, unknown> & { authSecret?: unknown };
  return safe;
}


instances.get("/", async (c) => {
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;
  const db = getDb();

  const rows = await db.query.instances.findMany({
    where: and(
      eq(instancesTable.organizationId, orgId),
      or(eq(instancesTable.ownerType, "shared"), eq(instancesTable.ownerId, userId)),
    ),
  });

  return c.json({ instances: rows.map(sanitizeInstance), organizationId: orgId, userId });
});

instances.post("/", async (c) => {
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;
  const body = await c.req.json<{
    plan?: string;
    region?: string;
    hostname?: string;
    ownerType?: "shared" | "personal";
    flyAppName?: string;
  }>();

  const ownerType = body.ownerType || "shared";
  // Shared instances are readable by org members, but ownership is still tied
  // to the creator for destructive operations.
  const ownerId = userId;
  const plan = (body.plan || "starter") as Plan;
  const region = body.region || "iad";
  const flyAppName = body.flyAppName?.trim() || makeFlyAppName(userId, orgId);

  if (!VALID_PLANS.includes(plan)) {
    return c.json({ error: `Invalid plan: ${body.plan}` }, 400);
  }

  let provisioner: Provisioner;
  try {
    provisioner = getProvisioner(flyAppName);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }

  try {
    const apps = getAppsClient();
    await apps.ensureAppExists(flyAppName);
    await apps.ensurePublicIps(flyAppName);
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to ensure Fly app exists" }, 502);
  }

  const hostname = makeHostname(flyAppName, body.hostname);
  const loginUrl = resolveLoginUrl(c);

  const provisioned = await provisioner.provision({
    organizationId: orgId,
    plan,
    region,
    hostname,
    loginUrl,
  });

  const db = getDb();
  const [created] = await db
    .insert(instancesTable)
    .values({
      organizationId: orgId,
      ownerId,
      ownerType,
      flyMachineId: provisioned.flyMachineId,
      flyVolumeId: provisioned.flyVolumeId,
      region,
      hostname: provisioned.hostname,
      machineStatus: "started",
      authSecret: provisioned.authSecret,
      config: { plan, flyAppName },
    })
    .returning();

  return c.json({
    message: "Instance provisioned",
    instance: created,
  });
});

/**
 * SSE streaming endpoint for instance creation with real-time progress.
 * Emits progress events for each provisioning step, then a final "done" event
 * with the created instance data. Follows the same pattern as
 * web/server/routes.ts create-stream.
 */
instances.post("/create-stream", async (c) => {
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;
  const body = await c.req.json<{
    plan?: string;
    region?: string;
    hostname?: string;
    ownerType?: "shared" | "personal";
    flyAppName?: string;
  }>();

  const ownerType = body.ownerType || "shared";
  const ownerId = userId;
  const plan = (body.plan || "starter") as Plan;
  const region = body.region || "iad";
  const flyAppName = body.flyAppName?.trim() || makeFlyAppName(userId, orgId);

  if (!VALID_PLANS.includes(plan)) {
    return c.json({ error: `Invalid plan: ${body.plan}` }, 400);
  }

  let provisioner: Provisioner;
  try {
    provisioner = getProvisioner(flyAppName);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }

  const emitProgress = (
    stream: SSEStreamingApi,
    step: string,
    label: string,
    status: "in_progress" | "done" | "error",
  ) =>
    stream.writeSSE({
      event: "progress",
      data: JSON.stringify({ step, label, status }),
    });

  return streamSSE(c, async (stream) => {
    // Track the last in-progress step so we can mark it as error on failure.
    let activeStep: { step: string; label: string } | null = null;
    // Track provisioned resources so we can clean up on DB-save failure.
    let provisioned: Awaited<ReturnType<Provisioner["provision"]>> | null = null;

    try {
      // Step 1: Ensure Fly app
      activeStep = { step: "ensuring_app", label: "Ensuring Fly app exists" };
      await emitProgress(stream, "ensuring_app", "Ensuring Fly app exists", "in_progress");
      const apps = getAppsClient();
      await apps.ensureAppExists(flyAppName);
      await apps.ensurePublicIps(flyAppName);
      await emitProgress(stream, "ensuring_app", "Ensuring Fly app exists", "done");
      activeStep = null;

      // Step 2-4: Provision (volume, machine, wait) — progress emitted by provisioner
      const hostname = makeHostname(flyAppName, body.hostname);
      const loginUrl = resolveLoginUrl(c);

      provisioned = await provisioner.provision({
        organizationId: orgId,
        plan,
        region,
        hostname,
        loginUrl,
        onProgress: (step, label, status) => {
          if (status === "in_progress") activeStep = { step, label };
          else if (status === "done") activeStep = null;
          void emitProgress(stream, step, label, status).catch(() => {});
        },
      });

      // Step 5: Save to DB
      activeStep = { step: "saving_db", label: "Saving instance" };
      await emitProgress(stream, "saving_db", "Saving instance", "in_progress");
      const db = getDb();
      const [created] = await db
        .insert(instancesTable)
        .values({
          organizationId: orgId,
          ownerId,
          ownerType,
          flyMachineId: provisioned.flyMachineId,
          flyVolumeId: provisioned.flyVolumeId,
          region,
          hostname: provisioned.hostname,
          machineStatus: "started",
          authSecret: provisioned.authSecret,
          config: { plan, flyAppName },
        })
        .returning();
      // DB save succeeded — clear provisioned so the catch block won't
      // deprovision resources that are now referenced by the DB record.
      provisioned = null;
      await emitProgress(stream, "saving_db", "Saving instance", "done");
      activeStep = null;

      // Done
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ instance: sanitizeInstance(created) }),
      });
    } catch (err: any) {
      // Mark the in-flight step as error so the UI stops spinning.
      if (activeStep) {
        await emitProgress(stream, activeStep.step, activeStep.label, "error").catch(() => {});
      }

      // Clean up orphaned Fly resources if provisioning succeeded but DB save failed.
      if (provisioned) {
        try {
          await provisioner.deprovision(provisioned.flyMachineId, provisioned.flyVolumeId);
        } catch {
          // Best-effort cleanup — log but don't mask the original error.
        }
      }

      const message = err.message || "Instance creation failed";
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: message }),
      });
    }
  });
});

instances.get("/:id", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);

  return c.json(sanitizeInstance(row));
});

instances.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getOwnedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found or not owned by user" }, 404);

  if (row.flyMachineId && row.flyVolumeId) {
    const appNameFromConfig = getFlyAppNameFromConfig(row.config);
    const provisioner = getProvisioner(appNameFromConfig);
    try {
      await provisioner.deprovision(row.flyMachineId, row.flyVolumeId);
    } catch (error) {
      // If Fly resources are already gone, still clean up stale DB rows.
      if (!isFlyNotFoundError(error)) throw error;
    }
  }

  const appNameFromConfig = getFlyAppNameFromConfig(row.config);
  if (appNameFromConfig) {
    const apps = getAppsClient();
    await apps.destroyAppIfExists(appNameFromConfig);
  }

  const db = getDb();
  await db.delete(instancesTable).where(eq(instancesTable.id, id));
  return c.json({ id, message: "Instance destroyed" });
});

instances.post("/:id/start", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);
  if (!row.flyMachineId) return c.json({ error: "Instance has no Fly machine" }, 409);

  const appNameFromConfig = getFlyAppNameFromConfig(row.config);
  const provisioner = getProvisioner(appNameFromConfig);
  await provisioner.start(row.flyMachineId);

  const db = getDb();
  await db
    .update(instancesTable)
    .set({ machineStatus: "started" })
    .where(eq(instancesTable.id, id));

  return c.json({ id, message: "Started" });
});

instances.post("/:id/stop", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);
  if (!row.flyMachineId) return c.json({ error: "Instance has no Fly machine" }, 409);

  const appNameFromConfig = getFlyAppNameFromConfig(row.config);
  const provisioner = getProvisioner(appNameFromConfig);
  await provisioner.stop(row.flyMachineId);

  const db = getDb();
  await db
    .update(instancesTable)
    .set({ machineStatus: "stopped" })
    .where(eq(instancesTable.id, id));

  return c.json({ id, message: "Stopped" });
});

instances.post("/:id/restart", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);
  if (!row.flyMachineId) return c.json({ error: "Instance has no Fly machine" }, 409);

  const appNameFromConfig = getFlyAppNameFromConfig(row.config);
  const provisioner = getProvisioner(appNameFromConfig);
  await provisioner.stop(row.flyMachineId);
  await provisioner.start(row.flyMachineId);

  const db = getDb();
  await db
    .update(instancesTable)
    .set({ machineStatus: "started" })
    .where(eq(instancesTable.id, id));

  return c.json({ id, message: "Restarted" });
});

instances.post("/:id/token", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;

  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);

  const token = await createInstanceToken(row.authSecret);
  return c.json({ id, token });
});

instances.get("/:id/embed", async (c) => {
  const id = c.req.param("id");

  // Validate id is a UUID to prevent open redirect attacks.
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const orgId = c.get("organizationId");
  const userId = c.get("auth").userId;
  const row = await getAuthorizedInstance(id, orgId, userId);
  if (!row) return c.json({ error: "Instance not found" }, 404);

  const token = await createInstanceToken(row.authSecret);
  const url = new URL(`https://${row.hostname}`);
  url.searchParams.set("token", token);
  return c.redirect(url.toString());
});

export { instances };
