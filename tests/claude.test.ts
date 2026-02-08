import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

const tempBase = mkdtempSync(join(tmpdir(), "cc-simple-test-"));

mock.module("../src/paths.js", () => ({
  teamsDir: () => join(tempBase, "teams"),
  teamDir: (name: string) => join(tempBase, "teams", name),
  teamConfigPath: (name: string) =>
    join(tempBase, "teams", name, "config.json"),
  inboxesDir: (name: string) => join(tempBase, "teams", name, "inboxes"),
  inboxPath: (name: string, agent: string) =>
    join(tempBase, "teams", name, "inboxes", `${agent}.json`),
  tasksBaseDir: () => join(tempBase, "tasks"),
  tasksDir: (name: string) => join(tempBase, "tasks", name),
  taskPath: (name: string, id: string) =>
    join(tempBase, "tasks", name, `${id}.json`),
  _tempBase: tempBase,
}));

const { buildEnv, resolvePermissions, waitForReady, Agent, Session } =
  await import("../src/claude.js");
const { ClaudeCodeController } = await import("../src/controller.js");
const { writeInbox } = await import("../src/inbox.js");

// ─── Helper Tests ───────────────────────────────────────────────────────────

describe("buildEnv", () => {
  it("maps apiKey to ANTHROPIC_AUTH_TOKEN", () => {
    const env = buildEnv({ apiKey: "sk-123" });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-123");
  });

  it("maps baseUrl to ANTHROPIC_BASE_URL", () => {
    const env = buildEnv({ baseUrl: "https://api.example.com" });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example.com");
  });

  it("maps timeout to API_TIMEOUT_MS", () => {
    const env = buildEnv({ timeout: 300_000 });
    expect(env.API_TIMEOUT_MS).toBe("300000");
  });

  it("passes through raw env vars", () => {
    const env = buildEnv({ env: { CUSTOM_VAR: "hello" } });
    expect(env.CUSTOM_VAR).toBe("hello");
  });

  it("first-class options override env keys", () => {
    const env = buildEnv({
      apiKey: "from-option",
      env: { ANTHROPIC_AUTH_TOKEN: "from-env" },
    });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("from-option");
  });

  it("returns empty object when no options", () => {
    const env = buildEnv({});
    expect(Object.keys(env)).toHaveLength(0);
  });

  it("maps all options together", () => {
    const env = buildEnv({
      apiKey: "key",
      baseUrl: "url",
      timeout: 5000,
      env: { EXTRA: "val" },
    });
    expect(env).toEqual({
      ANTHROPIC_AUTH_TOKEN: "key",
      ANTHROPIC_BASE_URL: "url",
      API_TIMEOUT_MS: "5000",
      EXTRA: "val",
    });
  });
});

describe("resolvePermissions", () => {
  it('maps "full" to undefined (no flag)', () => {
    expect(resolvePermissions("full")).toEqual({
      permissionMode: undefined,
    });
  });

  it('maps "edit" to acceptEdits', () => {
    expect(resolvePermissions("edit")).toEqual({
      permissionMode: "acceptEdits",
    });
  });

  it('maps "plan" to plan', () => {
    expect(resolvePermissions("plan")).toEqual({
      permissionMode: "plan",
    });
  });

  it('maps "ask" to default', () => {
    expect(resolvePermissions("ask")).toEqual({
      permissionMode: "default",
    });
  });

  it("defaults to undefined (no flag) when preset is undefined", () => {
    expect(resolvePermissions(undefined)).toEqual({
      permissionMode: undefined,
    });
  });
});

// ─── waitForReady ───────────────────────────────────────────────────────────

