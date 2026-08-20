/**
 * What survives a /reload or a /resume.
 *
 * Not the hunks: they are the largest part of a record and the cheapest to
 * recompute, since the resolver only needs the file and a baseline. What has
 * to be written down is everything that cannot be recovered afterwards — which
 * files were touched, by whom, how often, and the patches children reported.
 *
 * The pinned commit goes in the log too, and it is the reason this works at
 * all: resolving HEAD again after a reload would pin whatever the session has
 * since committed, and every file already committed would read as unchanged.
 */

import type { ChangeOrigin, FileChange } from "./domain.ts";

/** The commit the session started on, written once per session. */
export interface MetaRecord {
  readonly kind: "meta";
  readonly headSha: string | null;
}

export interface FileRecord {
  readonly kind: "file";
  readonly path: string;
  readonly patches: ReadonlyArray<string>;
  readonly added: number;
  readonly removed: number;
  readonly edits: number;
  readonly isNew: boolean;
  readonly updatedAt: number;
  readonly origin: ChangeOrigin;
}

export type FileLogRecord = MetaRecord | FileRecord;

/** Patches are the one unbounded field here; a runaway file would make replay
 * cost more than the history is worth. */
const MAX_PATCHES = 20;

export function toFileRecord(change: FileChange): FileRecord {
  return {
    kind: "file",
    path: change.path,
    patches: change.patches.slice(-MAX_PATCHES),
    added: change.added,
    removed: change.removed,
    edits: change.edits,
    isNew: change.isNew,
    updatedAt: change.updatedAt,
    origin: change.origin,
  };
}

function isOrigin(value: unknown): value is ChangeOrigin {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "self" || kind === "subagent" || kind === "workflow";
}

/**
 * A record from disk, back into a change. Validated rather than trusted: the
 * file outlives the version of this extension that wrote it. Hunks come back
 * empty and pending, which is exactly what sends the viewer to the resolver.
 */
export function fromFileRecord(value: unknown): FileChange | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Partial<FileRecord>;
  if (record.kind !== "file") return undefined;
  if (typeof record.path !== "string" || record.path === "") return undefined;
  if (!isOrigin(record.origin)) return undefined;
  const patches = Array.isArray(record.patches)
    ? record.patches.filter((patch): patch is string => typeof patch === "string")
    : [];
  return {
    path: record.path,
    hunks: [],
    patches,
    added: typeof record.added === "number" ? record.added : 0,
    removed: typeof record.removed === "number" ? record.removed : 0,
    edits: typeof record.edits === "number" ? record.edits : 1,
    isNew: record.isNew === true,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    origin: record.origin,
    hunksPending: true,
    restored: true,
  };
}

/** The pinned commit from a previous segment of this session, if one was
 * written. `null` is a real answer — it means "there was no repository" — so
 * absence and null are different things here. */
export function pinnedShaFrom(
  records: ReadonlyArray<unknown>,
): { headSha: string | null } | undefined {
  for (const value of records) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Partial<MetaRecord>;
    if (record.kind !== "meta") continue;
    if (record.headSha === null || typeof record.headSha === "string") {
      return { headSha: record.headSha };
    }
  }
  return undefined;
}
