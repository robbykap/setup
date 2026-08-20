/**
 * Recording a tool call. Every edit or write is written down twice:
 *
 * - cumulatively in the store, because the picker and the status segment ask
 *   "what happened to this file this session";
 * - once per tool call, because the transcript row asks "what did THIS call
 *   do" — a row that shows the file's running total above the hunks of a
 *   single call is lying about both.
 *
 * Pure except for the clock and the filesystem, and both of those are
 * injected: index.ts owns the wiring, this owns the arithmetic.
 */

import * as path from "node:path";
import { parseUnifiedPatch } from "./diff.ts";
import type { FileChange, Hunk } from "./domain.ts";
import { storeKeyFor } from "./paths.ts";
import type { FileEditStore } from "./store.ts";

/** This session made the change — as opposed to a subagent or a workflow. */
export const SELF = { kind: "self" } as const;

/** What one tool call did to one file. */
export interface CallDelta {
  /** cwd-relative, ready to be a store key. */
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
  readonly isNew: boolean;
  /** The tool's own patch, kept for files no baseline could be taken of. */
  readonly patch?: string;
}

/**
 * Measuring happens in two phases: the phase function runs before the tool
 * does, because write has to see the filesystem before its own write lands to
 * know whether the file is new.
 */
export type Measure<TParams, TResult> = (
  params: TParams,
) => (result: TResult) => CallDelta;

export interface EditParams {
  readonly path: string;
}

export interface EditResult {
  readonly details?: { readonly patch?: string } | undefined;
}

/** edit reports a unified patch; the counts are whatever it says. */
export function measureEdit(cwd: string): Measure<EditParams, EditResult> {
  return (params) => (result) => {
    const patch = result.details?.patch;
    const parsed = patch ? parseUnifiedPatch(patch) : null;
    return {
      path: storeKeyFor(cwd, params.path),
      hunks: parsed?.hunks ?? [],
      added: parsed?.added ?? 0,
      removed: parsed?.removed ?? 0,
      isNew: false,
      ...(patch ? { patch } : {}),
    };
  };
}

export interface WriteParams {
  readonly path: string;
  readonly content: string;
}

/** write has no details, so the counts come from the content itself, and
 * newness from the filesystem as it was before the write. */
export function measureWrite(
  cwd: string,
  exists: (absolutePath: string) => boolean,
): Measure<WriteParams, unknown> {
  return (params) => {
    const absolute = path.isAbsolute(params.path)
      ? params.path
      : path.join(cwd, params.path);
    const isNew = !exists(absolute);
    return () => ({
      path: storeKeyFor(cwd, params.path),
      hunks: [],
      added: params.content.split("\n").length,
      removed: 0,
      isNew,
    });
  };
}

/** The per-call records, keyed by toolCallId. */
export interface CallRecords {
  get(toolCallId: string): FileChange | undefined;
  set(toolCallId: string, change: FileChange): void;
  clear(): void;
}

export function createCallRecords(): CallRecords {
  const records = new Map<string, FileChange>();
  return {
    get: (toolCallId) => records.get(toolCallId),
    set: (toolCallId, change) => {
      records.set(toolCallId, change);
    },
    clear: () => {
      records.clear();
    },
  };
}

export interface RecordedExecution<TParams, TResult> {
  readonly toolCallId: string;
  readonly params: TParams;
  /** The delegated tool. Its result is returned untouched, and a rejection
   * propagates with nothing written down. */
  readonly run: () => Promise<TResult>;
  readonly measure: Measure<TParams, TResult>;
  readonly store: FileEditStore;
  readonly calls: CallRecords;
  /** Epoch ms. Injected so tests do not depend on the clock. */
  readonly at: number;
  /** Resolve the file's whole-session diff, now that the call has landed.
   * Optional so the arithmetic here stays testable without a filesystem. */
  readonly onRecorded?: (key: string) => void;
}

export async function executeAndRecord<TParams, TResult>(
  execution: RecordedExecution<TParams, TResult>,
): Promise<TResult> {
  const finish = execution.measure(execution.params);
  const result = await execution.run();
  const delta = finish(result);
  execution.store.record({ ...delta, origin: SELF, at: execution.at });
  execution.calls.set(execution.toolCallId, {
    path: delta.path,
    hunks: delta.hunks,
    patches: delta.patch ? [delta.patch] : [],
    added: delta.added,
    removed: delta.removed,
    edits: 1,
    isNew: delta.isNew,
    updatedAt: execution.at,
    origin: SELF,
    // The per-call record is the one thing that IS settled: it describes this
    // call and nothing else, which is exactly what its transcript row says.
    hunksPending: false,
  });
  execution.onRecorded?.(delta.path);
  return result;
}
