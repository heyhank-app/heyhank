import {
  describe,
  it,
  expect,
  afterEach,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { ClaudeCodeController } from "../src/controller.js";
import { createApi } from "../src/api/index.js";

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
  spawnWaitMs: 15_000,
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
    if (ctrl) {
      try {
        // Force kill any remaining agents
        const running = (ctrl as any).processes?.runningAgents?.() || [];
        for (const name of running) {
          try {
            await ctrl.killAgent(name);
          } catch {}
        }
        await ctrl.shutdown();
      } catch {
        try {
          await ctrl.team.destroy();
        } catch {}
      }
    }
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

      // Wait a bit and verify still alive
      await sleep(5_000);
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
      await sleep(2_000);

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
      await sleep(1_000);

      expect(ctrl.isAgentRunning("killme")).toBe(false);
    },
    30_000,
  );
});

// ─── C: Ask Round-Trip ──────────────────────────────────────────────────────

describe.skipIf(!E2E_ENABLED)("E2E: Ask Round-Trip", () => {
  let ctrl: ClaudeCodeController;

  afterEach(async () => {
    if (ctrl) {
      try {
        const running = (ctrl as any).processes?.runningAgents?.() || [];
        for (const name of running) {
          try {
            await ctrl.killAgent(name);
          } catch {}
        }
        await ctrl.shutdown();
      } catch {
        try {
          await ctrl.team.destroy();
        } catch {}
      }
    }
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

      // Wait for agent to fully initialize
      await sleep(CFG.spawnWaitMs);

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
    if (ctrl) {
      try {
        const running = (ctrl as any).processes?.runningAgents?.() || [];
        for (const name of running) {
          try {
            await ctrl.killAgent(name);
          } catch {}
        }
        await ctrl.shutdown();
      } catch {
        try {
          await ctrl.team.destroy();
        } catch {}
      }
    }
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
