import type { ClaudeCodeController } from "../controller.js";
import type {
  PlanApprovalRequestMessage,
  PermissionRequestMessage,
} from "../types.js";

export interface PendingApproval {
  type: "plan" | "permission";
  agent: string;
  requestId: string;
  timestamp: string;
  action: string;
  // plan-specific
  planContent?: string;
  // permission-specific
  toolName?: string;
  description?: string;
}

export interface IdleAgent {
  name: string;
  type: string;
  idleSince: string;
  action: string;
}

type BoundListener = { event: string; fn: (...args: unknown[]) => void };

/**
 * Listens to controller events and maintains an in-memory snapshot
 * of all actions that need attention (approvals, idle agents).
 */
export class ActionTracker {
  private approvals = new Map<string, PendingApproval>();
  private idles = new Map<string, IdleAgent>();
  private agentTypes = new Map<string, string>();
  private listeners: BoundListener[] = [];
  private currentController: ClaudeCodeController | null = null;

  attach(controller: ClaudeCodeController): void {
    // Detach from previous controller first to avoid listener leaks
    this.detach();
    this.currentController = controller;

    const onPlan = (agent: string, parsed: PlanApprovalRequestMessage) => {
      this.approvals.set(parsed.requestId, {
        type: "plan",
        agent,
        requestId: parsed.requestId,
        timestamp: parsed.timestamp,
        planContent: parsed.planContent,
        action: `POST /agents/${agent}/approve`,
      });
    };

    const onPermission = (agent: string, parsed: PermissionRequestMessage) => {
      this.approvals.set(parsed.requestId, {
        type: "permission",
        agent,
        requestId: parsed.requestId,
        timestamp: parsed.timestamp,
        toolName: parsed.toolName,
        description: parsed.description,
        action: `POST /agents/${agent}/approve`,
      });
    };

    const onIdle = (agent: string) => {
      this.idles.set(agent, {
        name: agent,
        type: this.agentTypes.get(agent) ?? "unknown",
        idleSince: new Date().toISOString(),
        action: `POST /agents/${agent}/messages`,
      });
    };

    const onMessage = (agent: string) => {
      this.idles.delete(agent);
    };

    const onSpawned = (agent: string) => {
      this.idles.delete(agent);
    };

    const onExited = (agent: string) => {
      this.idles.delete(agent);
      // Clean up stale approvals from the dead agent
      for (const [id, approval] of this.approvals) {
        if (approval.agent === agent) {
          this.approvals.delete(id);
        }
      }
    };

    controller.on("plan:approval_request", onPlan);
    controller.on("permission:request", onPermission);
    controller.on("idle", onIdle);
    controller.on("message", onMessage);
    controller.on("agent:spawned", onSpawned);
    controller.on("agent:exited", onExited);

    this.listeners = [
      { event: "plan:approval_request", fn: onPlan as (...args: unknown[]) => void },
      { event: "permission:request", fn: onPermission as (...args: unknown[]) => void },
      { event: "idle", fn: onIdle as (...args: unknown[]) => void },
      { event: "message", fn: onMessage as (...args: unknown[]) => void },
      { event: "agent:spawned", fn: onSpawned as (...args: unknown[]) => void },
      { event: "agent:exited", fn: onExited as (...args: unknown[]) => void },
    ];
  }

  /** Remove all event listeners from the current controller. */
  detach(): void {
    if (this.currentController) {
      for (const { event, fn } of this.listeners) {
        this.currentController.removeListener(event, fn);
      }
    }
    this.listeners = [];
    this.currentController = null;
  }

  /** Track agent type so idle entries have the right type. */
  registerAgentType(name: string, type: string): void {
    this.agentTypes.set(name, type);
  }

  resolveApproval(requestId: string): void {
    this.approvals.delete(requestId);
  }

  getPendingApprovals(): PendingApproval[] {
    return Array.from(this.approvals.values());
  }

  getIdleAgents(): IdleAgent[] {
    return Array.from(this.idles.values());
  }

  /** Clear all tracked state AND detach from the controller. */
  clear(): void {
    this.detach();
    this.approvals.clear();
    this.idles.clear();
    this.agentTypes.clear();
  }
}
