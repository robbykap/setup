/**
 * Everything the model reads: tool descriptions and the text of results and
 * notifications. Kept apart from the tool wiring so the wording can change
 * without touching behaviour.
 */

import { formatExit, type Task } from "./domain.ts";
import { sanitizeText } from "./ui/output-lines.ts";

export const BG_START_TOOL_DESCRIPTION =
  "Start a long-running shell command in the background and return immediately. " +
  "Use this for dev servers, watchers, builds and test runs that would otherwise " +
  "block. The command has no stdin. You are notified once when it exits; until " +
  "then check on it with bg_status.";

export const BG_START_PROMPT_SNIPPET =
  "Run long-lived commands with bg_start instead of bash.";

export const BG_START_PARAMETER_DESCRIPTIONS = {
  command: "Shell command to run, exactly as it would be typed.",
  title: "Short label shown in the task list, e.g. 'dev server'.",
  workingDir: "Directory to run in, relative to the session cwd. Defaults to the cwd.",
};

export const BG_STATUS_TOOL_DESCRIPTION =
  "Check one background task: its status and the tail of its output.";

export const BG_LIST_TOOL_DESCRIPTION =
  "List every background task in this session, running and finished.";

export const BG_KILL_TOOL_DESCRIPTION =
  "Terminate background tasks by id and report their final state.";

export const BG_ID_PARAMETER_DESCRIPTION = "Task id, e.g. 'b1'.";

const OUTPUT_TAIL_LINES = 100;

/** Last `limit` lines, with a note about what was left out. */
export function tailLines(text: string, limit = OUTPUT_TAIL_LINES): string {
  const lines = sanitizeText(text).split("\n");
  if (lines.length <= limit) return lines.join("\n");
  const kept = lines.slice(-limit);
  return `... ${lines.length - limit} earlier lines omitted\n${kept.join("\n")}`;
}

export function describeTask(task: Task): string {
  const kind =
    task.kind === "background"
      ? "background"
      : task.kind === "user"
        ? "user"
        : "foreground";
  return `${task.id} [${kind}] ${task.title} — ${task.status === "running" ? "running" : formatExit(task)} (${task.command})`;
}

function outputSection(task: Task): string {
  if (task.merged) {
    const text = tailLines(task.stdout.text).trim();
    return text ? `output:\n${text}` : "output: (none)";
  }
  const parts: string[] = [];
  const out = tailLines(task.stdout.text).trim();
  const err = tailLines(task.stderr.text).trim();
  parts.push(out ? `stdout:\n${out}` : "stdout: (none)");
  if (err) parts.push(`stderr:\n${err}`);
  return parts.join("\n\n");
}

/** Delivered automatically, once, when a background task exits. */
export function buildSettledMessage(task: Task): string {
  const verb =
    task.status === "failed"
      ? "failed"
      : task.status === "killed"
        ? "was killed"
        : "finished";
  return `Background task ${task.id} (${task.title}) ${verb}: ${formatExit(task)}\n\n$ ${task.command}\n\n${outputSection(task)}`;
}

/** Delivered when the user presses `s` in the detail view. */
export function buildSendToAgentMessage(task: Task): string {
  return `Take a look at this task from the dashboard.\n\n$ ${task.command}\nstatus: ${task.status === "running" ? "running" : formatExit(task)}\n\n${outputSection(task)}`;
}

export function buildStatusResult(task: Task): string {
  return `${describeTask(task)}\n\n${outputSection(task)}`;
}

export function buildStartResult(task: Task): string {
  return `Started ${task.id} (pid ${task.pid ?? "?"}): ${task.command}\nCheck it with bg_status("${task.id}"). You will be notified when it exits.`;
}

export function buildKillReport(tasks: readonly Task[]): string {
  return tasks.map((task) => `${task.id}: ${formatExit(task)}`).join("\n");
}
