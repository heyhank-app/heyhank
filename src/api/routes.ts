import { Hono } from "hono";
import { ClaudeCodeController } from "../controller.js";
import { claude } from "../claude.js";
import { ActionTracker } from "./action-tracker.js";
import type {
  AskBody,
  InitSessionBody,
  SpawnAgentBody,
  SendMessageBody,
  BroadcastBody,
  ApproveBody,
  CreateTaskBody,
  UpdateTaskBody,
  AssignTaskBody,
} from "./types.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_TASK_ID_RE = /^[0-9]{1,10}$/;

function validateName(value: string, field: string): void {
  if (!SAFE_NAME_RE.test(value)) {
    throw new ValidationError(
      `${field} must be 1-64 alphanumeric characters, hyphens, or underscores`
    );
  }
}

function validateTaskId(value: string): void {
  if (!SAFE_TASK_ID_RE.test(value)) {
    throw new ValidationError("task id must be a numeric string (1-10 digits)");
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface ApiState {
  controller: ClaudeCodeController | null;
  tracker: ActionTracker;
  /** True if the controller was created via POST /session/init (API owns lifecycle). */
  owned: boolean;
  /** Prevents concurrent session init/shutdown. */
  initLock: boolean;
  /** Timestamp of when this API instance was created. */
  startTime: number;
}

function getController(state: ApiState): ClaudeCodeController {
  if (!state.controller) {
    throw new Error(
      "No active session. Call POST /session/init first."
    );
  }
  return state.controller;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function buildRoutes(state: ApiState) {
  const api = new Hono();

  // ─── Health ──────────────────────────────────────────────────────────

  api.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime: Date.now() - state.startTime,
      session: state.controller !== null,
    });
  });

  // ─── Ask (one-liner) ────────────────────────────────────────────────

  api.post("/ask", async (c) => {
    const body = await c.req.json<AskBody>();
    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    try {
      const response = await claude(body.prompt, {
        model: body.model,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        timeout: body.timeout,
        cwd: body.cwd,
        permissions: body.permissions,
        env: body.env,
        logLevel: "warn",
      });

      return c.json({ response });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Agent failed to respond";
      return c.json({ error: message }, 500);
    }
  });

  // ─── Session ─────────────────────────────────────────────────────────

  api.get("/session", (c) => {
    if (!state.controller) {
      return c.json({ initialized: false, teamName: "" });
    }
    return c.json({
      initialized: true,
      teamName: state.controller.teamName,
    });
  });

  api.post("/session/init", async (c) => {
    if (state.initLock) {
      return c.json({ error: "Session init already in progress" }, 409);
    }
    state.initLock = true;

    try {
      const body = await c.req.json<InitSessionBody>().catch(() => ({} as InitSessionBody));

      // Validate names
      if (body.teamName) validateName(body.teamName, "teamName");

      // Shutdown existing session if owned by us
      const oldController = state.controller;
      if (oldController) {
        state.tracker.clear();
        state.controller = null;
        if (state.owned) {
          await oldController.shutdown();
        }
      }

      // Merge first-class options into env (first-class wins)
      const env: Record<string, string> = { ...body.env };
      if (body.apiKey) env.ANTHROPIC_AUTH_TOKEN = body.apiKey;
      if (body.baseUrl) env.ANTHROPIC_BASE_URL = body.baseUrl;
      if (body.timeout != null) env.API_TIMEOUT_MS = String(body.timeout);

      const controller = new ClaudeCodeController({
        teamName: body.teamName,
        cwd: body.cwd,
        claudeBinary: body.claudeBinary,
        env,
        logLevel: body.logLevel ?? "info",
      });

      try {
        await controller.init();
      } catch (err) {
        // Cleanup the partially-initialized controller
        try { await controller.shutdown(); } catch { /* best effort */ }
        throw err;
      }

      state.controller = controller;
      state.owned = true;
      state.tracker.attach(controller);

      return c.json({
        initialized: true,
        teamName: controller.teamName,
      }, 201);
    } finally {
      state.initLock = false;
    }
  });

  api.post("/session/shutdown", async (c) => {
    if (state.initLock) {
      return c.json({ error: "Session operation in progress" }, 409);
    }
    state.initLock = true;

    try {
      const ctrl = getController(state);
      const wasOwned = state.owned;

      state.tracker.clear();
      state.controller = null;
      state.owned = false;

      if (wasOwned) {
        await ctrl.shutdown();
      }

      return c.json({ ok: true });
    } finally {
      state.initLock = false;
    }
  });

  // ─── Actions ─────────────────────────────────────────────────────────

  api.get("/actions", async (c) => {
    const ctrl = getController(state);
    const approvals = state.tracker.getPendingApprovals();
    const idleAgents = state.tracker.getIdleAgents();

    const tasks = await ctrl.tasks.list();
    const unassignedTasks = tasks
      .filter((t) => !t.owner && t.status !== "completed")
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        action: `POST /tasks/${t.id}/assign`,
      }));

    const pending =
      approvals.length + unassignedTasks.length + idleAgents.length;

    return c.json({ pending, approvals, unassignedTasks, idleAgents });
  });

  // ─── Agents ──────────────────────────────────────────────────────────

  api.get("/agents", async (c) => {
    const ctrl = getController(state);
    const config = await ctrl.team.getConfig();
    const agents = config.members
      .filter((m) => m.name !== "controller")
      .map((m) => ({
        name: m.name,
        type: m.agentType,
        model: m.model,
        running: ctrl.isAgentRunning(m.name),
      }));
    return c.json(agents);
  });

  api.post("/agents", async (c) => {
    const ctrl = getController(state);
    const body = await c.req.json<SpawnAgentBody>();
    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }
    validateName(body.name, "name");

    const agentType = body.type || "general-purpose";
    state.tracker.registerAgentType(body.name, agentType);

    // Merge first-class options into env
    const agentEnv: Record<string, string> = { ...body.env };
    if (body.apiKey) agentEnv.ANTHROPIC_AUTH_TOKEN = body.apiKey;
    if (body.baseUrl) agentEnv.ANTHROPIC_BASE_URL = body.baseUrl;
    if (body.timeout != null) agentEnv.API_TIMEOUT_MS = String(body.timeout);

    // Resolve permissions: preset string or raw tool array
    const permissionsArray = Array.isArray(body.permissions)
      ? body.permissions
      : undefined;
    const PRESET_MAP: Record<string, string> = {
      edit: "acceptEdits",
      plan: "plan",
      ask: "default",
    };
    const permissionMode =
      typeof body.permissions === "string" && !Array.isArray(body.permissions)
        ? (PRESET_MAP[body.permissions] as any)
        : undefined;

    const handle = await ctrl.spawnAgent({
      name: body.name,
      type: body.type,
      model: body.model,
      cwd: body.cwd,
      permissions: permissionsArray,
      permissionMode,
      env: Object.keys(agentEnv).length > 0 ? agentEnv : undefined,
    });

    return c.json(
      {
        name: handle.name,
        pid: handle.pid,
        running: handle.isRunning,
      },
      201
    );
  });

  api.get("/agents/:name", async (c) => {
    const ctrl = getController(state);
    const name = c.req.param("name");
    validateName(name, "name");
    const config = await ctrl.team.getConfig();
    const member = config.members.find((m) => m.name === name);
    if (!member) {
      return c.json({ error: `Agent "${name}" not found` }, 404);
    }
    return c.json({
      name: member.name,
      type: member.agentType,
      model: member.model,
      running: ctrl.isAgentRunning(name),
    });
  });

  api.post("/agents/:name/messages", async (c) => {
    const ctrl = getController(state);
    const name = c.req.param("name");
    validateName(name, "name");
    const body = await c.req.json<SendMessageBody>();
    if (!body.message) {
      return c.json({ error: "message is required" }, 400);
    }
    await ctrl.send(name, body.message, body.summary);
    return c.json({ ok: true });
  });

  api.post("/agents/:name/kill", async (c) => {
    const ctrl = getController(state);
    const name = c.req.param("name");
    validateName(name, "name");
    await ctrl.killAgent(name);
    return c.json({ ok: true });
  });

  api.post("/agents/:name/shutdown", async (c) => {
    const ctrl = getController(state);
    const name = c.req.param("name");
    validateName(name, "name");
    await ctrl.sendShutdownRequest(name);
    return c.json({ ok: true });
  });

  api.post("/agents/:name/approve", async (c) => {
    const ctrl = getController(state);
    const name = c.req.param("name");
    validateName(name, "name");
    const body = await c.req.json<ApproveBody>();
    if (!body.requestId) {
      return c.json({ error: "requestId is required" }, 400);
    }
    if (!body.type || !["plan", "permission"].includes(body.type)) {
      return c.json({ error: 'type must be "plan" or "permission"' }, 400);
    }

    if (body.type === "plan") {
      await ctrl.sendPlanApproval(name, body.requestId, body.approve ?? true, body.feedback);
    } else {
      await ctrl.sendPermissionResponse(name, body.requestId, body.approve ?? true);
    }
    state.tracker.resolveApproval(body.requestId);
    return c.json({ ok: true });
  });

  // ─── Broadcast ───────────────────────────────────────────────────────

  api.post("/broadcast", async (c) => {
    const ctrl = getController(state);
    const body = await c.req.json<BroadcastBody>();
    if (!body.message) {
      return c.json({ error: "message is required" }, 400);
    }
    await ctrl.broadcast(body.message, body.summary);
    return c.json({ ok: true });
  });

  // ─── Tasks ───────────────────────────────────────────────────────────

  api.get("/tasks", async (c) => {
    const ctrl = getController(state);
    const tasks = await ctrl.tasks.list();
    return c.json(tasks);
  });

  api.post("/tasks", async (c) => {
    const ctrl = getController(state);
    const body = await c.req.json<CreateTaskBody>();
    if (!body.subject || !body.description) {
      return c.json({ error: "subject and description are required" }, 400);
    }
    if (body.owner) validateName(body.owner, "owner");
    const taskId = await ctrl.createTask(body);
    const task = await ctrl.tasks.get(taskId);
    return c.json(task, 201);
  });


  api.get("/tasks/:id", async (c) => {
    const ctrl = getController(state);
    const id = c.req.param("id");
    validateTaskId(id);
    try {
      const task = await ctrl.tasks.get(id);
      return c.json(task);
    } catch (err) {
      if (isNotFoundError(err)) {
        return c.json({ error: `Task "${id}" not found` }, 404);
      }
      throw err;
    }
  });

  api.patch("/tasks/:id", async (c) => {
    const ctrl = getController(state);
    const id = c.req.param("id");
    validateTaskId(id);
    const body = await c.req.json<UpdateTaskBody>();
    try {
      const task = await ctrl.tasks.update(id, body);
      return c.json(task);
    } catch (err) {
      if (isNotFoundError(err)) {
        return c.json({ error: `Task "${id}" not found` }, 404);
      }
      throw err;
    }
  });

  api.delete("/tasks/:id", async (c) => {
    const ctrl = getController(state);
    const id = c.req.param("id");
    validateTaskId(id);
    try {
      await ctrl.tasks.get(id);
    } catch (err) {
      if (isNotFoundError(err)) {
        return c.json({ error: `Task "${id}" not found` }, 404);
      }
      throw err;
    }
    await ctrl.tasks.delete(id);
    return c.json({ ok: true });
  });

  api.post("/tasks/:id/assign", async (c) => {
    const ctrl = getController(state);
    const id = c.req.param("id");
    validateTaskId(id);
    const body = await c.req.json<AssignTaskBody>();
    if (!body.agent) {
      return c.json({ error: "agent is required" }, 400);
    }
    validateName(body.agent, "agent");
    try {
      await ctrl.tasks.get(id);
    } catch (err) {
      if (isNotFoundError(err)) {
        return c.json({ error: `Task "${id}" not found` }, 404);
      }
      throw err;
    }
    await ctrl.assignTask(id, body.agent);
    return c.json({ ok: true });
  });

  return api;
}
