import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { ControllerBridge } from "./controller-bridge.js";
import type { Message } from "./types.js";

export function createRoutes(bridge: ControllerBridge) {
  const api = new Hono();

  // ─── Session ──────────────────────────────────────────────────────

  api.post("/session/init", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const session = await bridge.init({
      teamName: body.teamName,
      cwd: body.cwd,
      claudeBinary: body.claudeBinary,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      env: body.env,
    });
    return c.json(session);
  });

  api.post("/session/shutdown", async (c) => {
    await bridge.shutdown();
    return c.json({ ok: true });
  });

  api.get("/session/status", (c) => {
    return c.json({
      ...bridge.sessionInfo,
      agents: bridge.getAgents(),
    });
  });

  // ─── Agents ───────────────────────────────────────────────────────

  api.post("/agents/spawn", async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const agent = await bridge.spawnAgent({
      name: body.name,
      type: body.type,
      model: body.model,
      cwd: body.cwd,
      permissions: body.permissions,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      env: body.env,
    });
    return c.json(agent);
  });

  api.post("/agents/:name/send", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json();
    if (!body.message) return c.json({ error: "message is required" }, 400);

    const ctrl = bridge.getController();
    await ctrl.send(name, body.message, body.summary);

    // Add user message to buffer
    const msg: Message = {
      id: randomUUID(),
      from: "you",
      text: body.message,
      timestamp: new Date().toISOString(),
    };
    bridge.addMessage(name, msg);
    bridge.ws.broadcast({ type: "agent:message", agent: name, message: msg });

    return c.json({ ok: true });
  });

  api.post("/agents/:name/kill", async (c) => {
    const name = c.req.param("name");
    const ctrl = bridge.getController();
    await ctrl.killAgent(name);
    return c.json({ ok: true });
  });

  api.post("/agents/:name/shutdown", async (c) => {
    const name = c.req.param("name");
    const ctrl = bridge.getController();
    await ctrl.sendShutdownRequest(name);
    return c.json({ ok: true });
  });

  api.post("/agents/:name/approve", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json();
    if (!body.requestId) return c.json({ error: "requestId is required" }, 400);
    if (!body.type || !["plan", "permission"].includes(body.type)) {
      return c.json({ error: 'type must be "plan" or "permission"' }, 400);
    }

    const ctrl = bridge.getController();
    if (body.type === "plan") {
      await ctrl.sendPlanApproval(name, body.requestId, body.approve ?? true, body.feedback);
    } else {
      await ctrl.sendPermissionResponse(name, body.requestId, body.approve ?? true);
    }
    bridge.removeApproval(body.requestId);
    return c.json({ ok: true });
  });

  return api;
}
