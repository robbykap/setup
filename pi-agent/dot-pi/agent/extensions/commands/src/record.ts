/**
 * Recording a bash call.
 *
 * The awkward part is that bash does not report an exit code. Success returns
 * `{ content, details }` with the truncation details attached; any other
 * outcome is THROWN as an Error whose message is the output plus a trailing
 * status line, and the details are gone (core/tools/bash.js:330-350):
 *
 *   <output>\n\nCommand exited with code 2
 *   <output>\n\nCommand aborted
 *   <output>\n\nCommand timed out after 30 seconds
 *
 * So the failure path is reconstructed from text: the status line gives the
 * status and exit code, and the `Full output: <path>` marker bash writes into
 * its truncation banner gives back the spill path. Everything here is pure
 * except the injected clock; index.ts owns the wiring.
 *
 * The delegated tool's own result and error are never modified — the model
 * sees exactly what the built-in produced.
 */

import type { CommandRecord, CommandStatus } from "./domain.ts";
import { byteLength, countLines } from "./domain.ts";
import type { CommandStore } from "./store.ts";

const EXIT_PATTERN = /^Command exited with code (-?\d+)$/;
const TIMEOUT_PATTERN = /^Command timed out after .+$/;
const ABORT_PATTERN = /^Command aborted$/;
/** The last one wins: bash writes the marker into its trailing banner. */
const FULL_OUTPUT_PATTERN = /Full output: (.+?)\]/g;

export interface ParsedFailure {
  readonly status: CommandStatus;
  readonly exitCode?: number;
  /** The message with the trailing status line removed. */
  readonly output: string;
}

/**
 * Split a thrown bash message into its output and its status line. A message
 * with no recognizable status line is a failure whose whole text is output —
 * an executor error, for instance, which never reached the shell.
 */
export function parseFailureMessage(message: string): ParsedFailure {
  const cut = message.lastIndexOf("\n\n");
  const tail = (cut < 0 ? message : message.slice(cut + 2)).trim();
  const output = cut < 0 ? "" : message.slice(0, cut);

  const exit = EXIT_PATTERN.exec(tail);
  if (exit) {
    return { status: "failed", exitCode: Number(exit[1]), output };
  }
  if (TIMEOUT_PATTERN.test(tail)) return { status: "timeout", output };
  if (ABORT_PATTERN.test(tail)) return { status: "aborted", output };
  return { status: "failed", output: message };
}

/** The spill path bash names in its truncation banner, if it named one. */
export function parseFullOutputPath(text: string): string | undefined {
  let found: string | undefined;
  FULL_OUTPUT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FULL_OUTPUT_PATTERN)) {
    const path = match[1]?.trim();
    if (path) found = path;
  }
  return found;
}

export interface ToolResultLike {
  readonly content?: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
  }>;
  readonly details?: { readonly fullOutputPath?: string } | undefined;
}

/** The text a tool result carries, joined the way the transcript shows it. */
export function resultText(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

export interface BashRecordInput<TResult> {
  readonly toolCallId: string;
  readonly command: string;
  readonly cwd: string;
  readonly store: CommandStore;
  /** Per-call records for the transcript row, keyed by tool call id. */
  readonly calls: CallRecords;
  /** The delegated tool. */
  readonly run: () => Promise<TResult>;
  /** Epoch ms, injected so tests do not depend on the clock. */
  readonly now: () => number;
}

/** Build a record from the pieces every path shares. */
function buildRecord(input: {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
  durationMs: number;
  status: CommandStatus;
  exitCode?: number;
  output: string;
  fullOutputPath?: string;
}): CommandRecord {
  const { exitCode, fullOutputPath, ...rest } = input;
  return {
    ...rest,
    tool: "bash",
    origin: { kind: "session" },
    outputLines: countLines(input.output),
    outputBytes: byteLength(input.output),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
  };
}

/**
 * Run the delegated bash tool, write down what happened, and hand back its
 * result — or re-throw its error, untouched, after recording the failure.
 */
export async function executeBashAndRecord<TResult extends ToolResultLike>(
  input: BashRecordInput<TResult>,
): Promise<TResult> {
  const startedAt = input.now();
  const finish = (record: CommandRecord) => {
    input.store.record(record);
    input.calls.set(input.toolCallId, record);
  };

  try {
    const result = await input.run();
    const output = resultText(result);
    finish(
      buildRecord({
        id: input.toolCallId,
        command: input.command,
        cwd: input.cwd,
        startedAt,
        durationMs: input.now() - startedAt,
        status: "ok",
        output,
        fullOutputPath:
          result.details?.fullOutputPath ?? parseFullOutputPath(output),
      }),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const parsed = parseFailureMessage(message);
    finish(
      buildRecord({
        id: input.toolCallId,
        command: input.command,
        cwd: input.cwd,
        startedAt,
        durationMs: input.now() - startedAt,
        status: parsed.status,
        exitCode: parsed.exitCode,
        output: parsed.output,
        fullOutputPath: parseFullOutputPath(message),
      }),
    );
    throw error;
  }
}

/** The per-call records the transcript row reads, keyed by tool call id. */
export interface CallRecords {
  get(toolCallId: string): CommandRecord | undefined;
  set(toolCallId: string, record: CommandRecord): void;
  clear(): void;
}

export function createCallRecords(): CallRecords {
  const records = new Map<string, CommandRecord>();
  return {
    get: (toolCallId) => records.get(toolCallId),
    set: (toolCallId, record) => {
      records.set(toolCallId, record);
    },
    clear: () => {
      records.clear();
    },
  };
}
