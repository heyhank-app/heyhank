const BASE = "/api";

async function post(path: string, body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const api = {
  initSession: (opts?: {
    teamName?: string;
    cwd?: string;
    apiKey?: string;
    baseUrl?: string;
    env?: Record<string, string>;
  }) => post("/session/init", opts),
  shutdownSession: () => post("/session/shutdown"),
  getStatus: () => get("/session/status"),

  spawnAgent: (opts: {
    name: string;
    type?: string;
    model?: string;
    cwd?: string;
    permissions?: string;
    apiKey?: string;
    baseUrl?: string;
    env?: Record<string, string>;
  }) => post("/agents/spawn", opts),
  sendMessage: (agent: string, message: string, summary?: string) =>
    post(`/agents/${encodeURIComponent(agent)}/send`, { message, summary }),
  killAgent: (agent: string) =>
    post(`/agents/${encodeURIComponent(agent)}/kill`),
  shutdownAgent: (agent: string) =>
    post(`/agents/${encodeURIComponent(agent)}/shutdown`),
  approve: (agent: string, requestId: string, type: "plan" | "permission", approve: boolean, feedback?: string) =>
    post(`/agents/${encodeURIComponent(agent)}/approve`, { requestId, type, approve, feedback }),
};
