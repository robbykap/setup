/**
 * What survives a /reload or a /resume.
 *
 * A command's output is the one field with no upper bound worth trusting —
 * bash already caps what it returns, but a session's worth of caps still adds
 * up — so the log keeps a tail of it and the path to the full spill, which is
 * where the untruncated text was going to be read from anyway.
 */

import { byteLength, countLines, type CommandRecord } from "./domain.ts";
import {
  isCommandOrigin,
  type CommandStatus,
  type CommandTool,
} from "../../shared/command-log.ts";

/** Enough to recognize what happened, not enough to make replay expensive. */
const MAX_LOGGED_OUTPUT = 4000;

const TOOLS: ReadonlySet<string> = new Set(["bash", "fd", "rg"]);
const STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "failed",
  "aborted",
  "timeout",
]);

export function toCommandRecord(record: CommandRecord): CommandRecord {
  if (record.output.length <= MAX_LOGGED_OUTPUT) return record;
  // The tail, because the end of a command's output is the part that says how
  // it went. The counts stay honest about the whole thing.
  return { ...record, output: record.output.slice(-MAX_LOGGED_OUTPUT) };
}

/**
 * A record from disk, back into a command. Validated rather than trusted: the
 * file outlives the version of this extension that wrote it.
 */
export function fromCommandRecord(value: unknown): CommandRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Partial<CommandRecord>;
  if (typeof record.id !== "string" || record.id === "") return undefined;
  if (typeof record.tool !== "string" || !TOOLS.has(record.tool)) return undefined;
  if (typeof record.command !== "string") return undefined;
  if (typeof record.status !== "string" || !STATUSES.has(record.status)) {
    return undefined;
  }
  if (!isCommandOrigin(record.origin)) return undefined;
  const output = typeof record.output === "string" ? record.output : "";
  return {
    id: record.id,
    tool: record.tool as CommandTool,
    command: record.command,
    cwd: typeof record.cwd === "string" ? record.cwd : "",
    origin: record.origin,
    startedAt: typeof record.startedAt === "number" ? record.startedAt : 0,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
    status: record.status as CommandStatus,
    ...(typeof record.exitCode === "number" ? { exitCode: record.exitCode } : {}),
    output,
    // Recomputed rather than replayed: they have to describe the text that
    // came back, and that text may be a tail of what originally ran.
    outputLines: countLines(output),
    outputBytes: byteLength(output),
    ...(typeof record.fullOutputPath === "string"
      ? { fullOutputPath: record.fullOutputPath }
      : {}),
    restored: true,
  };
}
