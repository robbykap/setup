/**
 * Background process lifecycle.
 *
 * Each task runs in its own process group (detached) so a kill reaches the
 * whole tree, not just the shell. stdin is ignored at the OS level: these
 * tasks are read-only by design, and a process blocking on a tty read that
 * never comes would hang forever.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import type { Task } from "./domain.ts";
import type { TaskStore } from "./store.ts";

export const MAX_BACKGROUND = 8;
const DEFAULT_KILL_GRACE_MS = 3_000;

export interface StartOptions {
  command: string;
  cwd: string;
  title?: string;
}

export interface Spawner {
  start(options: StartOptions): Task;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
}

interface Running {
  child: ChildProcess;
  exited: Promise<void>;
  killing?: Promise<void>;
}

export function createSpawner(
  store: TaskStore,
  options: { shell?: string; killGraceMs?: number } = {},
): Spawner {
  const shell = options.shell ?? "/bin/sh";
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const running = new Map<string, Running>();

  /** Signal the whole group; ESRCH just means it is already gone. */
  const signalGroup = (pid: number, signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already reaped.
      }
    }
  };

  const kill = async (id: string) => {
    const entry = running.get(id);
    if (!entry) return;
    if (entry.killing) return entry.killing;

    entry.killing = (async () => {
      const pid = entry.child.pid;
      if (pid !== undefined) {
        signalGroup(pid, "SIGTERM");
        const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), killGraceMs);
        // Bounded either way: SIGKILL cannot be trapped, so this resolves.
        await entry.exited;
        clearTimeout(timer);
      }
      const task = store.get(id);
      if (task?.status === "running") store.settle(id, { status: "killed" });
    })();

    return entry.killing;
  };

  store.onKillRequest((id) => {
    void kill(id);
  });

  return {
    start({ command, cwd, title }) {
      if (running.size >= MAX_BACKGROUND) {
        throw new Error(
          `Too many background tasks: at most ${MAX_BACKGROUND} may run at once. Kill one first.`,
        );
      }
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working directory is not a directory: ${cwd}`);
      }

      const task = store.add({ kind: "background", command, cwd, title });

      const child = spawn(shell, ["-c", command], {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let resolveExited!: () => void;
      const exited = new Promise<void>((resolve) => {
        resolveExited = resolve;
      });
      running.set(task.id, { child, exited });

      if (child.pid !== undefined) store.setPid(task.id, child.pid);
      child.stdout?.on("data", (chunk: Buffer) =>
        store.appendOutput(task.id, "stdout", chunk),
      );
      child.stderr?.on("data", (chunk: Buffer) =>
        store.appendOutput(task.id, "stderr", chunk),
      );

      child.on("error", (error: Error) => {
        running.delete(task.id);
        resolveExited();
        store.settle(task.id, { status: "failed", errorText: error.message });
      });

      child.on("close", (code, signal) => {
        running.delete(task.id);
        resolveExited();
        if (signal) {
          store.settle(task.id, { status: "killed", signal });
          return;
        }
        store.settle(task.id, {
          status: code === 0 ? "done" : "failed",
          exitCode: code ?? undefined,
        });
      });

      return task;
    },
    kill,
    async killAll() {
      await Promise.all([...running.keys()].map((id) => kill(id)));
    },
  };
}
