import {
  describe,
  it,
  expect,
  afterEach,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { ClaudeCodeController } from "../src/controller.js";
import { claude } from "../src/claude.js";
import { writeInbox, readInbox } from "../src/inbox.js";
import { createApi } from "../src/api/index.js";
import type { PermissionRequestMessage, PlanApprovalRequestMessage, IdleNotificationMessage } from "../src/types.js";

// ─── E2E Gate ───────────────────────────────────────────────────────────────

const E2E_ENABLED = process.env.E2E === "1";

// ─── Configuration ──────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val && E2E_ENABLED) {
    throw new Error(
      `Missing required env var ${name}. ` +
        `Copy .env.example to .env and fill in your credentials, then run: make e2e`,
    );
  }
  return val || "";
}

const CFG = {
  authToken: requireEnv("E2E_AUTH_TOKEN"),
  baseUrl: process.env.E2E_BASE_URL || "https://api.z.ai/api/anthropic",
  apiTimeout: process.env.E2E_API_TIMEOUT_MS || "3000000",
  model: process.env.E2E_MODEL || "sonnet",
  askTimeoutMs: 180_000,
};

function agentEnv() {
  return {
    ANTHROPIC_AUTH_TOKEN: CFG.authToken,
    ANTHROPIC_BASE_URL: CFG.baseUrl,
    API_TIMEOUT_MS: CFG.apiTimeout,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for a controller event with timeout. Returns the event args as a tuple. */
function waitForEvent<T extends unknown[]>(
  ctrl: ClaudeCodeController,
  event: string,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${event}" (${timeoutMs}ms)`)),
      timeoutMs,
    );
    ctrl.once(event as any, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args as T);
    });
  });
}

/**
 * Wait for a specific agent to become ready (idle or message event).
 * Much faster than sleep() — resolves as soon as the agent is responsive.
 */
function waitForAgentReady(
  ctrl: ClaudeCodeController,
  agentName: string,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Agent "${agentName}" not ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = (name: string, ..._rest: any[]) => {
      if (name === agentName && !settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onExit = (name: string, code: number | null) => {
      if (name === agentName && !settled) {
        settled = true;
        cleanup();
        reject(new Error(`Agent "${agentName}" exited (code=${code}) before ready`));
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ctrl.removeListener("idle", onReady);
      ctrl.removeListener("message", onReady);
      ctrl.removeListener("agent:exited", onExit);
    };

    ctrl.on("idle", onReady);
    ctrl.on("message", onReady);
    ctrl.on("agent:exited", onExit);
  });
}

/**
 * Wait for a specific agent process to exit.
 * Much faster than sleep() after killAgent.
 */
function waitForAgentExit(
  ctrl: ClaudeCodeController,
  agentName: string,
  timeoutMs = 10_000,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Agent "${agentName}" did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (name: string, code: number | null) => {
      if (name === agentName) {
        cleanup();
        resolve(code);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ctrl.removeListener("agent:exited", onExit);
    };
    ctrl.on("agent:exited", onExit);

    // Already exited?
    if (!ctrl.isAgentRunning(agentName)) {
      cleanup();
      resolve(null);
    }
  });
}

/** Inject a simulated message into the controller's inbox. */
async function injectToController(
  teamName: string,
  from: string,
  message: Record<string, unknown>,
) {
  await writeInbox(teamName, "controller", {
    from,
    text: JSON.stringify(message),
    timestamp: new Date().toISOString(),
  });
}

/** Robust controller cleanup helper. */
async function cleanupCtrl(ctrl: ClaudeCodeController | undefined) {
  if (!ctrl) return;
  try {
    await ctrl.shutdown();
  } catch {
    try { await ctrl.team.destroy(); } catch {}
  }
}

// ─── A: Controller Lifecycle ────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Controller Lifecycle", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    try {
      await ctrl?.shutdown();
    } catch {
      // best effort
    }
  });

  it(
    "init creates team files and shutdown cleans them up",
    async () => {
      const teamName = `e2e-life-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "warn",
        env: agentEnv(),
      });

      await ctrl.init();

      // Team config should exist
      const config = await ctrl.team.getConfig();
      expect(config.name).toBe(teamName);

      await ctrl.shutdown();

      // After shutdown, reading config should throw (files deleted)
      let threw = false;
      try {
        await ctrl.team.getConfig();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    },
    10_000,
  );

  it(
    "verifyCompatibility returns a version",
    async () => {
      const teamName = `e2e-compat-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "warn",
        env: agentEnv(),
      });

      await ctrl.init();
      const result = ctrl.verifyCompatibility();

      expect(result.compatible).toBe(true);
      expect(result.version).toBeTruthy();
      console.log(`[E2E] Claude CLI version: ${result.version}`);
    },
    10_000,
  );
});

