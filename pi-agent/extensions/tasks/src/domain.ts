/**
 * Shared vocabulary for the tasks extension.
 *
 * A Task is one shell command the session knows about. Three kinds exist:
 * - background: this extension spawned it, owns the pid, and can kill it.
 * - foreground: Pi's own bash tool ran it; mirrored from events, merged output.
 * - user: the user ran it with `!`; same shape as foreground.
 */

export type TaskKind = "background" | "foreground" | "user";
export type TaskStatus = "running" | "done" | "failed" | "killed";
export type FilterMode = "all" | "background" | "failed";
export type StreamName = "stdout" | "stderr";

/** A bounded window onto one output stream. Backed by a ring buffer, so the
 * object identity is stable while the fields change underneath. */
export interface OutputView {
  readonly text: string;
  readonly totalBytes: number;
  readonly droppedBytes: number;
}

export interface Task {
  id: string;
  kind: TaskKind;
  /** Short label for the list row. Whitespace-collapsed, <= 80 chars. */
  title: string;
  command: string;
  cwd: string;
  status: TaskStatus;
  pid?: number;
  exitCode?: number;
  signal?: string;
  errorText?: string;
  startedAt: number;
  endedAt?: number;
  stdout: OutputView;
  stderr: OutputView;
  /** True when stdout holds combined output and stderr is unused. */
  merged: boolean;
}

export const FILTER_MODES: readonly FilterMode[] = ["all", "background", "failed"];

export function nextFilter(mode: FilterMode): FilterMode {
  const index = FILTER_MODES.indexOf(mode);
  return FILTER_MODES[(index + 1) % FILTER_MODES.length];
}

export function filterTasks(
  tasks: readonly Task[],
  mode: FilterMode,
): readonly Task[] {
  switch (mode) {
    case "all":
      return tasks;
    case "background":
      return tasks.filter((task) => task.kind === "background");
    case "failed":
      return tasks.filter((task) => task.status === "failed");
  }
}

/** m:ss, frozen at the settle time so finished rows stop ticking. */
export function formatElapsed(task: Task, now: number): string {
  const end = task.endedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatExit(task: Task): string {
  if (task.status === "running") return "running";
  if (task.errorText) return task.errorText;
  if (task.signal) return task.signal;
  return `exit ${task.exitCode ?? "?"}`;
}

/** Foreground and user tasks belong to Pi's bash tool: killing them out from
 * under the tool would corrupt its result, so the UI must not offer it. */
export function isKillable(task: Task): boolean {
  return task.kind === "background" && task.status === "running";
}

/** Collapse whitespace and bound the length: a newline inside a fixed-height
 * row desyncs the TUI renderer. */
export function toTitle(text: string, fallback = "task"): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
