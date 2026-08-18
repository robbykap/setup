/**
 * The session's command log: a bounded append list, newest first, with
 * subscriptions. The transcript row, the picker, the viewer and the status
 * segment all read this one model — the same shape file-edits and
 * background-terminals use.
 *
 * Unlike file-edits, records are never merged: running `git status` twice is
 * two events in a history, not one file with a running total.
 */

import type { CommandRecord } from "./domain.ts";

export interface CommandStore {
  record(input: CommandRecord): void;
  get(id: string): CommandRecord | undefined;
  /** Most recent first. */
  list(): ReadonlyArray<CommandRecord>;
  size(): number;
  totals(): { commands: number; failed: number };
  subscribe(listener: () => void): () => void;
  clear(): void;
}

const DEFAULT_CAP = 500;

export function createCommandStore(
  options: { cap?: number } = {},
): CommandStore {
  const cap = Math.max(1, options.cap ?? DEFAULT_CAP);
  /** Insertion order is arrival order; list() reverses it. A Map keeps the
   * id lookup the viewer needs without a second index. */
  const records = new Map<string, CommandRecord>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    record(input) {
      // Re-recording an id (a retried tool call) replaces in place rather
      // than appending a duplicate the picker would show twice.
      records.delete(input.id);
      records.set(input.id, input);
      while (records.size > cap) {
        const oldest = records.keys().next();
        if (oldest.done) break;
        records.delete(oldest.value);
      }
      notify();
    },

    get(id) {
      return records.get(id);
    },

    list() {
      return [...records.values()].reverse();
    },

    size() {
      return records.size;
    },

    totals() {
      let failed = 0;
      for (const record of records.values()) {
        if (record.status !== "ok") failed += 1;
      }
      return { commands: records.size, failed };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear() {
      records.clear();
      notify();
    },
  };
}
