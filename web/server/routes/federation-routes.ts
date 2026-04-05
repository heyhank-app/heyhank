// ─── Federation REST API Routes ───────────────────────────────────────────────

import { Hono } from "hono";
import { getNodeIdentity, updateNodeName, addNode, removeNode } from "../federation/node-store.js";
import { nodeManager } from "../federation/node-manager.js";

export function registerFederationRoutes(api: Hono): void {
  // GET /api/federation/identity — public (no auth needed for node discovery)
  api.get("/federation/identity", (c) => {
    return c.json(getNodeIdentity());
  });

  // PUT /api/federation/identity — update node name
  api.put("/federation/identity", async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name required" }, 400);
    return c.json({ ok: true, ...updateNodeName(name) });
  });

  // GET /api/federation/nodes — list nodes with connection status
  api.get("/federation/nodes", (c) => {
    return c.json({
      identity: getNodeIdentity(),
      nodes: nodeManager.getNodeStatuses(),
    });
  });

  // POST /api/federation/nodes — add a new node
  api.post("/federation/nodes", async (c) => {
    const body = await c.req.json<{ url?: string; secret?: string; name?: string }>().catch(() => ({} as { url?: string; secret?: string; name?: string }));
    const url = body.url?.trim();
    const secret = body.secret?.trim();
    const name = body.name?.trim() || "";

    if (!url) return c.json({ error: "url required" }, 400);
    if (!secret) return c.json({ error: "secret required" }, 400);

    const node = addNode({ url, secret, name });
    nodeManager.connectNode(node.id);
    return c.json({ ok: true, node }, 201);
  });

  // DELETE /api/federation/nodes/:id — remove and disconnect
  api.delete("/federation/nodes/:id", (c) => {
    const id = c.req.param("id");
    nodeManager.disconnectNode(id);
    removeNode(id);
    return c.json({ ok: true });
  });

  // POST /api/federation/nodes/:id/test — check connection status
  api.post("/federation/nodes/:id/test", (c) => {
    const id = c.req.param("id");
    const status = nodeManager.getNodeStatuses().find((n) => n.id === id);
    if (!status) return c.json({ error: "node not found" }, 404);
    return c.json({ ok: true, connected: status.connected, node: status });
  });

  // GET /api/federation/remote-sessions — list sessions from all connected peers
  api.get("/federation/remote-sessions", (c) => {
    return c.json({ sessions: nodeManager.getRemoteSessions() });
  });

  // POST /api/federation/proxy — send message to a remote session
  api.post("/federation/proxy", async (c) => {
    const body = await c.req.json<{ sessionId?: string; text?: string }>().catch(() => ({} as { sessionId?: string; text?: string }));
    const sessionId = body.sessionId?.trim();
    const text = body.text?.trim();
    if (!sessionId || !text) return c.json({ error: "sessionId and text required" }, 400);

    const result = await nodeManager.sendToRemoteSession(sessionId, text);
    if (result.error) return c.json({ error: result.error }, 502);
    return c.json(result);
  });
}