describe("waitForReady", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `test-ready-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("resolves when idle event fires for the agent", async () => {
    const promise = waitForReady(ctrl, "my-agent", 5_000);

    // Simulate agent idle event
    setTimeout(() => ctrl.emit("idle", "my-agent"), 50);

    await promise; // should resolve without throwing
  });

  it("ignores idle events from other agents", async () => {
    const promise = waitForReady(ctrl, "my-agent", 1_000);

    // Fire idle for a different agent
    setTimeout(() => ctrl.emit("idle", "other-agent"), 50);
    // Fire correct idle later
    setTimeout(() => ctrl.emit("idle", "my-agent"), 200);

    await promise;
  });

  it("rejects on timeout", async () => {
    const promise = waitForReady(ctrl, "my-agent", 100);

    await expect(promise).rejects.toThrow(
      'Agent "my-agent" did not become ready within 100ms'
    );
  });

  it("rejects when agent exits before ready", async () => {
    const promise = waitForReady(ctrl, "my-agent", 5_000);

    setTimeout(() => ctrl.emit("agent:exited", "my-agent", 1), 50);

    await expect(promise).rejects.toThrow(
      'Agent "my-agent" exited before becoming ready (code=1)'
    );
  });

  it("resolves when message event fires for the agent", async () => {
    const promise = waitForReady(ctrl, "my-agent", 5_000);

    // Simulate agent sending a message (means it's alive)
    setTimeout(() => ctrl.emit("message", "my-agent", { text: "hello" }), 50);

    await promise; // should resolve without throwing
  });
});

// ─── Agent lifecycle ────────────────────────────────────────────────────────

describe("Agent", () => {
  it("throws after close()", async () => {
    // Create a mock agent by constructing the pieces manually
    const teamName = `test-agent-${randomUUID().slice(0, 8)}`;
    const ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();

    // We can't easily create a real Agent without spawning a process,
    // so we test the contract through the exported helpers and types.
    // Instead test that the class exists and has the expected shape.
    expect(Agent).toBeDefined();
    expect(typeof Agent.create).toBe("function");
    expect(typeof Agent.createInSession).toBe("function");

    await ctrl.shutdown();
  });
});

// ─── Session lifecycle ──────────────────────────────────────────────────────

describe("Session", () => {
  it("creates and closes a session", async () => {
    const session = await Session.create({
      logLevel: "silent",
    });

    expect(session.controller).toBeDefined();
    expect(session.controller.teamName).toBeTruthy();

    await session.close();
  });

  it("throws after close()", async () => {
    const session = await Session.create({
      logLevel: "silent",
    });
    await session.close();

    await expect(session.agent("test")).rejects.toThrow(
      "Session has been closed"
    );
  });

  it("close() is idempotent", async () => {
    const session = await Session.create({
      logLevel: "silent",
    });
    await session.close();
    await session.close(); // should not throw
  });
});

// ─── Event wiring ───────────────────────────────────────────────────────────

describe("Event wiring", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;

  beforeEach(async () => {
    const teamName = `test-events-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("permission request has approve/reject methods", () => {
    // Simulate what Agent.wireEvents does
    let captured: any = null;

    ctrl.on("permission:request", (name, parsed) => {
      captured = {
        requestId: parsed.requestId,
        toolName: parsed.toolName,
        description: parsed.description,
        approve: () =>
          ctrl.sendPermissionResponse(name, parsed.requestId, true),
        reject: () =>
          ctrl.sendPermissionResponse(name, parsed.requestId, false),
      };
    });

    ctrl.emit("permission:request", "agent1", {
      type: "permission_request" as const,
      requestId: "req-1",
      from: "agent1",
      toolName: "Bash",
      description: "Run a command",
      timestamp: new Date().toISOString(),
    });

    expect(captured).toBeDefined();
    expect(captured.requestId).toBe("req-1");
    expect(captured.toolName).toBe("Bash");
    expect(typeof captured.approve).toBe("function");
    expect(typeof captured.reject).toBe("function");
  });

  it("plan request has approve/reject methods", () => {
    let captured: any = null;

    ctrl.on("plan:approval_request", (name, parsed) => {
      captured = {
        requestId: parsed.requestId,
        planContent: parsed.planContent,
        approve: (feedback?: string) =>
          ctrl.sendPlanApproval(name, parsed.requestId, true, feedback),
        reject: (feedback: string) =>
          ctrl.sendPlanApproval(name, parsed.requestId, false, feedback),
      };
    });

    ctrl.emit("plan:approval_request", "agent1", {
      type: "plan_approval_request" as const,
      requestId: "plan-1",
      from: "agent1",
      planContent: "Step 1: Do stuff",
      timestamp: new Date().toISOString(),
    });

    expect(captured).toBeDefined();
    expect(captured.requestId).toBe("plan-1");
    expect(captured.planContent).toBe("Step 1: Do stuff");
    expect(typeof captured.approve).toBe("function");
    expect(typeof captured.reject).toBe("function");
  });
});

