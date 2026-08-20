/**
 * The vocabulary of a file change. Everything else in this extension reads
 * and writes these shapes; nothing here imports the TUI.
 */

/** Who made the change. Child-session edits are tagged so the picker can
 * show them without pretending this session made them. */
export type ChangeOrigin =
  | { readonly kind: "self" }
  | { readonly kind: "subagent"; readonly id: string; readonly name: string }
  | { readonly kind: "workflow"; readonly label: string };

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** 1-based line number in the old file; absent for added lines. */
  readonly oldLine?: number;
  /** 1-based line number in the new file; absent for removed lines. */
  readonly newLine?: number;
  readonly text: string;
}

export interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: ReadonlyArray<DiffLine>;
}

export interface FileChange {
  /** Path relative to the session cwd. Also the store key. */
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  /**
   * Unified patches reported by whoever made the change, oldest first. The
   * last resort for a diff: used only when no baseline can be established for
   * the file, since a baseline describes the whole session and these describe
   * single calls.
   */
  readonly patches: ReadonlyArray<string>;
  readonly added: number;
  readonly removed: number;
  /** Number of tool calls that touched this file this session. */
  readonly edits: number;
  readonly isNew: boolean;
  /** Epoch ms of the most recent change. */
  readonly updatedAt: number;
  readonly origin: ChangeOrigin;
  /**
   * True until the hunks have been resolved as a whole-session diff. A record
   * starts out holding whatever one tool call reported — or nothing at all,
   * for a `write` or a child session — and the resolver replaces that with the
   * file's baseline-to-disk diff, which is the only thing the counts beside it
   * can honestly describe.
   */
  readonly hunksPending: boolean;
}

/**
 * Which section of the unfiltered picker a change belongs under.
 *
 * Origin outranks newness: a file a child session created reads as
 * "from agents", because who touched the file is the thing you cannot
 * recover from the row itself — the row already says "new file" in its
 * counts, while the origin tag is easy to miss at the far right.
 */
export function groupLabel(change: FileChange): string {
  if (change.origin.kind !== "self") return "from agents";
  return change.isNew ? "new" : "modified";
}

export function describeOrigin(origin: ChangeOrigin): string | undefined {
  switch (origin.kind) {
    case "self":
      return undefined;
    case "subagent":
      return `⌘ ${origin.name}`;
    case "workflow":
      return `⚙ ${origin.label}`;
  }
}
