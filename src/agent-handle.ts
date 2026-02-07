import type { ReceiveOptions, InboxMessage } from "./types.js";

/**
 * Interface for the controller methods that AgentHandle needs.
 * This avoids a circular dependency with the full controller.
 */
export interface AgentController {
  send(agentName: string, message: string, summary?: string): Promise<void>;
  receive(agentName: string, opts?: ReceiveOptions): Promise<InboxMessage[]>;
  killAgent(agentName: string): Promise<void>;
  sendShutdownRequest(agentName: string): Promise<void>;
  isAgentRunning(agentName: string): boolean;
}

/**
 * Proxy object for interacting with a specific agent.
 */
export class AgentHandle {
  readonly name: string;
  readonly pid: number | undefined;
  private controller: AgentController;

  constructor(
    controller: AgentController,
    name: string,
    pid: number | undefined
  ) {
    this.controller = controller;
    this.name = name;
    this.pid = pid;
  }

  /**
   * Send a message to this agent.
   */
  async send(message: string, summary?: string): Promise<void> {
    return this.controller.send(this.name, message, summary);
  }

  /**
   * Wait for a response from this agent.
   * Returns the text of the first unread plain-text message.
   */
  async receive(opts?: ReceiveOptions): Promise<string> {
    const messages = await this.controller.receive(this.name, opts);
    const texts = messages.map((m) => m.text);
    return texts.join("\n");
  }

  /**
   * Send a message and wait for the response. Convenience method.
   */
  async ask(question: string, opts?: ReceiveOptions): Promise<string> {
    await this.send(question);
    return this.receive(opts);
  }

  /**
   * Check if the agent process is still running.
   */
  get isRunning(): boolean {
    return this.controller.isAgentRunning(this.name);
  }

  /**
   * Request the agent to shut down gracefully.
   */
  async shutdown(): Promise<void> {
    return this.controller.sendShutdownRequest(this.name);
  }

  /**
   * Force-kill the agent process.
   */
  async kill(): Promise<void> {
    return this.controller.killAgent(this.name);
  }

  /**
   * Async iterator for agent events (messages from this agent).
   * Polls the controller's inbox for messages from this agent.
   */
  async *events(opts?: {
    pollInterval?: number;
    timeout?: number;
  }): AsyncGenerator<InboxMessage> {
    const interval = opts?.pollInterval ?? 500;
    const timeout = opts?.timeout ?? 0; // 0 = no timeout
    const deadline = timeout > 0 ? Date.now() + timeout : Infinity;

    while (Date.now() < deadline) {
      try {
        const messages = await this.controller.receive(this.name, {
          timeout: interval,
          pollInterval: interval,
        });
        for (const msg of messages) {
          yield msg;
        }
      } catch {
        // Timeout on receive, just continue polling
      }

      if (!this.isRunning) return;
    }
  }
}
