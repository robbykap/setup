/**
 * What each file looked like before this session touched it.
 *
 * The store exists because a diff needs two sides and we only reliably hold
 * one. `edit` reports a patch for its own call, `write` reports none, and a
 * subagent's work is only ever known after it landed — so the honest answer to
 * "what changed here this session" is the file's first state against the file
 * on disk now. Capturing that first state is the only part that has to happen
 * at exactly the right moment: before the tool writes.
 *
 * The first capture wins, always. A second one would quietly turn a
 * four-edit session into whatever the last edit did, which is the bug this
 * replaced.
 *
 * Filesystem access is injected the way `measureWrite` injects `exists`, so
 * the arithmetic here is testable without touching a disk.
 */

import * as fs from "node:fs";

/** `content: null` means the file did not exist when we first saw it. */
export interface Baseline {
  readonly content: string | null;
  readonly source: "snapshot" | "git" | "absent";
}

export interface BaselineStore {
  /** Snapshot before a tool writes. Ignored when this key already has one. */
  capture(key: string, absolutePath: string): void;
  /** Record that the file did not exist when we first saw it. */
  captureAbsent(key: string): void;
  get(key: string): Baseline | undefined;
  /** Adopt a baseline computed elsewhere (a git blob), so it is fetched once. */
  adopt(key: string, baseline: Baseline): void;
  size(): number;
  clear(): void;
}

export interface BaselineIo {
  /** Null when the path does not exist or cannot be read. */
  readFile(absolutePath: string): string | null;
  /** Null when the path does not exist. */
  fileSize(absolutePath: string): number | null;
}

/** Past this, a snapshot costs more memory than the diff is worth; the caller
 * falls through to git instead. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function createBaselineStore(
  io: BaselineIo,
  options: { maxBytes?: number } = {},
): BaselineStore {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const baselines = new Map<string, Baseline>();

  return {
    capture(key, absolutePath) {
      if (baselines.has(key)) return;
      const size = io.fileSize(absolutePath);
      // A file that is not there yet is a creation, and an empty baseline is
      // exactly the right thing to diff its contents against.
      if (size === null) {
        baselines.set(key, { content: null, source: "absent" });
        return;
      }
      // Checked before the read, so an enormous file is never loaded just to
      // be thrown away.
      if (size > maxBytes) return;
      const content = io.readFile(absolutePath);
      if (content === null) return;
      // A binary file has no line diff worth showing, and NUL is the cheapest
      // test that says so.
      if (content.includes("\u0000")) return;
      baselines.set(key, { content, source: "snapshot" });
    },

    captureAbsent(key) {
      if (baselines.has(key)) return;
      baselines.set(key, { content: null, source: "absent" });
    },

    get(key) {
      return baselines.get(key);
    },

    adopt(key, baseline) {
      if (baselines.has(key)) return;
      baselines.set(key, baseline);
    },

    size() {
      return baselines.size;
    },

    clear() {
      baselines.clear();
    },
  };
}

export function nodeBaselineIo(): BaselineIo {
  return {
    readFile(absolutePath) {
      try {
        return fs.readFileSync(absolutePath, "utf8");
      } catch {
        return null;
      }
    },
    fileSize(absolutePath) {
      try {
        const stats = fs.statSync(absolutePath);
        // A directory has a size too, and it is never a baseline.
        return stats.isFile() ? stats.size : null;
      } catch {
        return null;
      }
    },
  };
}
