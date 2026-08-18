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
    if (!open) continue;
    // File headers and the no-newline marker carry no diff content.
    if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("\\")) {
      continue;
    }

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
