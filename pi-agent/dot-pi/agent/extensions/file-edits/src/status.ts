/**
 * The status segment for file edits, as a pure function of the store's totals.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { FALLBACK_FILE_ICON } from "../../shared/tui-kit/icons.ts";
import { statusSegment, type StatusTail } from "../../shared/tui-kit/status.ts";

export interface FileStatusTotals {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export function formatFilesStatus(
  theme: Theme,
  totals: FileStatusTotals,
): string | undefined {
  const { files, added, removed } = totals;
  if (files === 0) return undefined;
  // The +/− tails keep the diff colours they carry everywhere else in the
  // TUI, which is what makes them readable without their own labels.
  const tails: StatusTail[] = [];
  if (added > 0) {
    tails.push({
      text: `+${added}`,
      kind: "neutral",
      paint: (text) => theme.fg("toolDiffAdded", text),
    });
  }
  if (removed > 0) {
    tails.push({
      text: `−${removed}`,
      kind: "neutral",
      paint: (text) => theme.fg("toolDiffRemoved", text),
    });
  }
  return statusSegment(
    theme,
    FALLBACK_FILE_ICON,
    files,
    `file${files === 1 ? "" : "s"}`,
    tails,
  );
}
