/**
 * Unified-patch parsing. Pure: no filesystem, no TUI. The edit tool already
 * hands us a standard patch in `details.patch`, so this only has to read it.
 */

import type { DiffLine, Hunk } from "./domain.ts";

export interface ParsedPatch {
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedPatch(patch: string): ParsedPatch | null {
  if (!patch) return null;

  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;

  let lines: DiffLine[] = [];
  let oldStart = 0;
  let newStart = 0;
  let oldLine = 0;
  let newLine = 0;
  let open = false;

  const flush = () => {
    if (open) hunks.push({ oldStart, newStart, lines });
    open = false;
    lines = [];
  };

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      flush();
      oldStart = Number(header[1]);
      newStart = Number(header[3]);
      oldLine = oldStart;
      newLine = newStart;
      open = true;
      continue;
    }
    // A multi-file patch starts a new file section; anything else beginning
    // with --- or +++ inside a hunk is real content, not a header.
    if (raw.startsWith("diff --git ")) {
      flush();
      continue;
    }
    if (!open) continue;
    // "\ No newline at end of file" annotates the previous line.
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      lines.push({ kind: "add", newLine, text });
      newLine += 1;
      added += 1;
    } else if (marker === "-") {
      lines.push({ kind: "remove", oldLine, text });
      oldLine += 1;
      removed += 1;
    } else if (marker === " ") {
      lines.push({ kind: "context", oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
    // Anything else (including a trailing empty line) is not diff content.
  }
  flush();

  return hunks.length === 0 ? null : { hunks, added, removed };
}

/** The hunk with the most changed lines — the one worth previewing. */
export function largestHunk(hunks: ReadonlyArray<Hunk>): Hunk | undefined {
  let best: Hunk | undefined;
  let bestScore = -1;
  for (const hunk of hunks) {
    const score = hunk.lines.filter((line) => line.kind !== "context").length;
    if (score > bestScore) {
      best = hunk;
      bestScore = score;
    }
  }
  return best;
}

/** One screen row of the split view: the old side, the new side, or both. */
export interface SplitRow {
  readonly left?: DiffLine;
  readonly right?: DiffLine;
  /** A gap between hunks, drawn as a divider rather than as content. */
  readonly separator?: true;
}

/**
 * Pair removals with additions so a change occupies the same screen row on
 * both sides. This is why the panes are composed per row rather than built
 * from two independent HStack children.
 */
export function pairRows(hunks: ReadonlyArray<Hunk>): SplitRow[] {
  const rows: SplitRow[] = [];

  hunks.forEach((hunk, index) => {
    if (index > 0) rows.push({ separator: true });

    let removals: DiffLine[] = [];
    let additions: DiffLine[] = [];

    const drain = () => {
      const height = Math.max(removals.length, additions.length);
      for (let offset = 0; offset < height; offset += 1) {
        rows.push({ left: removals[offset], right: additions[offset] });
      }
      removals = [];
      additions = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === "remove") removals.push(line);
      else if (line.kind === "add") additions.push(line);
      else {
        drain();
        rows.push({ left: line, right: line });
      }
    }
    drain();
  });

  return rows;
}