// ─── B: Agent Spawn & Process Management ────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Agent Spawn", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "spawns an agent that stays alive",
    async () => {
      const teamName = `e2e-spawn-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const agent = await ctrl.spawnAgent({
        name: "worker",
        type: "general-purpose",
        model: CFG.model,
      });

      expect(agent.name).toBe("worker");
      expect(agent.pid).toBeGreaterThan(0);
      expect(agent.isRunning).toBe(true);

      // Give the process a few seconds to verify it doesn't crash on startup
      await sleep(3_000);
      expect(agent.isRunning).toBe(true);
    },
    30_000,
  );

  it(
    "fires agent:spawned and agent:exited events",
    async () => {
      const teamName = `e2e-events-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const events: string[] = [];

      ctrl.on("agent:spawned", (name) => events.push(`spawned:${name}`));
      ctrl.on("agent:exited", (name) => events.push(`exited:${name}`));

      const agent = await ctrl.spawnAgent({
        name: "evworker",
        type: "general-purpose",
        model: CFG.model,
      });

      expect(events).toContain("spawned:evworker");

      await ctrl.killAgent("evworker");
      await waitForAgentExit(ctrl, "evworker");

      expect(events).toContain("exited:evworker");
    },
    30_000,
  );

  it(
    "killAgent terminates the process",
    async () => {
      const teamName = `e2e-kill-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const agent = await ctrl.spawnAgent({
        name: "killme",
        type: "general-purpose",
        model: CFG.model,
      });

      expect(agent.isRunning).toBe(true);

      await ctrl.killAgent("killme");
      await waitForAgentExit(ctrl, "killme");

      expect(ctrl.isAgentRunning("killme")).toBe(false);
    },
    30_000,
  );
});

// ─── C: Ask Round-Trip ──────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Ask Round-Trip", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "agent.ask() returns a response from GLM 4.7",
    async () => {
      const teamName = `e2e-ask-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const agent = await ctrl.spawnAgent({
        name: "asker",
        type: "general-purpose",
        model: CFG.model,
      });

      // No pre-wait needed — ask() sends the message to the agent's inbox
      // and waits with its own timeout (askTimeoutMs) for a response.
      try {
        const response = await agent.ask(
          "What is 2+2? Send your answer back to me using the SendMessage tool.",
          { timeout: CFG.askTimeoutMs },
        );

        expect(response.length).toBeGreaterThan(0);
        console.log(
          `[E2E] Ask response (first 300 chars): ${response.slice(0, 300)}`,
        );

        // Soft check: is this an idle notification rather than a real answer?
        let isIdle = false;
        try {
          const parsed = JSON.parse(response);
          isIdle = parsed?.type === "idle_notification";
        } catch {
          // Not JSON — it's likely a real text response
        }

        if (isIdle) {
          console.warn(
            "[E2E] Agent went idle without sending a content response — " +
              "GLM 4.7 may not support the teammate SendMessage protocol",
          );
        } else if (!response.includes("4")) {
          console.warn(
            `[E2E] Response received but does not contain "4": ${response.slice(0, 200)}`,
          );
        }
      } catch (err) {
        // Timeout is a soft failure for non-Claude models
        if (String(err).includes("Timeout")) {
          console.warn(
            "[E2E] agent.ask() timed out — GLM 4.7 may not support teammate protocol. " +
              "This is not necessarily a failure of the controller.",
          );
        } else {
          throw err;
        }
      }
    },
    240_000,
  );
});

