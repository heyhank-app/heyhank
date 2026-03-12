/**
 * Fly Apps API client for ensuring app existence before machine provisioning.
 *
 * API docs: https://fly.io/docs/machines/api/apps-resource/
 */

const FLY_API_BASE = "https://api.machines.dev/v1";
const FLY_GRAPHQL_API = "https://api.fly.io/graphql";

interface FlyApp {
  id: string;
  name: string;
  status?: string;
  organization?: {
    name?: string;
    slug?: string;
  };
}

interface CreateAppInput {
  app_name: string;
  org_slug: string;
}

export class FlyAppsClient {
  private token: string;
  private orgSlug: string;

  constructor(token: string, orgSlug = "personal") {
    this.token = token;
    this.orgSlug = orgSlug;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${FLY_API_BASE}${path}`;
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

  private async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(FLY_GRAPHQL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fly GraphQL request failed (${res.status}): ${text}`);
    }

    const payload = (await res.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      const message = payload.errors.map((e) => e.message || "unknown error").join("; ");
      throw new Error(`Fly GraphQL error: ${message}`);
    }

    if (!payload.data) {
      throw new Error("Fly GraphQL request returned no data");
    }

    return payload.data;
  }

  async getApp(appName: string): Promise<FlyApp> {
    return this.request<FlyApp>("GET", `/apps/${appName}`);
  }

  async createApp(appName: string): Promise<FlyApp> {
    const input: CreateAppInput = {
      app_name: appName,
      org_slug: this.orgSlug,
    };

    return this.request<FlyApp>("POST", "/apps", input);
  }

  async deleteApp(appName: string): Promise<void> {
    const url = `${FLY_API_BASE}/apps/${appName}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fly API DELETE /apps/${appName} failed (${res.status}): ${text}`);
    }
  }

  async destroyAppIfExists(appName: string): Promise<void> {
    try {
      await this.deleteApp(appName);
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("failed (404)")) return;
      throw error;
    }
  }

  async ensureAppExists(appName: string): Promise<void> {
    try {
      await this.getApp(appName);
      return;
    } catch (error: any) {
      const message = String(error?.message || "");
      if (!message.includes("failed (404)")) throw error;
    }

    await this.createApp(appName);
  }

  private async allocateIpAddress(
    appName: string,
    type: "shared_v4" | "v6",
  ): Promise<void> {
    const query = `
      mutation($input: AllocateIPAddressInput!) {
        allocateIpAddress(input: $input) {
          app {
            name
          }
        }
      }
    `;

    try {
      await this.graphqlRequest(query, {
        input: {
          appId: appName,
          type,
          region: "",
        },
      });
    } catch (error: any) {
      // Idempotent: when IP is already allocated, keep going.
      const message = String(error?.message || "").toLowerCase();
      if (
        message.includes("already") ||
        message.includes("exists") ||
        message.includes("allocated")
      ) {
        return;
      }
      throw error;
    }
  }

  async ensurePublicIps(appName: string): Promise<void> {
    await this.allocateIpAddress(appName, "shared_v4");
    await this.allocateIpAddress(appName, "v6");
  }
}

export type { FlyApp };