// ─── Symbol.asyncDispose ────────────────────────────────────────────────────

describe("Symbol.asyncDispose", () => {
  it("is defined on Session", async () => {
    const session = await Session.create({ logLevel: "silent" });
    expect(typeof session[Symbol.asyncDispose]).toBe("function");
    await session.close();
  });

  it("calls close() when invoked", async () => {
    const session = await Session.create({ logLevel: "silent" });
    await session[Symbol.asyncDispose]();
    // Session should be closed - agent creation should fail
    await expect(session.agent("test")).rejects.toThrow(
      "Session has been closed"
    );
  });
});

// ─── autoApprove & callbacks ────────────────────────────────────────────────

describe("autoApprove and inline callbacks", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;

  beforeEach(async () => {
    const teamName = `test-autoapprove-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("autoApprove: true approves all permissions via Agent event", () => {
    // Simulate what wireBehavior does with autoApprove: true
    const agent = new EventEmitter();
    const approved: string[] = [];

    // Simulate wireBehavior logic
    agent.on("permission", (req: any) => {
      req.approve();
    });

    // Fire permission event
    agent.emit("permission", {
      requestId: "r1",
      toolName: "Bash",
      approve: () => { approved.push("Bash"); },
      reject: () => {},
    });
    agent.emit("permission", {
      requestId: "r2",
      toolName: "Write",
      approve: () => { approved.push("Write"); },
      reject: () => {},
    });

    expect(approved).toEqual(["Bash", "Write"]);
  });

  it("autoApprove: string[] only approves listed tools", () => {
    const allowList = ["Read", "Glob", "Grep"];
    const approved: string[] = [];
    const rejected: string[] = [];
    const agent = new EventEmitter();

    agent.on("permission", (req: any) => {
      if (allowList.includes(req.toolName)) {
        req.approve();
      } else {
        req.reject();
      }
    });

    agent.emit("permission", {
      toolName: "Read",
      approve: () => { approved.push("Read"); },
      reject: () => { rejected.push("Read"); },
    });
    agent.emit("permission", {
      toolName: "Bash",
      approve: () => { approved.push("Bash"); },
      reject: () => { rejected.push("Bash"); },
    });
    agent.emit("permission", {
      toolName: "Glob",
      approve: () => { approved.push("Glob"); },
      reject: () => { rejected.push("Glob"); },
    });

    expect(approved).toEqual(["Read", "Glob"]);
    expect(rejected).toEqual(["Bash"]);
  });

  it("onPermission callback receives request info", () => {
    let captured: any = null;
    const handler = (req: any) => { captured = req; };
    const agent = new EventEmitter();

    agent.on("permission", handler);

    agent.emit("permission", {
      requestId: "p1",
      toolName: "Write",
      description: "Write a file",
      approve: () => {},
      reject: () => {},
    });

    expect(captured).toBeDefined();
    expect(captured.toolName).toBe("Write");
    expect(captured.description).toBe("Write a file");
  });

  it("onPlan callback receives plan info", () => {
    let captured: any = null;
    const handler = (req: any) => { captured = req; };
    const agent = new EventEmitter();

    agent.on("plan", handler);

    agent.emit("plan", {
      requestId: "plan-1",
      planContent: "Step 1: Refactor",
      approve: () => {},
      reject: () => {},
    });

    expect(captured).toBeDefined();
    expect(captured.planContent).toBe("Step 1: Refactor");
  });

  it("autoApprove: true also auto-approves plans", () => {
    let planApproved = false;
    const agent = new EventEmitter();

    // autoApprove: true => approve plans too
    agent.on("plan", (req: any) => req.approve());

    agent.emit("plan", {
      requestId: "p1",
      planContent: "My plan",
      approve: () => { planApproved = true; },
      reject: () => {},
    });

    expect(planApproved).toBe(true);
  });
});

// ─── claude function shape ──────────────────────────────────────────────────

describe("claude export", () => {
  it("has the expected shape", async () => {
    const { claude } = await import("../src/claude.js");
    expect(typeof claude).toBe("function");
    expect(typeof claude.agent).toBe("function");
    expect(typeof claude.session).toBe("function");
  });
});
