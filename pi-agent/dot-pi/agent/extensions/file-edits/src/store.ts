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
  /** Epoch ms. Injected so tests do not depend on the clock. */
  readonly at: number;
}

export interface ExternalInput {
  readonly path: string;
  readonly origin: ChangeOrigin;
  readonly at: number;
}

export interface ResolvedHunks {
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
}

export interface FileEditStore {
  record(input: RecordInput): void;
  /** A change we know happened but cannot diff yet (child sessions). */
  recordExternal(input: ExternalInput): void;
  /** Fill in hunks computed later, e.g. against git HEAD. */
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
  options: { cap?: number } = {},
): FileEditStore {
  const cap = options.cap ?? DEFAULT_CAP;
  const changes = new Map<string, FileChange>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
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
        added: (previous?.added ?? 0) + input.added,
        removed: (previous?.removed ?? 0) + input.removed,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew || input.isNew,
        updatedAt: input.at,
        origin: input.origin,
        hunksPending: false,
      });
      evict();
      notify();
    },

    recordExternal(input) {
      const previous = changes.get(input.path);
      changes.set(input.path, {
        path: input.path,
        hunks: previous?.hunks ?? [],
        added: previous?.added ?? 0,
        removed: previous?.removed ?? 0,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew ?? false,
        updatedAt: input.at,
        origin: input.origin,
        hunksPending: true,
      });
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