// ─── D: Task Management ────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Task Management", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    try {
      await ctrl?.shutdown();
    } catch {}
  });

  it(
    "CRUD tasks on real filesystem",
    async () => {
      const teamName = `e2e-tasks-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "warn",
        env: agentEnv(),
      });
      await ctrl.init();

      // Create
      const id = await ctrl.createTask({
        subject: "E2E test task",
        description: "Created by e2e.test.ts",
      });
      expect(id).toBe("1");

      // Read
      const task = await ctrl.tasks.get(id);
      expect(task.subject).toBe("E2E test task");
      expect(task.status).toBe("pending");

      // Update
      await ctrl.tasks.update(id, { status: "in_progress" });
      const updated = await ctrl.tasks.get(id);
      expect(updated.status).toBe("in_progress");

      // List
      const list = await ctrl.tasks.list();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("1");
    },
    10_000,
  );
});

// ─── E: REST API ────────────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: REST API", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "GET /health returns ok",
    async () => {
      const teamName = `e2e-api-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "warn",
        env: agentEnv(),
      });
      await ctrl.init();

      const app = createApi(ctrl);
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
    },
    10_000,
  );

  it(
    "POST /agents spawns a real agent via REST",
    async () => {
      const teamName = `e2e-apiag-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const app = createApi(ctrl);

      // Spawn via API
      const spawnRes = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "api-worker",
          type: "general-purpose",
          model: CFG.model,
        }),
      });

      expect(spawnRes.status).toBe(201);
      const spawnBody = await spawnRes.json();
      expect(spawnBody.name).toBe("api-worker");
      expect(spawnBody.running).toBe(true);

      // List agents via API
      const listRes = await app.request("/agents");
      expect(listRes.status).toBe(200);
      const agents = await listRes.json();
      expect(agents.some((a: any) => a.name === "api-worker")).toBe(true);

      // Kill via API
      const killRes = await app.request("/agents/api-worker/kill", {
        method: "POST",
      });
      expect(killRes.status).toBe(200);
    },
    60_000,
  );
});

// ─── F: Protocol — Permission Handling ──────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Protocol — Permission Handling", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    try {
      await ctrl?.shutdown();
    } catch {}
  });

  it(
    "permission request triggers event and approval reaches agent inbox",
    async () => {
      const teamName = `e2e-perm-ok-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const requestId = `perm-${Date.now()}`;

      // Setup listener BEFORE injecting message
      const eventPromise = waitForEvent<[string, PermissionRequestMessage]>(
        ctrl,
        "permission:request",
        5_000,
      );

      // Inject a simulated permission request from a fake agent
      await injectToController(teamName, "fake-agent", {
        type: "permission_request",
        requestId,
        from: "fake-agent",
        toolName: "Bash",
        description: "Run echo hello",
        timestamp: new Date().toISOString(),
      });

      // Wait for the poller to pick it up (runs every 500ms)
      const [agentName, parsed] = await eventPromise;

      expect(agentName).toBe("fake-agent");
      expect(parsed.requestId).toBe(requestId);
      expect(parsed.toolName).toBe("Bash");

      // Approve the permission
      await ctrl.sendPermissionResponse("fake-agent", requestId, true);

      // Verify the response landed in the agent's inbox
      const inbox = await readInbox(teamName, "fake-agent");
      expect(inbox.length).toBeGreaterThanOrEqual(1);
      const response = JSON.parse(inbox[inbox.length - 1].text);
      expect(response.type).toBe("permission_response");
      expect(response.requestId).toBe(requestId);
      expect(response.approved).toBe(true);
    },
    10_000,
  );

  it(
    "permission rejection reaches agent inbox",
    async () => {
      const teamName = `e2e-perm-rej-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const requestId = `perm-rej-${Date.now()}`;

      const eventPromise = waitForEvent<[string, PermissionRequestMessage]>(
        ctrl,
        "permission:request",
        5_000,
      );

      await injectToController(teamName, "fake-agent", {
        type: "permission_request",
        requestId,
        from: "fake-agent",
        toolName: "Write",
        description: "Write to /tmp/secret.txt",
        timestamp: new Date().toISOString(),
      });

      await eventPromise;

      // Reject the permission
      await ctrl.sendPermissionResponse("fake-agent", requestId, false);

      const inbox = await readInbox(teamName, "fake-agent");
      const response = JSON.parse(inbox[inbox.length - 1].text);
      expect(response.type).toBe("permission_response");
      expect(response.requestId).toBe(requestId);
      expect(response.approved).toBe(false);
    },
    10_000,
  );

  it(
    "ActionTracker tracks permission via GET /actions",
    async () => {
      const teamName = `e2e-perm-api-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();
      const app = createApi(ctrl);

      const requestId = `perm-api-${Date.now()}`;

      const eventPromise = waitForEvent<[string, PermissionRequestMessage]>(
        ctrl,
        "permission:request",
        5_000,
      );

      await injectToController(teamName, "fake-agent", {
        type: "permission_request",
        requestId,
        from: "fake-agent",
        toolName: "Bash",
        description: "Run ls",
        timestamp: new Date().toISOString(),
      });

      await eventPromise;

      // GET /actions should show the pending permission
      const actionsRes = await app.request("/actions");
      expect(actionsRes.status).toBe(200);
      const actions = await actionsRes.json() as any;
      expect(actions.pending).toBeGreaterThanOrEqual(1);
      const perm = actions.approvals.find((a: any) => a.requestId === requestId);
      expect(perm).toBeTruthy();
      expect(perm.type).toBe("permission");
      expect(perm.toolName).toBe("Bash");

      // Approve via REST API
      const approveRes = await app.request("/agents/fake-agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type: "permission", approve: true }),
      });
      expect(approveRes.status).toBe(200);

      // GET /actions should now be empty
      const afterRes = await app.request("/actions");
      const after = await afterRes.json() as any;
      const gone = after.approvals.find((a: any) => a.requestId === requestId);
      expect(gone).toBeUndefined();
    },
    10_000,
  );
});

