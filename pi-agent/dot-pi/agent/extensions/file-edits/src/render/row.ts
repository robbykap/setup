/**
 * The two-line collapsed row: what an edit looks like in the transcript when
 * you are not reading the diff. Header plus a peek at the largest hunk.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { largestHunk } from "../diff.ts";
import type { FileChange } from "../domain.ts";
import { iconFor, paintIcon } from "../icons.ts";

type Theme = ExtensionContext["ui"]["theme"];

export const PEEK_LINES = 3;

/** The directory tells you where; the basename tells you what. Only the
 * second one earns full contrast — the same split the footer uses. */
function paintPath(path: string, theme: Theme) {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return theme.bold(theme.fg("text", path));
  return (
    theme.fg("dim", path.slice(0, cut + 1)) +
    theme.bold(theme.fg("text", path.slice(cut + 1)))
  );
}

function counts(change: FileChange, theme: Theme) {
  const parts: string[] = [];
  if (change.isNew) parts.push(theme.fg("success", "new"));
  if (change.added > 0) parts.push(theme.fg("toolDiffAdded", `+${change.added}`));
  if (change.removed > 0) {
    parts.push(theme.fg("toolDiffRemoved", `−${change.removed}`));
  }
  return parts.join(" ");
}

export function renderCollapsedRow(
  change: FileChange,
  width: number,
  theme: Theme,
): string[] {
  const left = `${paintIcon(iconFor(change.path))} ${paintPath(change.path, theme)}`;
  const right = counts(change, theme);
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    `${left}${" ".repeat(gap)}${right}`,
    width,
    theme.fg("dim", "…"),
  );

  const hunk = largestHunk(change.hunks);
  if (!hunk) return [header];

  const changed = hunk.lines.filter((line) => line.kind !== "context");
  if (changed.length === 0) return [header];

  const peek = changed
    .slice(0, PEEK_LINES)
    .map((line) => line.text.trim())
    .join(theme.fg("dim", " · "));

  return [
    header,
    truncateToWidth(
      `   ${theme.fg("dim", "│")} ${theme.fg("dim", peek)}`,
      width,
      theme.fg("dim", "…"),
    ),
  ];
}
