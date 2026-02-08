import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const tempBase = mkdtempSync(join(tmpdir(), "cc-protocol-test-"));

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
}));

const { ClaudeCodeController } = await import("../src/controller.js");
const { writeInbox, readInbox, parseMessage } = await import(
  "../src/inbox.js"
);

// ─── 1. TeamMember protocol fields ──────────────────────────────────────────

describe("TeamMember protocol fields", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `tm-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("supports prompt, color, planModeRequired, backendType", async () => {
    await ctrl.team.addMember({
      agentId: `worker1@${teamName}`,
      name: "worker1",
      agentType: "general-purpose",
      model: "sonnet",
      prompt: "You are a code reviewer",
      color: "#FF6347",
      planModeRequired: true,
      backendType: "in-process",
      joinedAt: Date.now(),
      cwd: "/tmp",
    });

    const config = await ctrl.team.getConfig();
    const member = config.members.find(
      (m: { name: string }) => m.name === "worker1"
    );
    expect(member).toBeDefined();
    expect(member!.prompt).toBe("You are a code reviewer");
    expect(member!.color).toBe("#FF6347");
    expect(member!.planModeRequired).toBe(true);
    expect(member!.backendType).toBe("in-process");
    expect(member!.model).toBe("sonnet");
  });

  it("new fields are optional (backward compatible)", async () => {
    await ctrl.team.addMember({
      agentId: `worker2@${teamName}`,
      name: "worker2",
      agentType: "general-purpose",
      joinedAt: Date.now(),
      cwd: "/tmp",
    });

    const config = await ctrl.team.getConfig();
    const member = config.members.find(
      (m: { name: string }) => m.name === "worker2"
    );
    expect(member).toBeDefined();
    expect(member!.name).toBe("worker2");
    // Optional fields should be absent or undefined
    expect(member!.prompt).toBeUndefined();
    expect(member!.color).toBeUndefined();
    expect(member!.planModeRequired).toBeUndefined();
    expect(member!.backendType).toBeUndefined();
  });
});

// ─── 2. Idle notification with details ──────────────────────────────────────

describe("Idle notification with details", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `idle-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("idle event passes IdleNotificationMessage details", async () => {
    const result = new Promise<{ name: string; details: any }>((resolve) => {
      ctrl.on("idle", (name: string, details: any) =>
        resolve({ name, details })
      );
    });

    const idle = JSON.stringify({
      type: "idle_notification",
      from: "worker1",
      timestamp: new Date().toISOString(),
      idleReason: "available",
      summary: "Completed research task",
      completedTaskId: "42",
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: idle,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const { name, details } = await result;
    expect(name).toBe("worker1");
    expect(details.idleReason).toBe("available");
    expect(details.summary).toBe("Completed research task");
    expect(details.completedTaskId).toBe("42");
  });

  it("idle event includes completedStatus and failureReason", async () => {
    const result = new Promise<{ name: string; details: any }>((resolve) => {
      ctrl.on("idle", (name: string, details: any) =>
        resolve({ name, details })
      );
    });

    const idle = JSON.stringify({
      type: "idle_notification",
      from: "worker1",
      timestamp: new Date().toISOString(),
      idleReason: "available",
      completedStatus: "failed",
      failureReason: "API rate limit exceeded",
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: idle,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const { details } = await result;
    expect(details.completedStatus).toBe("failed");
    expect(details.failureReason).toBe("API rate limit exceeded");
  });
});

// ─── 3. New structured message types ────────────────────────────────────────

describe("New structured message types", () => {
  it("parses task_completed messages", () => {
    const inner = {
      type: "task_completed",
      from: "worker1",
      taskId: "3",
      taskSubject: "Fix bug",
      timestamp: new Date().toISOString(),
    };
    const msg = {
      from: "worker1",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("task_completed");
    if (parsed.type === "task_completed") {
      expect(parsed.taskId).toBe("3");
      expect(parsed.taskSubject).toBe("Fix bug");
    }
  });

  it("parses sandbox_permission_request messages", () => {
    const inner = {
      type: "sandbox_permission_request",
      requestId: "sb-1",
      workerId: "w1",
      workerName: "worker1",
      hostPattern: "*.example.com",
      timestamp: new Date().toISOString(),
    };
    const msg = {
      from: "worker1",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("sandbox_permission_request");
    if (parsed.type === "sandbox_permission_request") {
      expect(parsed.requestId).toBe("sb-1");
      expect(parsed.workerId).toBe("w1");
      expect(parsed.workerName).toBe("worker1");
      expect(parsed.hostPattern).toBe("*.example.com");
    }
  });

  it("parses sandbox_permission_response messages", () => {
    const inner = {
      type: "sandbox_permission_response",
      requestId: "sb-1",
      host: "api.example.com",
      allow: true,
      timestamp: new Date().toISOString(),
    };
    const msg = {
      from: "controller",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("sandbox_permission_response");
    if (parsed.type === "sandbox_permission_response") {
      expect(parsed.requestId).toBe("sb-1");
      expect(parsed.host).toBe("api.example.com");
      expect(parsed.allow).toBe(true);
    }
  });

  it("parses idle_notification with summary field", () => {
    const inner = {
      type: "idle_notification",
      from: "agent1",
      timestamp: new Date().toISOString(),
      idleReason: "available",
      summary: "Done with task",
    };
    const msg = {
      from: "agent1",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("idle_notification");
    if (parsed.type === "idle_notification") {
      expect(parsed.summary).toBe("Done with task");
      expect(parsed.idleReason).toBe("available");
    }
  });

  it("parses plan_approval_request messages", () => {
    const inner = {
      type: "plan_approval_request",
      requestId: "plan-100",
      from: "coder",
      planContent: "Step 1: Do X\nStep 2: Do Y",
      timestamp: new Date().toISOString(),
    };
    const msg = {
      from: "coder",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("plan_approval_request");
    if (parsed.type === "plan_approval_request") {
      expect(parsed.requestId).toBe("plan-100");
      expect(parsed.planContent).toContain("Step 1");
    }
  });

  it("parses permission_request messages", () => {
    const inner = {
      type: "permission_request",
      requestId: "perm-99",
      from: "worker1",
      toolName: "Bash",
      description: "Run git status",
      timestamp: new Date().toISOString(),
    };
    const msg = {
      from: "worker1",
      text: JSON.stringify(inner),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("permission_request");
    if (parsed.type === "permission_request") {
      expect(parsed.toolName).toBe("Bash");
      expect(parsed.description).toBe("Run git status");
    }
  });

  it("falls back to plain_text for non-JSON", () => {
    const msg = {
      from: "worker1",
      text: "Just a regular message",
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("plain_text");
    if (parsed.type === "plain_text") {
      expect(parsed.text).toBe("Just a regular message");
    }
  });

  it("falls back to plain_text for JSON without type field", () => {
    const msg = {
      from: "worker1",
      text: JSON.stringify({ foo: "bar" }),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const parsed = parseMessage(msg);
    expect(parsed.type).toBe("plain_text");
  });
});

// ─── 4. Process spawn environment ───────────────────────────────────────────

describe("Process spawn environment", () => {
  it("includes CLAUDECODE=1 in spawn env", () => {
    const source = readFileSync(
      "/Users/stan/Dev/claude-code-api/src/process-manager.ts",
      "utf-8"
    );
    expect(source).toContain('CLAUDECODE: "1"');
    expect(source).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"');
  });

  it("uses python3 PTY wrapper for process spawning", () => {
    const source = readFileSync(
      "/Users/stan/Dev/claude-code-api/src/process-manager.ts",
      "utf-8"
    );
    expect(source).toContain("python3");
    expect(source).toContain("pty.fork()");
  });

  it("passes --teammate-mode flag to claude binary", () => {
    const source = readFileSync(
      "/Users/stan/Dev/claude-code-api/src/process-manager.ts",
      "utf-8"
    );
    expect(source).toContain("--teammate-mode");
    expect(source).toContain("--agent-id");
    expect(source).toContain("--agent-name");
    expect(source).toContain("--team-name");
  });
});

// ─── 5. Protocol round-trip tests ───────────────────────────────────────────

describe("Protocol round-trip tests", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `rt-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("idle notification round-trip preserves summary", async () => {
    const result = new Promise<{ name: string; details: any }>((resolve) => {
      ctrl.on("idle", (name: string, details: any) =>
        resolve({ name, details })
      );
    });

    const idle = JSON.stringify({
      type: "idle_notification",
      from: "worker1",
      timestamp: new Date().toISOString(),
      idleReason: "available",
      summary: "Finished implementing feature X",
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: idle,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const { name, details } = await result;
    expect(name).toBe("worker1");
    expect(details.summary).toBe("Finished implementing feature X");
    expect(details.idleReason).toBe("available");
    expect(details.type).toBe("idle_notification");
  });

  it("task_completed is emitted as message event", async () => {
    const msgPromise = new Promise<{ name: string; msg: any }>((resolve) => {
      ctrl.on("message", (name: string, msg: any) =>
        resolve({ name, msg })
      );
    });

    const completed = JSON.stringify({
      type: "task_completed",
      from: "worker1",
      taskId: "5",
      taskSubject: "Review code",
      timestamp: new Date().toISOString(),
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: completed,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const result = await msgPromise;
    expect(result.name).toBe("worker1");
  });

  it("shutdown_approved is recognized (not shutdown_response)", async () => {
    const approvedPromise = new Promise<{ name: string; msg: any }>(
      (resolve) => {
        ctrl.on("shutdown:approved", (name: string, msg: any) =>
          resolve({ name, msg })
        );
      }
    );

    const msg = JSON.stringify({
      type: "shutdown_approved",
      requestId: "shutdown-rt-1@worker1",
      from: "worker1",
      timestamp: new Date().toISOString(),
      paneId: "pane-rt-1",
      backendType: "tmux",
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: msg,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const result = await approvedPromise;
    expect(result.name).toBe("worker1");
    expect(result.msg.type).toBe("shutdown_approved");
    expect(result.msg.requestId).toBe("shutdown-rt-1@worker1");
    expect(result.msg.paneId).toBe("pane-rt-1");
    expect(result.msg.backendType).toBe("tmux");
  });

  it("full permission flow: request -> event -> response -> inbox", async () => {
    const permPromise = new Promise<{ name: string; msg: any }>((resolve) => {
      ctrl.on("permission:request", (name: string, msg: any) =>
        resolve({ name, msg })
      );
    });

    const req = JSON.stringify({
      type: "permission_request",
      requestId: "perm-flow-1",
      from: "worker1",
      toolName: "Bash",
      description: "Run git status",
      timestamp: new Date().toISOString(),
    });
    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: req,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const { name, msg } = await permPromise;
    expect(name).toBe("worker1");
    expect(msg.requestId).toBe("perm-flow-1");

    await ctrl.sendPermissionResponse(name, msg.requestId, true);

    const inbox = await readInbox(teamName, "worker1");
    expect(inbox.length).toBeGreaterThan(0);
    const response = JSON.parse(inbox[0].text);
    expect(response.type).toBe("permission_response");
    expect(response.approved).toBe(true);
    expect(response.requestId).toBe("perm-flow-1");
  });

  it("full plan approval flow: request -> event -> response -> inbox", async () => {
    const planPromise = new Promise<{ name: string; msg: any }>((resolve) => {
      ctrl.on("plan:approval_request", (name: string, msg: any) =>
        resolve({ name, msg })
      );
    });

    const req = JSON.stringify({
      type: "plan_approval_request",
      requestId: "plan-flow-1",
      from: "coder",
      planContent: "1. Refactor module\n2. Add tests",
      timestamp: new Date().toISOString(),
    });
    await writeInbox(teamName, "controller", {
      from: "coder",
      text: req,
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const { name, msg } = await planPromise;
    expect(name).toBe("coder");
    expect(msg.requestId).toBe("plan-flow-1");
    expect(msg.planContent).toContain("Refactor module");

    await ctrl.sendPlanApproval(name, msg.requestId, true, "Looks good");

    const inbox = await readInbox(teamName, "coder");
    expect(inbox.length).toBeGreaterThan(0);
    const response = JSON.parse(inbox[0].text);
    expect(response.type).toBe("plan_approval_response");
    expect(response.approved).toBe(true);
    expect(response.feedback).toBe("Looks good");
    expect(response.requestId).toBe("plan-flow-1");
  });

  it("plain text messages arrive as message events", async () => {
    const msgPromise = new Promise<{ name: string; msg: any }>((resolve) => {
      ctrl.on("message", (name: string, msg: any) =>
        resolve({ name, msg })
      );
    });

    await writeInbox(teamName, "controller", {
      from: "worker1",
      text: "Hello from worker1",
      timestamp: new Date().toISOString(),
    });
    // @ts-expect-error accessing private
    await ctrl.poller.poll();

    const result = await msgPromise;
    expect(result.name).toBe("worker1");
    expect(result.msg.text).toBe("Hello from worker1");
  });
});

// ─── 6. Broadcast protocol ──────────────────────────────────────────────────

describe("Broadcast protocol", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `bc-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("writes to N separate inbox files", async () => {
    // Add 3 members
    for (const name of ["agent1", "agent2", "agent3"]) {
      await ctrl.team.addMember({
        agentId: `${name}@${teamName}`,
        name,
        agentType: "general-purpose",
        joinedAt: Date.now(),
        cwd: "/tmp",
      });
    }

    await ctrl.broadcast("Team announcement", "announcement");

    const inbox1 = await readInbox(teamName, "agent1");
    const inbox2 = await readInbox(teamName, "agent2");
    const inbox3 = await readInbox(teamName, "agent3");

    expect(inbox1).toHaveLength(1);
    expect(inbox1[0].text).toBe("Team announcement");
    expect(inbox1[0].from).toBe("controller");
    expect(inbox1[0].summary).toBe("announcement");

    expect(inbox2).toHaveLength(1);
    expect(inbox2[0].text).toBe("Team announcement");

    expect(inbox3).toHaveLength(1);
    expect(inbox3[0].text).toBe("Team announcement");
  });

  it("excludes controller from broadcast", async () => {
    await ctrl.team.addMember({
      agentId: `worker1@${teamName}`,
      name: "worker1",
      agentType: "general-purpose",
      joinedAt: Date.now(),
      cwd: "/tmp",
    });

    await ctrl.broadcast("Test broadcast");

    const ctrlInbox = await readInbox(teamName, "controller");
    expect(ctrlInbox).toHaveLength(0);

    const workerInbox = await readInbox(teamName, "worker1");
    expect(workerInbox).toHaveLength(1);
  });
});

// ─── 7. Agent identity format ───────────────────────────────────────────────

describe("Agent identity format", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `id-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("agentId follows name@teamName format", async () => {
    await ctrl.team.addMember({
      agentId: `worker1@${teamName}`,
      name: "worker1",
      agentType: "general-purpose",
      joinedAt: Date.now(),
      cwd: "/tmp",
    });

    const config = await ctrl.team.getConfig();
    const member = config.members.find(
      (m: { name: string }) => m.name === "worker1"
    );
    expect(member).toBeDefined();
    expect(member!.agentId).toBe(`worker1@${teamName}`);
    expect(member!.agentId).toMatch(/^[\w-]+@[\w-]+$/);
  });

  it("leadAgentId follows name@teamName format", async () => {
    const config = await ctrl.team.getConfig();
    expect(config.leadAgentId).toBe(`controller@${teamName}`);
    expect(config.leadAgentId).toMatch(/^[\w-]+@[\w-]+$/);
  });

  it("controller member has matching agentId", async () => {
    const config = await ctrl.team.getConfig();
    const ctrlMember = config.members.find(
      (m: { name: string }) => m.name === "controller"
    );
    expect(ctrlMember).toBeDefined();
    expect(ctrlMember!.agentId).toBe(config.leadAgentId);
  });
});

// ─── 8. Workspace trust ────────────────────────────────────────────────────

describe("Workspace trust — ensureWorkspaceTrusted", () => {
  it("creates .claude/settings.local.json in agent cwd if missing", async () => {
    const teamName = `trust-${randomUUID().slice(0, 8)}`;
    const agentCwd = mkdtempSync(join(tmpdir(), "cc-trust-test-"));

    const ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();

    // spawnAgent calls ensureWorkspaceTrusted internally.
    // We can't call spawnAgent without a real binary, so call the
    // private method directly via any-cast.
    (ctrl as any).ensureWorkspaceTrusted(agentCwd);

    const settingsPath = join(agentCwd, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);

    const content = readFileSync(settingsPath, "utf-8");
    expect(content.trim()).toBe("{}");

    await ctrl.shutdown();
  });

  it("does not overwrite existing .claude/settings.local.json", async () => {
    const teamName = `trust2-${randomUUID().slice(0, 8)}`;
    const agentCwd = mkdtempSync(join(tmpdir(), "cc-trust-test2-"));

    // Pre-create with custom content
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(agentCwd, ".claude"), { recursive: true });
    writeFileSync(
      join(agentCwd, ".claude", "settings.local.json"),
      '{"permissions":{"allow":["Bash(git:*)"]}}\n'
    );

    const ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();

    (ctrl as any).ensureWorkspaceTrusted(agentCwd);

    // Should NOT have been overwritten
    const content = readFileSync(
      join(agentCwd, ".claude", "settings.local.json"),
      "utf-8"
    );
    expect(content).toContain("Bash(git:*)");

    await ctrl.shutdown();
  });
});

// ─── 9. ask() idle handling ────────────────────────────────────────────────

describe("ask() resolves on idle when no message is sent", () => {
  let ctrl: InstanceType<typeof ClaudeCodeController>;
  let teamName: string;

  beforeEach(async () => {
    teamName = `idle-ask-${randomUUID().slice(0, 8)}`;
    ctrl = new ClaudeCodeController({ teamName, logLevel: "silent" });
    await ctrl.init();
  });

  afterEach(async () => {
    await ctrl.shutdown();
  });

  it("receive() returns idle message when agent goes idle without SendMessage", async () => {
    // Simulate: agent goes idle without sending a content message
    await writeInbox(teamName, "controller", {
      from: "worker",
      text: JSON.stringify({
        type: "idle_notification",
        from: "worker",
        timestamp: new Date().toISOString(),
        idleReason: "turn_complete",
        summary: "Agent finished without sending a message",
      }),
      timestamp: new Date().toISOString(),
    });

    // Controller's receive() should return the idle message as fallback
    const msgs = await ctrl.receive("worker", { timeout: 3_000 });
    expect(msgs.length).toBeGreaterThan(0);
    const parsed = JSON.parse(msgs[0].text);
    expect(parsed.type).toBe("idle_notification");
    expect(parsed.idleReason).toBe("turn_complete");
  });

  it("receive() prefers content messages over idle", async () => {
    // Write a content message AND an idle notification
    await writeInbox(teamName, "controller", {
      from: "worker",
      text: "The answer is 42",
      timestamp: new Date().toISOString(),
    });
    await writeInbox(teamName, "controller", {
      from: "worker",
      text: JSON.stringify({
        type: "idle_notification",
        from: "worker",
        timestamp: new Date().toISOString(),
        idleReason: "turn_complete",
      }),
      timestamp: new Date().toISOString(),
    });

    const msgs = await ctrl.receive("worker", { timeout: 3_000 });
    expect(msgs.length).toBe(1);
    // Should return the content message, not the idle
    expect(msgs[0].text).toBe("The answer is 42");
  });
});
