import { describe, it, expect, mock } from "bun:test";
import { AgentHandle, type AgentController } from "../src/agent-handle.js";
import type { InboxMessage } from "../src/types.js";

function createMockController(
  overrides?: Partial<AgentController>
): AgentController {
  return {
    send: mock(async () => undefined),
    receive: mock(async () => []),
    killAgent: mock(async () => undefined),
    sendShutdownRequest: mock(async () => undefined),
    isAgentRunning: mock(() => true),
    ...overrides,
  };
}

describe("AgentHandle", () => {
  it("stores name and pid", () => {
    const ctrl = createMockController();
    const handle = new AgentHandle(ctrl, "worker", 1234);
    expect(handle.name).toBe("worker");
    expect(handle.pid).toBe(1234);
  });

  it("delegates send() to controller", async () => {
    const ctrl = createMockController();
    const handle = new AgentHandle(ctrl, "worker", 1234);

    await handle.send("Hello", "summary");
    expect(ctrl.send).toHaveBeenCalledWith("worker", "Hello", "summary");
  });

  it("delegates receive() and returns joined text", async () => {
    const messages: InboxMessage[] = [
      {
        from: "worker",
        text: "Line 1",
        timestamp: new Date().toISOString(),
        read: false,
      },
      {
        from: "worker",
        text: "Line 2",
        timestamp: new Date().toISOString(),
        read: false,
      },
    ];
    const ctrl = createMockController({
      receive: mock(async () => messages),
    });
    const handle = new AgentHandle(ctrl, "worker", 1234);

    const result = await handle.receive();
    expect(result).toBe("Line 1\nLine 2");
    expect(ctrl.receive).toHaveBeenCalledWith("worker", undefined);
  });

  it("ask() sends then receives", async () => {
    const messages: InboxMessage[] = [
      {
        from: "worker",
        text: "Answer: 4",
        timestamp: new Date().toISOString(),
        read: false,
      },
    ];
    const ctrl = createMockController({
      receive: mock(async () => messages),
    });
    const handle = new AgentHandle(ctrl, "worker", 1234);

    const result = await handle.ask("What is 2+2?", { timeout: 5000 });
    expect(ctrl.send).toHaveBeenCalledWith("worker", "What is 2+2?", undefined);
    expect(result).toBe("Answer: 4");
  });

  it("isRunning delegates to controller", () => {
    const ctrl = createMockController({
      isAgentRunning: mock(() => false),
    });
    const handle = new AgentHandle(ctrl, "worker", 1234);

    expect(handle.isRunning).toBe(false);
    expect(ctrl.isAgentRunning).toHaveBeenCalledWith("worker");
  });

  it("shutdown() delegates to controller", async () => {
    const ctrl = createMockController();
    const handle = new AgentHandle(ctrl, "worker", 1234);

    await handle.shutdown();
    expect(ctrl.sendShutdownRequest).toHaveBeenCalledWith("worker");
  });

  it("kill() delegates to controller", async () => {
    const ctrl = createMockController();
    const handle = new AgentHandle(ctrl, "worker", 1234);

    await handle.kill();
    expect(ctrl.killAgent).toHaveBeenCalledWith("worker");
  });

  it("handles undefined pid", () => {
    const ctrl = createMockController();
    const handle = new AgentHandle(ctrl, "worker", undefined);
    expect(handle.pid).toBeUndefined();
  });

  it("receive() passes options through", async () => {
    const ctrl = createMockController({
      receive: mock(async () => []),
    });
    const handle = new AgentHandle(ctrl, "worker", 1234);

    await handle.receive({ timeout: 30000, pollInterval: 1000 });
    expect(ctrl.receive).toHaveBeenCalledWith("worker", {
      timeout: 30000,
      pollInterval: 1000,
    });
  });

  it("events() yields messages from agent", async () => {
    let callCount = 0;
    const msg: InboxMessage = {
      from: "worker",
      text: "Event msg",
      timestamp: new Date().toISOString(),
      read: false,
    };

    const ctrl = createMockController({
      receive: mock(async () => {
        callCount++;
        if (callCount === 1) return [msg];
        throw new Error("timeout"); // Simulate timeout on subsequent calls
      }),
      isAgentRunning: mock(() => callCount < 3),
    });
    const handle = new AgentHandle(ctrl, "worker", 1234);

    const yielded: InboxMessage[] = [];
    for await (const m of handle.events({ pollInterval: 10, timeout: 200 })) {
      yielded.push(m);
      break; // Just get the first one
    }

    expect(yielded).toHaveLength(1);
    expect(yielded[0].text).toBe("Event msg");
  });
});
