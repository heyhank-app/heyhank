import { randomBytes } from "node:crypto";
import { FlyMachinesClient } from "./fly-machines.js";
import { FlyVolumesClient } from "./fly-volumes.js";

/**
 * Plan-based resource configuration.
 */
const PLAN_CONFIGS = {
  starter: { cpus: 2, memory_mb: 2048, cpu_kind: "shared" as const, storage_gb: 10 },
  pro: { cpus: 4, memory_mb: 4096, cpu_kind: "shared" as const, storage_gb: 50 },
  enterprise: { cpus: 4, memory_mb: 8192, cpu_kind: "performance" as const, storage_gb: 100 },
} as const;

export type Plan = keyof typeof PLAN_CONFIGS;

export type ProvisionProgressFn = (step: string, label: string, status: "in_progress" | "done" | "error") => void;

interface ProvisionInput {
  organizationId: string;
  plan: Plan;
  region: string;
  hostname: string;
  loginUrl: string;
  tailscaleAuthKey?: string;
  onProgress?: ProvisionProgressFn;
}

interface ProvisionResult {
  flyMachineId: string;
  flyVolumeId: string;
  authSecret: string;
  hostname: string;
}

function makeVolumeName(hostname: string): string {
  // Fly volume names allow lowercase alphanumeric and underscores, max 30 chars.
  const safe = hostname
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = (safe || "instance").slice(0, 20);
  return `companion_${suffix}`;
}

function makeMachineName(hostname: string): string {
  // Fly machine names are best kept to lowercase alphanumeric + dashes.
  const safe = hostname
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = (safe || "instance").slice(0, 40);
  return `companion-${suffix}`;
}

/**
 * Orchestrates end-to-end instance provisioning:
 * 1. Create Fly Volume for persistent storage
 * 2. Create Fly Machine with the Companion image
 * 3. Wait for machine to start
 * 4. Return provisioned instance metadata
 */
export class Provisioner {
  private machines: FlyMachinesClient;
  private volumes: FlyVolumesClient;
  private companionImage: string;

  constructor(flyToken: string, flyAppName: string, companionImage: string) {
    this.machines = new FlyMachinesClient(flyToken, flyAppName);
    this.volumes = new FlyVolumesClient(flyToken, flyAppName);
    this.companionImage = companionImage;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const config = PLAN_CONFIGS[input.plan];
    const authSecret = randomBytes(32).toString("hex");
    const progress = input.onProgress ?? (() => {});

    // Step 1: Create volume
    progress("creating_volume", "Creating storage volume", "in_progress");
    const volume = await this.volumes.createVolume({
      name: makeVolumeName(input.hostname),
      region: input.region,
      size_gb: config.storage_gb,
    });
    progress("creating_volume", "Creating storage volume", "done");

    // Step 2: Create machine
    const env: Record<string, string> = {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      COMPANION_HOME: "/data/companion",
      COMPANION_SESSION_DIR: "/data/sessions",
      COMPANION_AUTH_ENABLED: "1",
      COMPANION_AUTH_SECRET: authSecret,
      COMPANION_LOGIN_URL: input.loginUrl,
    };

    if (input.tailscaleAuthKey) {
      env.TAILSCALE_AUTH_KEY = input.tailscaleAuthKey;
    }

    progress("creating_machine", "Creating machine", "in_progress");
    let machine;
    try {
      machine = await this.machines.createMachine({
        name: makeMachineName(input.hostname),
        region: input.region,
        config: {
          image: this.companionImage,
          guest: {
            cpus: config.cpus,
            memory_mb: config.memory_mb,
            cpu_kind: config.cpu_kind,
          },
          env,
          services: [
            {
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"] },
              ],
              internal_port: 3456,
              protocol: "tcp",
              min_machines_running: 1,
            },
          ],
          mounts: [
            {
              volume: volume.id,
              path: "/data",
            },
          ],
          auto_stop: "off",
          auto_start: true,
        },
      });
      progress("creating_machine", "Creating machine", "done");

      // Step 3: Wait for machine to be running
      progress("waiting_start", "Waiting for machine to start", "in_progress");
      await this.machines.waitForState(machine.id, "started", 90_000);
      progress("waiting_start", "Waiting for machine to start", "done");
    } catch (err) {
      // Clean up resources if machine creation/startup fails
      if (machine) {
        try { await this.machines.destroyMachine(machine.id, true); } catch {}
      }
      try { await this.volumes.deleteVolume(volume.id); } catch {}
      throw err;
    }

    // TODO: Persist authSecret to the instances table in the database so the
    // control plane can reissue tokens later (e.g. for the /token endpoint).
    // Currently only returned to the caller.

    return {
      flyMachineId: machine.id,
      flyVolumeId: volume.id,
      authSecret,
      hostname: input.hostname,
    };
  }

  async deprovision(machineId: string, volumeId: string): Promise<void> {
    // Stop machine first
    try {
      await this.machines.stopMachine(machineId);
      await this.machines.waitForState(machineId, "stopped", 30_000);
    } catch {
      // Machine may already be stopped
    }

    // Destroy machine
    await this.machines.destroyMachine(machineId, true);

    // Delete volume
    await this.volumes.deleteVolume(volumeId);
  }

  async start(machineId: string): Promise<void> {
    await this.machines.startMachine(machineId);
    await this.machines.waitForState(machineId, "started", 60_000);
  }

  async stop(machineId: string): Promise<void> {
    await this.machines.stopMachine(machineId);
    await this.machines.waitForState(machineId, "stopped", 30_000);
  }

  async getStatus(machineId: string): Promise<string> {
    const machine = await this.machines.getMachine(machineId);
    return machine.state;
  }
}