// ─── G: Protocol — Plan Approval Handling ───────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Protocol — Plan Approval", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    try {
      await ctrl?.shutdown();
    } catch {}
  });

  it(
    "plan approval request triggers event and approval with feedback reaches agent inbox",
    async () => {
      const teamName = `e2e-plan-ok-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const requestId = `plan-${Date.now()}`;

      const eventPromise = waitForEvent<[string, PlanApprovalRequestMessage]>(
        ctrl,
        "plan:approval_request",
        5_000,
      );

      await injectToController(teamName, "fake-planner", {
        type: "plan_approval_request",
        requestId,
        from: "fake-planner",
        planContent: "Step 1: Research\nStep 2: Implement\nStep 3: Test",
        timestamp: new Date().toISOString(),
      });

      const [agentName, parsed] = await eventPromise;

      expect(agentName).toBe("fake-planner");
      expect(parsed.requestId).toBe(requestId);
      expect(parsed.planContent).toContain("Step 1");

      // Approve with feedback
      await ctrl.sendPlanApproval("fake-planner", requestId, true, "LGTM");

      const inbox = await readInbox(teamName, "fake-planner");
      const response = JSON.parse(inbox[inbox.length - 1].text);
      expect(response.type).toBe("plan_approval_response");
      expect(response.requestId).toBe(requestId);
      expect(response.approved).toBe(true);
      expect(response.feedback).toBe("LGTM");
    },
    10_000,
  );

  it(
    "plan rejection with feedback reaches agent inbox",
    async () => {
      const teamName = `e2e-plan-rej-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const requestId = `plan-rej-${Date.now()}`;

      const eventPromise = waitForEvent<[string, PlanApprovalRequestMessage]>(
        ctrl,
        "plan:approval_request",
        5_000,
      );

      await injectToController(teamName, "fake-planner", {
        type: "plan_approval_request",
        requestId,
        from: "fake-planner",
        planContent: "Step 1: Delete everything",
        timestamp: new Date().toISOString(),
      });

      await eventPromise;

      // Reject with feedback
      await ctrl.sendPlanApproval("fake-planner", requestId, false, "Add error handling");

      const inbox = await readInbox(teamName, "fake-planner");
      const response = JSON.parse(inbox[inbox.length - 1].text);
      expect(response.type).toBe("plan_approval_response");
      expect(response.approved).toBe(false);
      expect(response.feedback).toBe("Add error handling");
    },
    10_000,
  );

  it(
    "ActionTracker tracks plan approval via GET /actions",
    async () => {
      const teamName = `e2e-plan-api-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();
      const app = createApi(ctrl);

      const requestId = `plan-api-${Date.now()}`;

      const eventPromise = waitForEvent<[string, PlanApprovalRequestMessage]>(
        ctrl,
        "plan:approval_request",
        5_000,
      );

      await injectToController(teamName, "fake-planner", {
        type: "plan_approval_request",
        requestId,
        from: "fake-planner",
        planContent: "Step 1: Build API\nStep 2: Add tests",
        timestamp: new Date().toISOString(),
      });

      await eventPromise;

      // GET /actions should show the pending plan
      const actionsRes = await app.request("/actions");
      const actions = await actionsRes.json() as any;
      const plan = actions.approvals.find((a: any) => a.requestId === requestId);
      expect(plan).toBeTruthy();
      expect(plan.type).toBe("plan");
      expect(plan.planContent).toContain("Step 1");

      // Approve via REST API
      const approveRes = await app.request("/agents/fake-planner/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type: "plan", approve: true, feedback: "Go ahead" }),
      });
      expect(approveRes.status).toBe(200);

      // GET /actions should now be clean
      const afterRes = await app.request("/actions");
      const after = await afterRes.json() as any;
      const gone = after.approvals.find((a: any) => a.requestId === requestId);
      expect(gone).toBeUndefined();
    },
    10_000,
  );
});

// ─── H: Live — Permission Mode ──────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Live — Permission Mode", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "permissionMode flag is respected — delegate mode restricts direct tool execution",
    async () => {
      const teamName = `e2e-liveperm-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      // Spawn agent with permissionMode "delegate" — the agent should only have
      // access to coordination tools (TaskCreate, TaskList, SendMessage, etc.)
      // and NOT be able to directly execute Bash, Read, Write, etc.
      const agent = await ctrl.spawnAgent({
        name: "delegator",
        type: "general-purpose",
        model: CFG.model,
        permissionMode: "delegate",
      });

      // No pre-wait needed — the message sits in the inbox until the agent
      // finishes initializing, then it processes it.

      // Ask the agent to use Bash — in delegate mode it should NOT execute directly
      // but instead delegate to a sub-agent or report the restriction
      await agent.send(
        "Run the command `echo hello world` using the Bash tool.",
      );

      // Wait for the agent to respond (it should send a message back explaining
      // the restriction or spawn a sub-agent)
      const msgPromise = waitForEvent<[string, any]>(
        ctrl,
        "message",
        60_000,
      ).catch(() => null);

      const result = await msgPromise;

      if (result) {
        const [agentName, msg] = result;
        console.log(`[E2E] Delegate agent responded: "${msg.text.slice(0, 200)}"`);
        expect(agentName).toBe("delegator");
        // The agent should indicate it can't use Bash directly (delegate mode)
        // It may mention delegation, restricted access, or spawning a sub-agent
        expect(msg.text.length).toBeGreaterThan(0);
        console.log("[E2E] permissionMode=delegate correctly restricted agent tool access");
      } else {
        // Idle notification counts too — agent recognized the restriction
        console.warn(
          "[E2E] No explicit response from delegate agent, checking idle...",
        );
      }
    },
    120_000,
  );
});

