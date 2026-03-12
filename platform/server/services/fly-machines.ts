/**
 * Fly Machines API client for provisioning and managing customer instances.
 *
 * API docs: https://fly.io/docs/machines/api/
 * Base URL: https://api.machines.dev/v1
 */

const FLY_API_BASE = "https://api.machines.dev/v1";

interface FlyMachineConfig {
  image: string;
  guest: {
    cpus: number;
    memory_mb: number;
    cpu_kind: "shared" | "performance";
  };
  env: Record<string, string>;
  services: Array<{
    ports: Array<{ port: number; handlers: string[] }>;
    internal_port: number;
    protocol: string;
    min_machines_running?: number;
  }>;
  mounts?: Array<{
    volume: string;
    path: string;
  }>;
  auto_stop?: "off" | "stop" | "suspend";
  auto_start?: boolean;
}

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip: string;
  config: FlyMachineConfig;
  created_at: string;
  updated_at: string;
}

interface CreateMachineInput {
  name?: string;
  region: string;
  config: FlyMachineConfig;
}

export class FlyMachinesClient {
  private token: string;
  private appName: string;

  constructor(token: string, appName: string) {
    this.token = token;
    this.appName = appName;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${FLY_API_BASE}/apps/${this.appName}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Fly API ${method} ${path} failed (${res.status}): ${errText}`);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async createMachine(input: CreateMachineInput): Promise<FlyMachine> {
    return this.request<FlyMachine>("POST", "/machines", input);
  }

  async getMachine(machineId: string): Promise<FlyMachine> {
    return this.request<FlyMachine>("GET", `/machines/${machineId}`);
  }

  async startMachine(machineId: string): Promise<void> {
    await this.request<void>("POST", `/machines/${machineId}/start`);
  }

  async stopMachine(machineId: string): Promise<void> {
    await this.request<void>("POST", `/machines/${machineId}/stop`);
  }

  async destroyMachine(machineId: string, force = false): Promise<void> {
    const query = force ? "?force=true" : "";
    await this.request<void>("DELETE", `/machines/${machineId}${query}`);
  }

  async waitForState(
    machineId: string,
    state: string,
    timeoutMs = 60_000,
  ): Promise<FlyMachine> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const machine = await this.getMachine(machineId);
      if (machine.state === state) return machine;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `Machine ${machineId} did not reach state "${state}" within ${timeoutMs}ms`,
    );
  }
}

export type { FlyMachine, FlyMachineConfig, CreateMachineInput };
