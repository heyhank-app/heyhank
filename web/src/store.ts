import { create } from "zustand";
import type { AgentInfo, Approval, Message, SessionInfo } from "./types.js";

interface AppState {
  connected: boolean;
  session: SessionInfo | null;
  agents: Map<string, AgentInfo>;
  selectedAgent: string | null;
  messages: Map<string, Message[]>;
  pendingApprovals: Map<string, Approval>;

  setConnected: (v: boolean) => void;
  setSession: (s: SessionInfo | null) => void;
  addAgent: (a: AgentInfo) => void;
  updateAgent: (name: string, updates: Partial<AgentInfo>) => void;
  removeAgent: (name: string) => void;
  selectAgent: (name: string | null) => void;
  appendMessage: (agent: string, msg: Message) => void;
  addApproval: (a: Approval) => void;
  removeApproval: (id: string) => void;
  applySnapshot: (data: {
    session: SessionInfo;
    agents: AgentInfo[];
    messages: Record<string, Message[]>;
    pendingApprovals: Approval[];
  }) => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  connected: false,
  session: null,
  agents: new Map(),
  selectedAgent: null,
  messages: new Map(),
  pendingApprovals: new Map(),

  setConnected: (v) => set({ connected: v }),

  setSession: (s) => set({ session: s }),

  addAgent: (a) =>
    set((state) => {
      const agents = new Map(state.agents);
      agents.set(a.name, a);
      const messages = new Map(state.messages);
      if (!messages.has(a.name)) messages.set(a.name, []);
      return { agents, messages };
    }),

  updateAgent: (name, updates) =>
    set((state) => {
      const agents = new Map(state.agents);
      const existing = agents.get(name);
      if (existing) agents.set(name, { ...existing, ...updates });
      return { agents };
    }),

  removeAgent: (name) =>
    set((state) => {
      const agents = new Map(state.agents);
      agents.delete(name);
      return { agents };
    }),

  selectAgent: (name) => set({ selectedAgent: name }),

  appendMessage: (agent, msg) =>
    set((state) => {
      const messages = new Map(state.messages);
      const list = [...(messages.get(agent) || []), msg];
      messages.set(agent, list);
      return { messages };
    }),

  addApproval: (a) =>
    set((state) => {
      const pendingApprovals = new Map(state.pendingApprovals);
      pendingApprovals.set(a.id, a);
      return { pendingApprovals };
    }),

  removeApproval: (id) =>
    set((state) => {
      const pendingApprovals = new Map(state.pendingApprovals);
      pendingApprovals.delete(id);
      return { pendingApprovals };
    }),

  applySnapshot: (data) =>
    set(() => {
      const agents = new Map<string, AgentInfo>();
      for (const a of data.agents) agents.set(a.name, a);

      const messages = new Map<string, Message[]>();
      for (const [key, msgs] of Object.entries(data.messages)) {
        messages.set(key, msgs);
      }

      const pendingApprovals = new Map<string, Approval>();
      for (const a of data.pendingApprovals) pendingApprovals.set(a.id, a);

      return {
        session: data.session,
        agents,
        messages,
        pendingApprovals,
      };
    }),

  reset: () =>
    set({
      session: null,
      agents: new Map(),
      selectedAgent: null,
      messages: new Map(),
      pendingApprovals: new Map(),
    }),
}));