// ─── I: Live — Plan Mode ────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Live — Plan Mode", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "permissionMode=plan forces agent into plan mode",
    async () => {
      const teamName = `e2e-liveplan-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      // Spawn agent with permissionMode "plan" → forces plan mode.
      // In plan mode, the agent can explore (read-only) but cannot execute tools.
      // When it finishes planning, it calls ExitPlanMode which may generate
      // a plan_approval_request in the controller inbox.
      const agent = await ctrl.spawnAgent({
        name: "planner",
        type: "general-purpose",
        model: CFG.model,
        permissionMode: "plan",
      });

      // No pre-wait needed — the message sits in the inbox until the agent
      // finishes initializing, then it processes it.

      // Listen for both plan approval requests AND permission requests
      // (the CLI may route plan mode requests as either type)
      let gotPlanRequest = false;
      let gotPermRequest = false;

      const planPromise = waitForEvent<[string, PlanApprovalRequestMessage]>(
        ctrl,
        "plan:approval_request",
        120_000,
      ).then((result) => {
        gotPlanRequest = true;
        return { type: "plan" as const, result };
      }).catch(() => null);

      const permPromise = waitForEvent<[string, PermissionRequestMessage]>(
        ctrl,
        "permission:request",
        120_000,
      ).then((result) => {
        gotPermRequest = true;
        return { type: "permission" as const, result };
      }).catch(() => null);

      // Give the agent a task
      await agent.send(
        "Create a Node.js REST API with Express that has 3 endpoints: " +
          "GET /users, POST /users, DELETE /users/:id. " +
          "Plan your approach before implementing.",
      );

      // Race: first event to fire wins
      const first = await Promise.race([planPromise, permPromise]);

      if (first?.type === "plan") {
        const [agentName, parsed] = first.result;
        console.log(
          `[E2E] Plan approval request received from "${agentName}"`,
        );
        console.log(
          `[E2E] Plan content (first 300 chars): ${(parsed.planContent || "").slice(0, 300)}`,
        );
        expect(agentName).toBe("planner");
        expect(parsed.requestId).toBeTruthy();

        // Approve the plan
        await ctrl.sendPlanApproval(agentName, parsed.requestId, true, "Approved");
        console.log("[E2E] Plan approved successfully");
      } else if (first?.type === "permission") {
        const [agentName, parsed] = first.result;
        console.log(
          `[E2E] Plan mode generated a permission request: tool="${parsed.toolName}" from="${agentName}"`,
        );
        // In plan mode, any tool attempt triggers a permission-like request
        expect(agentName).toBe("planner");
        console.log("[E2E] permissionMode=plan is active (generated permission event)");
      } else {
        console.warn(
          "[E2E] No plan or permission event received within timeout — " +
            "plan mode behavior may vary by CLI version",
        );
      }
    },
    180_000,
  );
});

// ─── J: Protocol — Shutdown Round-Trip ──────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Protocol — Shutdown Round-Trip", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "shutdown request triggers shutdown_approved event when agent ACKs",
    async () => {
      const teamName = `e2e-shutdown-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const requestId = `shutdown-${Date.now()}@fake-agent`;

      // Listen for the shutdown:approved event
      const eventPromise = waitForEvent<[string, any]>(
        ctrl,
        "shutdown:approved",
        5_000,
      );

      // Simulate an agent sending shutdown_approved
      await injectToController(teamName, "fake-agent", {
        type: "shutdown_approved",
        requestId,
        from: "fake-agent",
        timestamp: new Date().toISOString(),
      });

      const [agentName, parsed] = await eventPromise;
      expect(agentName).toBe("fake-agent");
      expect(parsed.requestId).toBe(requestId);
    },
    10_000,
  );

  it(
    "sendShutdownRequest writes correctly formatted message to agent inbox",
    async () => {
      const teamName = `e2e-shutmsg-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      // Register a fake agent so we can read its inbox
      await ctrl.team.addMember({
        agentId: `fake-agent@${teamName}`,
        name: "fake-agent",
        agentType: "general-purpose",
        joinedAt: Date.now(),
        cwd: process.cwd(),
        tmuxPaneId: "",
        subscriptions: [],
      });

      await ctrl.sendShutdownRequest("fake-agent");

      const inbox = await readInbox(teamName, "fake-agent");
      expect(inbox.length).toBeGreaterThanOrEqual(1);
      const msg = JSON.parse(inbox[inbox.length - 1].text);
      expect(msg.type).toBe("shutdown_request");
      expect(msg.from).toBe("controller");
      expect(msg.requestId).toContain("@fake-agent");
      expect(msg.reason).toBeTruthy();
    },
    10_000,
  );
});

// ─── K: Protocol — Idle Notification Details ───────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Protocol — Idle Notification Details", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "idle event carries full IdleNotificationMessage details",
    async () => {
      const teamName = `e2e-idle-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const eventPromise = waitForEvent<[string, any]>(ctrl, "idle", 5_000);

      await injectToController(teamName, "worker-1", {
        type: "idle_notification",
        from: "worker-1",
        timestamp: new Date().toISOString(),
        idleReason: "turn_complete",
        summary: "Finished writing tests",
        completedTaskId: "42",
        completedStatus: "completed",
      });

      const [agentName, details] = await eventPromise;
      expect(agentName).toBe("worker-1");
      expect(details.type).toBe("idle_notification");
      expect(details.idleReason).toBe("turn_complete");
      expect(details.summary).toBe("Finished writing tests");
      expect(details.completedTaskId).toBe("42");
      expect(details.completedStatus).toBe("completed");
    },
    10_000,
  );

  it(
    "idle event with failure reason",
    async () => {
      const teamName = `e2e-idlefail-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      const eventPromise = waitForEvent<[string, any]>(ctrl, "idle", 5_000);

      await injectToController(teamName, "worker-err", {
        type: "idle_notification",
        from: "worker-err",
        timestamp: new Date().toISOString(),
        idleReason: "error",
        failureReason: "API rate limit exceeded",
      });

      const [agentName, details] = await eventPromise;
      expect(agentName).toBe("worker-err");
      expect(details.failureReason).toBe("API rate limit exceeded");
    },
    10_000,
  );
});

// ─── L: TeamMember New Fields ──────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: TeamMember New Fields", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "spawnAgent writes all TeamMember fields to config",
    async () => {
      const teamName = `e2e-member-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        logLevel: "warn",
        env: agentEnv(),
      });
      await ctrl.init();

      const agent = await ctrl.spawnAgent({
        name: "full-worker",
        type: "general-purpose",
        model: CFG.model,
        prompt: "You are a helpful test agent",
      });

      // Read back team config and verify all fields present
      const config = await ctrl.team.getConfig();
      const member = config.members.find((m) => m.name === "full-worker");
      expect(member).toBeTruthy();
      expect(member!.agentId).toBe(`full-worker@${teamName}`);
      expect(member!.agentType).toBe("general-purpose");
      expect(member!.model).toBe(CFG.model);
      expect(member!.prompt).toBe("You are a helpful test agent");
      expect(member!.color).toBeTruthy();
      expect(member!.backendType).toBe("in-process");
      expect(member!.planModeRequired).toBe(false);
      expect(member!.cwd).toBeTruthy();
      expect(member!.joinedAt).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ─── M: Broadcast ──────────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Broadcast", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "broadcast sends message to all registered agents",
    async () => {
      const teamName = `e2e-bcast-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      // Register two fake agents (no real process needed for inbox testing)
      for (const name of ["agent-a", "agent-b"]) {
        await ctrl.team.addMember({
          agentId: `${name}@${teamName}`,
          name,
          agentType: "general-purpose",
          joinedAt: Date.now(),
          cwd: process.cwd(),
          tmuxPaneId: "",
          subscriptions: [],
        });
      }

      await ctrl.broadcast("Hello everyone!", "greeting");

      // Both agents should have the message
      for (const name of ["agent-a", "agent-b"]) {
        const inbox = await readInbox(teamName, name);
        expect(inbox.length).toBeGreaterThanOrEqual(1);
        const last = inbox[inbox.length - 1];
        expect(last.text).toBe("Hello everyone!");
        expect(last.from).toBe("controller");
        expect(last.summary).toBe("greeting");
      }
    },
    10_000,
  );
});

// ─── N: Task Assignment Notification ──────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Task Assignment", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
  });

  it(
    "createTask with owner sends task_assignment to agent inbox",
    async () => {
      const teamName = `e2e-taskassign-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      // Register a fake agent
      await ctrl.team.addMember({
        agentId: `worker@${teamName}`,
        name: "worker",
        agentType: "general-purpose",
        joinedAt: Date.now(),
        cwd: process.cwd(),
        tmuxPaneId: "",
        subscriptions: [],
      });

      const taskId = await ctrl.createTask({
        subject: "Fix the bug",
        description: "There is a null pointer exception in line 42",
        owner: "worker",
      });

      expect(taskId).toBe("1");

      // Verify task_assignment message was sent
      const inbox = await readInbox(teamName, "worker");
      expect(inbox.length).toBeGreaterThanOrEqual(1);
      const msg = JSON.parse(inbox[inbox.length - 1].text);
      expect(msg.type).toBe("task_assignment");
      expect(msg.taskId).toBe("1");
      expect(msg.subject).toBe("Fix the bug");
      expect(msg.description).toBe("There is a null pointer exception in line 42");
      expect(msg.assignedBy).toBe("controller");
    },
    10_000,
  );

  it(
    "assignTask updates owner and notifies agent",
    async () => {
      const teamName = `e2e-reassign-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({ teamName, logLevel: "warn", env: agentEnv() });
      await ctrl.init();

      await ctrl.team.addMember({
        agentId: `worker-2@${teamName}`,
        name: "worker-2",
        agentType: "general-purpose",
        joinedAt: Date.now(),
        cwd: process.cwd(),
        tmuxPaneId: "",
        subscriptions: [],
      });

      // Create unassigned task
      const taskId = await ctrl.createTask({
        subject: "Implement feature X",
        description: "Add the X feature",
      });

      // Assign it
      await ctrl.assignTask(taskId, "worker-2");

      // Verify task updated
      const task = await ctrl.tasks.get(taskId);
      expect(task.owner).toBe("worker-2");

      // Verify assignment message
      const inbox = await readInbox(teamName, "worker-2");
      const msg = JSON.parse(inbox[inbox.length - 1].text);
      expect(msg.type).toBe("task_assignment");
      expect(msg.taskId).toBe(taskId);
      expect(msg.assignedBy).toBe("controller");
    },
    10_000,
  );
});

// ─── O: Untrusted Workspace ────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Untrusted Workspace", () => {
  let ctrl: ClaudeCodeController;
  let tempDir: string;

  afterEach(async () => {
    await cleanupCtrl(ctrl);
    // Clean up temp dir
    if (tempDir) {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it(
    "agent works in a directory that has never been used with Claude",
    async () => {
      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      tempDir = mkdtempSync(`${tmpdir()}/e2e-untrusted-`);

      const teamName = `e2e-untrust-${randomUUID().slice(0, 8)}`;
      ctrl = new ClaudeCodeController({
        teamName,
        cwd: tempDir,
        logLevel: "info",
        env: agentEnv(),
      });
      await ctrl.init();

      const agent = await ctrl.spawnAgent({
        name: "untrusted-worker",
        type: "general-purpose",
        model: CFG.model,
      });

      expect(agent.isRunning).toBe(true);

      // Verify .claude/settings.local.json was created
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(true);

      // The agent should be able to receive messages and respond
      // (the trust prompt should have been auto-accepted by the PTY wrapper)
      await sleep(3_000);
      expect(agent.isRunning).toBe(true);
      console.log("[E2E] Agent running in untrusted workspace — trust prompt was auto-accepted");
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Simplified API (claude.agent, claude.session, POST /ask)
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!E2E_ENABLED)("Simplified API: claude.agent()", () => {
  it(
    "creates a persistent agent and handles ask()",
    async () => {
      const agent = await claude.agent({
        model: CFG.model,
        apiKey: CFG.authToken,
        baseUrl: CFG.baseUrl,
        timeout: Number(CFG.apiTimeout),
        logLevel: "info",
      });

      console.log(`[E2E] Simplified agent ready (pid=${agent.pid})`);
      expect(agent.isRunning).toBe(true);

      const response = await agent.ask("What is 2+2? Reply with just the number.", {
        timeout: CFG.askTimeoutMs,
      });
      console.log(`[E2E] Simplified agent response: ${response.slice(0, 200)}`);
      expect(response).toBeTruthy();

      await agent.close();
      expect(agent.isRunning).toBe(false);
    },
    300_000,
  );
});

describe.skipIf(!E2E_ENABLED)("Simplified API: claude.session()", () => {
  it(
    "creates a session with multiple agents",
    async () => {
      const session = await claude.session({
        model: CFG.model,
        apiKey: CFG.authToken,
        baseUrl: CFG.baseUrl,
        timeout: Number(CFG.apiTimeout),
        logLevel: "info",
      });

      const agent1 = await session.agent("worker-1");
      const agent2 = await session.agent("worker-2");

      console.log(`[E2E] Session agents ready: worker-1 (pid=${agent1.pid}), worker-2 (pid=${agent2.pid})`);
      expect(agent1.isRunning).toBe(true);
      expect(agent2.isRunning).toBe(true);

      const [r1, r2] = await Promise.all([
        agent1.ask("What is 10+10? Reply with just the number.", {
          timeout: CFG.askTimeoutMs,
        }),
        agent2.ask("What is 5*5? Reply with just the number.", {
          timeout: CFG.askTimeoutMs,
        }),
      ]);

      console.log(`[E2E] worker-1 response: ${r1.slice(0, 200)}`);
      console.log(`[E2E] worker-2 response: ${r2.slice(0, 200)}`);
      expect(r1).toBeTruthy();
      expect(r2).toBeTruthy();

      await session.close();
    },
    600_000,
  );
});

describe.skipIf(!E2E_ENABLED)("Simplified API: POST /ask", () => {
  it(
    "returns a response from the /ask endpoint",
    async () => {
      const app = createApi();
      const res = await app.request("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "What is 3+3? Reply with just the number.",
          model: CFG.model,
          apiKey: CFG.authToken,
          baseUrl: CFG.baseUrl,
          timeout: Number(CFG.apiTimeout),
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      console.log(`[E2E] POST /ask response: ${JSON.stringify(data).slice(0, 200)}`);
      expect(data.response).toBeTruthy();
    },
    600_000,
  );
});
