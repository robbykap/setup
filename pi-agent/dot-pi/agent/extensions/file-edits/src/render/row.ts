/**
 * The two-line collapsed row: what an edit looks like in the transcript when
 * you are not reading the diff. Header plus a peek at the largest hunk.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Container,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
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

/**
 * The row as a pi-tui component, because a render slot hands whatever it
 * returned back to whoever renders that slot next: the built-in edit and
 * write renderers call `clear()` on it (edit.js:276-277, write.js:190-191),
 * which a bare `{ render, invalidate }` literal cannot answer.
 *
 * Width is not known until render time, so the row is drawn there rather
 * than baked into child Text components that would wrap instead of truncate.
 */
export class CollapsedRow extends Container {
  private change: FileChange | undefined;
  private theme: Theme | undefined;

  update(change: FileChange, theme: Theme): void {
    this.change = change;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.change || !this.theme) return [];
    return renderCollapsedRow(this.change, width, this.theme);
  }
}

/** The result slot's component while the row is collapsed: renderCall draws
 * the row, so there is nothing left to add. Named so it can be told apart
 * from a Container a built-in made for itself. */
export class EmptyRow extends Container {}

/**
 * The context to hand a built-in renderer when delegating. A slot's
 * `lastComponent` is whatever that slot returned last time
 * (tool-execution.js:257), so after a collapsed render it is one of ours —
 * and the built-ins call `clear()` on it (edit.js:276-277) and cache state on
 * it (write.js:175-179). Ours are hidden; the built-in's own is handed back,
 * because that cache is how write avoids re-highlighting the whole file on
 * every streamed chunk.
 */
export function delegationContext<T extends { lastComponent: unknown }>(
  context: T,
): T {
  const ours =
    context.lastComponent instanceof CollapsedRow ||
    context.lastComponent instanceof EmptyRow;
  return ours ? { ...context, lastComponent: undefined } : context;
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
