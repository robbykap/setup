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
  readonly added: number;
  readonly removed: number;
  /** Number of tool calls that touched this file this session. */
  readonly edits: number;
  readonly isNew: boolean;
  /** Epoch ms of the most recent change. */
  readonly updatedAt: number;
  readonly origin: ChangeOrigin;
  /**
   * True when the hunks are not the whole file's story yet: the patch failed
   * to parse, a child session made the change and its diff is computed lazily
   * against HEAD, or a local edit landed on a file a child had already
   * touched, so what we hold describes one call and not the file.
   */
  readonly hunksPending: boolean;
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
