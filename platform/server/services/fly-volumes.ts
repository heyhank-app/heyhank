/**
 * Fly Volumes API client for persistent storage.
 */

const FLY_API_BASE = "https://api.machines.dev/v1";

interface FlyVolume {
  id: string;
  name: string;
  state: string;
  size_gb: number;
  region: string;
  zone: string;
  created_at: string;
}

interface CreateVolumeInput {
  name: string;
  region: string;
  size_gb: number;
}

export class FlyVolumesClient {
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
      const text = await res.text();
      throw new Error(`Fly API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async createVolume(input: CreateVolumeInput): Promise<FlyVolume> {
    return this.request<FlyVolume>("POST", "/volumes", input);
  }

  async getVolume(volumeId: string): Promise<FlyVolume> {
    return this.request<FlyVolume>("GET", `/volumes/${volumeId}`);
  }

  async listVolumes(): Promise<FlyVolume[]> {
    return this.request<FlyVolume[]>("GET", "/volumes");
  }

  async deleteVolume(volumeId: string): Promise<void> {
    await this.request<void>("DELETE", `/volumes/${volumeId}`);
  }
}

export type { FlyVolume, CreateVolumeInput };
