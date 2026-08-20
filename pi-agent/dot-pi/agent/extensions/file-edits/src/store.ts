/**
 * The read model every consumer shares: the transcript row, the picker, the
 * viewer, and the status segment. Synchronous, with subscriptions — the same
 * shape background-terminals uses for its terminal list.
 */

import type { ChangeOrigin, FileChange, Hunk } from "./domain.ts";

export interface RecordInput {
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
  readonly isNew: boolean;
  readonly origin: ChangeOrigin;
  /** The tool's own patch for this call, kept as a fallback for files no
   * baseline could be established for. */
  readonly patch?: string;
  /** Epoch ms. Injected so tests do not depend on the clock. */
  readonly at: number;
}

export interface ExternalInput {
  readonly path: string;
  readonly origin: ChangeOrigin;
  readonly patch?: string;
  readonly at: number;
}

export interface ResolvedHunks {
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
}

/** Patches accumulate rather than replace: each one describes a different
 * call, and the fallback that reads them wants the whole run. */
function appendPatch(
  previous: ReadonlyArray<string> | undefined,
  patch: string | undefined,
): ReadonlyArray<string> {
  if (!patch) return previous ?? [];
  return [...(previous ?? []), patch];
}

export interface FileEditStore {
  record(input: RecordInput): void;
  /** A change we know happened but cannot diff yet (child sessions). */
  recordExternal(input: ExternalInput): void;
  /** Put back a change from an earlier segment of this session. Not a
   * record: nothing happened just now, and the counts and timestamps are the
   * ones the previous segment left. */
  restore(change: FileChange): void;
  /** Replace the hunks and counts with a resolved whole-session diff. */
  resolveHunks(path: string, resolved: ResolvedHunks): void;
  get(path: string): FileChange | undefined;
  /** Most recently changed first. */
  list(): ReadonlyArray<FileChange>;
  size(): number;
  totals(): { files: number; added: number; removed: number };
  subscribe(listener: () => void): () => void;
}

const DEFAULT_CAP = 200;

export function createFileEditStore(
  options: {
    cap?: number;
    /** Called with every change the store accepts, so a session log can be
     * written without the store knowing what a session log is. Restores do
     * not go through it: replaying a log back into itself is how a log grows
     * without bound. */
    sink?: (change: FileChange) => void;
  } = {},
): FileEditStore {
  const cap = options.cap ?? DEFAULT_CAP;
  const changes = new Map<string, FileChange>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const publish = (path: string) => {
    const change = changes.get(path);
    if (change) options.sink?.(change);
  };

  /** Oldest-first eviction keeps the map bounded without touching order of
   * the rest, since list() sorts on read anyway. */
  const evict = () => {
    while (changes.size > cap) {
      let oldestPath: string | undefined;
      let oldestAt = Infinity;
      for (const [path, change] of changes) {
        if (change.updatedAt < oldestAt) {
          oldestAt = change.updatedAt;
          oldestPath = path;
        }
      }
      if (!oldestPath) return;
      changes.delete(oldestPath);
    }
  };

  return {
    record(input) {
      const previous = changes.get(input.path);
      changes.set(input.path, {
        path: input.path,
        hunks: input.hunks,
        patches: appendPatch(previous?.patches, input.patch),
        added: (previous?.added ?? 0) + input.added,
        removed: (previous?.removed ?? 0) + input.removed,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew || input.isNew,
        updatedAt: input.at,
        origin: input.origin,
        // What one call reported is never the file's whole story; the
        // resolver settles that, and until it has run these counts are the
        // running total rather than the diff.
        hunksPending: true,
      });
      evict();
      publish(input.path);
      notify();
    },

    recordExternal(input) {
      const previous = changes.get(input.path);
      changes.set(input.path, {
        path: input.path,
        hunks: previous?.hunks ?? [],
        patches: appendPatch(previous?.patches, input.patch),
        added: previous?.added ?? 0,
        removed: previous?.removed ?? 0,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew ?? false,
        updatedAt: input.at,
        origin: input.origin,
        hunksPending: true,
      });
      evict();
      publish(input.path);
      notify();
    },

    restore(change) {
      // Oldest-first replay, so a later record for the same path wins, exactly
      // as it did the first time round.
      changes.set(change.path, change);
      evict();
      notify();
    },

    resolveHunks(path, resolved) {
      const previous = changes.get(path);
      if (!previous) return;
      changes.set(path, {
        ...previous,
        hunks: resolved.hunks,
        added: resolved.added,
        removed: resolved.removed,
        hunksPending: false,
      });
      publish(path);
      notify();
    },

    get(path) {
      return changes.get(path);
    },

    list() {
      return [...changes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    size() {
      return changes.size;
    },

    totals() {
      let added = 0;
      let removed = 0;
      for (const change of changes.values()) {
        added += change.added;
        removed += change.removed;
      }
      return { files: changes.size, added, removed };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
