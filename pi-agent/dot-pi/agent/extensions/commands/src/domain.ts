/**
 * What a recorded command is, and the small formatters every surface shares.
 * Pure: no clock, no filesystem, no theme. The row, the picker, the viewer and
 * the status segment all read from here so they cannot describe the same
 * command two different ways.
 */

import type {
  CommandOrigin,
  CommandStatus,
  CommandTool,
} from "../../shared/command-log.ts";

export type { CommandOrigin, CommandStatus, CommandTool };

export interface CommandRecord {
  readonly id: string;
  readonly tool: CommandTool;
  /** The command as run. May contain newlines; display code must fold them. */
  readonly command: string;
  readonly cwd: string;
  readonly origin: CommandOrigin;
  /** Epoch ms. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly status: CommandStatus;
  readonly exitCode?: number;
  /** What the tool returned, minus the trailing status line bash appends. */
  readonly output: string;
  readonly outputLines: number;
  readonly outputBytes: number;
  /** Set when the output was truncated and spilled to a temp file. */
  readonly fullOutputPath?: string;
  /** Replayed from an earlier segment of this session rather than watched as
   * it ran. The timestamps are the original ones, so a row showing it is not
   * claiming it just happened. */
  readonly restored?: boolean;
}

export function isFailure(record: Pick<CommandRecord, "status">) {
  return record.status !== "ok";
}

/** Byte length of output, measured the way the terminal will see it. */
export function byteLength(text: string) {
  return Buffer.byteLength(text, "utf8");
}

/** Lines of real output. Empty output is zero lines, not one. */
export function countLines(text: string) {
  if (text.length === 0) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n").length;
}

/**
 * The command as a single line. A heredoc or a multi-line script would break
 * a fixed-height row, so only the first line survives, with a count of what
 * was dropped.
 */
export function summarizeCommand(command: string) {
  const lines = command.split("\n").filter((line) => line.trim().length > 0);
  const first = (lines[0] ?? "").trim();
  const rest = lines.length - 1;
  return { text: first, more: rest > 0 ? rest : 0 };
}

/** The last line with anything on it: for a shell command, the tail is the
 * result. Empty when the command printed nothing. */
export function lastOutputLine(output: string) {
  const lines = output.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return "";
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLines(lines: number) {
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

/** Compact relative age, for the right edge of a picker row. */
export function formatAge(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** How a failure reads at a glance: the exit code when there is one, the
 * shape of the failure when there is not. */
export function formatStatus(record: Pick<CommandRecord, "status" | "exitCode">) {
  switch (record.status) {
    case "ok":
      return "ok";
    case "aborted":
      return "aborted";
    case "timeout":
      return "timed out";
    case "failed":
      return record.exitCode === undefined
        ? "failed"
        : `exit ${record.exitCode}`;
  }
}

export function statusGlyph(record: Pick<CommandRecord, "status">) {
  return record.status === "ok" ? "✓" : "✗";
}

/** The theme colour a status earns. Names match the shared theme palette. */
export function statusColor(record: Pick<CommandRecord, "status">) {
  switch (record.status) {
    case "ok":
      return "success";
    case "failed":
      return "error";
    default:
      return "warning";
  }
}

/** Who ran it, short enough for a row. Empty for our own session. */
export function originLabel(origin: CommandOrigin) {
  switch (origin.kind) {
    case "session":
      return "";
    case "subagent":
      return origin.name;
    case "workflow":
      return origin.label;
  }
}
