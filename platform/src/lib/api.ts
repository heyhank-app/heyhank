/**
 * REST client for the Companion Cloud control plane API.
 */

const BASE = "/api";

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${errText}`);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  // Instances
  listInstances: () => request<{ instances: unknown[] }>("GET", "/instances"),
  createInstance: (data: {
    plan: string;
    region: string;
    ownerType?: "shared" | "personal";
  }) => request("POST", "/instances", data),
  getInstance: (id: string) => request("GET", `/instances/${id}`),
  deleteInstance: (id: string) => request("DELETE", `/instances/${id}`),
  startInstance: (id: string) => request("POST", `/instances/${id}/start`),
  stopInstance: (id: string) => request("POST", `/instances/${id}/stop`),
  restartInstance: (id: string) => request("POST", `/instances/${id}/restart`),
  getInstanceToken: (id: string) => request("POST", `/instances/${id}/token`),

  // Billing
  createCheckout: (plan: string) =>
    request<{ url: string }>("POST", "/billing/checkout", { plan }),
  getBillingPortal: () => request<{ url: string }>("POST", "/billing/portal"),

  // Dashboard
  getUsage: () => request("GET", "/dashboard/usage"),

  // Status
  getStatus: () => request("GET", "/status"),
};
