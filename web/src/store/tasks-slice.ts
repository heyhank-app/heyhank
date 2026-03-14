import type { StateCreator } from "zustand";
import type { AppState } from "./index.js";
import type { TaskItem, ProcessItem, ProcessStatus } from "../types.js";

export interface TasksSlice {
  sessionTasks: Map<string, TaskItem[]>;
  sessionProcesses: Map<string, ProcessItem[]>;
  changedFilesTick: Map<string, number>;
  gitChangedFilesCount: Map<string, number>;
  toolProgress: Map<string, Map<string, { toolName: string; elapsedSeconds: number }>>;

  addTask: (sessionId: string, task: TaskItem) => void;
  setTasks: (sessionId: string, tasks: TaskItem[]) => void;
  updateTask: (sessionId: string, taskId: string, updates: Partial<TaskItem>) => void;
  addProcess: (sessionId: string, process: ProcessItem) => void;
  updateProcess: (sessionId: string, taskId: string, updates: Partial<ProcessItem>) => void;
  updateProcessByToolUseId: (sessionId: string, toolUseId: string, updates: Partial<ProcessItem>) => void;
  bumpChangedFilesTick: (sessionId: string) => void;
  setGitChangedFilesCount: (sessionId: string, count: number) => void;
  setToolProgress: (sessionId: string, toolUseId: string, data: { toolName: string; elapsedSeconds: number }) => void;
  clearToolProgress: (sessionId: string, toolUseId?: string) => void;
}

export const createTasksSlice: StateCreator<AppState, [], [], TasksSlice> = (set) => ({
  sessionTasks: new Map(),
  sessionProcesses: new Map(),
  changedFilesTick: new Map(),
  gitChangedFilesCount: new Map(),
  toolProgress: new Map(),

  addTask: (sessionId, task) =>
    set((s) => {
      const sessionTasks = new Map(s.sessionTasks);
      const tasks = [...(sessionTasks.get(sessionId) || []), task];
      sessionTasks.set(sessionId, tasks);
      return { sessionTasks };
    }),

  setTasks: (sessionId, tasks) =>
    set((s) => {
      const sessionTasks = new Map(s.sessionTasks);
      sessionTasks.set(sessionId, tasks);
      return { sessionTasks };
    }),

  updateTask: (sessionId, taskId, updates) =>
    set((s) => {
      const sessionTasks = new Map(s.sessionTasks);
      const tasks = sessionTasks.get(sessionId);
      if (tasks) {
        sessionTasks.set(
          sessionId,
          tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
        );
      }
      return { sessionTasks };
    }),

  addProcess: (sessionId, process) =>
    set((s) => {
      const sessionProcesses = new Map(s.sessionProcesses);
      const processes = [...(sessionProcesses.get(sessionId) || []), process];
      sessionProcesses.set(sessionId, processes);
      return { sessionProcesses };
    }),

  updateProcess: (sessionId, taskId, updates) =>
    set((s) => {
      const sessionProcesses = new Map(s.sessionProcesses);
      const processes = sessionProcesses.get(sessionId);
      if (processes) {
        sessionProcesses.set(
          sessionId,
          processes.map((p) => (p.taskId === taskId ? { ...p, ...updates } : p)),
        );
      }
      return { sessionProcesses };
    }),

  updateProcessByToolUseId: (sessionId, toolUseId, updates) =>
    set((s) => {
      const sessionProcesses = new Map(s.sessionProcesses);
      const processes = sessionProcesses.get(sessionId);
      if (processes) {
        sessionProcesses.set(
          sessionId,
          processes.map((p) => (p.toolUseId === toolUseId ? { ...p, ...updates } : p)),
        );
      }
      return { sessionProcesses };
    }),

  bumpChangedFilesTick: (sessionId) =>
    set((s) => {
      const changedFilesTick = new Map(s.changedFilesTick);
      changedFilesTick.set(sessionId, (changedFilesTick.get(sessionId) ?? 0) + 1);
      return { changedFilesTick };
    }),

  setGitChangedFilesCount: (sessionId, count) =>
    set((s) => {
      const gitChangedFilesCount = new Map(s.gitChangedFilesCount);
      gitChangedFilesCount.set(sessionId, count);
      return { gitChangedFilesCount };
    }),

  setToolProgress: (sessionId, toolUseId, data) =>
    set((s) => {
      const toolProgress = new Map(s.toolProgress);
      const sessionProgress = new Map(toolProgress.get(sessionId) || []);
      sessionProgress.set(toolUseId, data);
      toolProgress.set(sessionId, sessionProgress);
      return { toolProgress };
    }),

  clearToolProgress: (sessionId, toolUseId) =>
    set((s) => {
      const toolProgress = new Map(s.toolProgress);
      if (toolUseId) {
        const sessionProgress = toolProgress.get(sessionId);
        if (sessionProgress) {
          const updated = new Map(sessionProgress);
          updated.delete(toolUseId);
          toolProgress.set(sessionId, updated);
        }
      } else {
        toolProgress.delete(sessionId);
      }
      return { toolProgress };
    }),
});
