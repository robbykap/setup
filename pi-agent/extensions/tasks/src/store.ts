/**
 * The task list. Synchronous read model: producers (spawn, observe) write,
 * consumers (widget, overlays) read and subscribe. Nothing here knows about
 * processes or the TUI, which is what makes both sides testable in isolation.
 */

import {
  isKillable,
  toTitle,
  type StreamName,
  type Task,
  type TaskKind,
  type TaskStatus,
} from "./domain.ts";
import { createRingBuffer, type RingBuffer } from "./ring.ts";

/** Newest-first list cap. Running tasks are never evicted. */
export const MAX_TASKS = 50;

export interface NewTask {
  kind: TaskKind;
  command: string;
  cwd: string;
  title?: string;
  pid?: number;
}

export interface SettlePatch {
  status: Exclude<TaskStatus, "running">;
  exitCode?: number;
  signal?: string;
  errorText?: string;
}

export interface TaskStore {
  /** Newest first. */
  list(): readonly Task[];
  get(id: string): Task | undefined;
  size(): number;
  /** How many tasks the cap has evicted this session. */
  droppedCount(): number;
  runningBackgroundCount(): number;
  add(task: NewTask): Task;
  setPid(id: string, pid: number): void;
  appendOutput(id: string, stream: StreamName, chunk: Buffer | string): void;
  replaceOutput(id: string, text: string): void;
  settle(id: string, patch: SettlePatch): void;
  subscribe(listener: () => void): () => void;
  onSettled(listener: (task: Task) => void): () => void;
  onKillRequest(listener: (id: string) => void): () => void;
  requestKill(id: string): void;
  clear(): void;
}

interface Entry {
  task: Task;
  stdout: RingBuffer;
  stderr: RingBuffer;
}

const ID_PREFIX: Record<TaskKind, string> = {
  background: "b",
  foreground: "f",
  user: "u",
};

export function createTaskStore(
  options: { now?: () => number; limitBytes?: number } = {},
): TaskStore {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const order: string[] = []; // oldest first
  const counters: Record<TaskKind, number> = {
    background: 0,
    foreground: 0,
    user: 0,
  };
  const listeners = new Set<() => void>();
  const settledListeners = new Set<(task: Task) => void>();
  const killListeners = new Set<(id: string) => void>();
  let dropped = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Evict oldest settled entries until back under the cap. A list full of
   * running tasks simply grows: hiding live work would defeat the point. */
  const enforceCap = () => {
    while (order.length > MAX_TASKS) {
      const index = order.findIndex(
        (id) => entries.get(id)?.task.status !== "running",
      );
      if (index === -1) return;
      const [id] = order.splice(index, 1);
      entries.delete(id);
      dropped++;
    }
  };

  return {
    list() {
      const tasks: Task[] = [];
      for (let i = order.length - 1; i >= 0; i--) {
        const entry = entries.get(order[i]);
        if (entry) tasks.push(entry.task);
      }
      return tasks;
    },
    get(id) {
      return entries.get(id)?.task;
    },
    size() {
      return entries.size;
    },
    droppedCount() {
      return dropped;
    },
    runningBackgroundCount() {
      let count = 0;
      for (const entry of entries.values()) {
        if (entry.task.kind === "background" && entry.task.status === "running") {
          count++;
        }
      }
      return count;
    },
    add(input) {
      const id = `${ID_PREFIX[input.kind]}${++counters[input.kind]}`;
      const stdout = createRingBuffer(options.limitBytes);
      const stderr = createRingBuffer(options.limitBytes);
      const task: Task = {
        id,
        kind: input.kind,
        title: toTitle(input.title ?? input.command),
        command: input.command,
        cwd: input.cwd,
        status: "running",
        pid: input.pid,
        startedAt: now(),
        merged: input.kind !== "background",
        stdout: stdout.view,
        stderr: stderr.view,
      };
      entries.set(id, { task, stdout, stderr });
      order.push(id);
      enforceCap();
      notify();
      return task;
    },
    setPid(id, pid) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.task.pid = pid;
      notify();
    },
    appendOutput(id, stream, chunk) {
      const entry = entries.get(id);
      if (!entry) return;
      const target =
        stream === "stderr" && !entry.task.merged ? entry.stderr : entry.stdout;
      target.append(chunk);
      notify();
    },
    replaceOutput(id, text) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stdout.replace(text);
      notify();
    },
    settle(id, patch) {
      const entry = entries.get(id);
      if (!entry || entry.task.status !== "running") return;
      Object.assign(entry.task, patch, { endedAt: now() });
      enforceCap();
      for (const listener of settledListeners) listener(entry.task);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSettled(listener) {
      settledListeners.add(listener);
      return () => settledListeners.delete(listener);
    },
    onKillRequest(listener) {
      killListeners.add(listener);
      return () => killListeners.delete(listener);
    },
    requestKill(id) {
      const task = entries.get(id)?.task;
      if (!task || !isKillable(task)) return;
      for (const listener of killListeners) listener(id);
    },
    clear() {
      entries.clear();
      order.length = 0;
      notify();
    },
  };
}
