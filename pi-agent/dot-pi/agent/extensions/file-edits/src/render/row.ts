/**
 * The two-line collapsed row: what an edit looks like in the transcript when
 * you are not reading the diff. Header plus a peek at the largest hunk.
 *
 * A failed call collapses the same way — the path, a `✗ failed` marker where
 * the counts would go, and the reason on the peek line — rather than falling
 * back to the built-in's red box. ctrl+o still expands to the built-in.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { largestHunk } from "../diff.ts";
import type { FileChange } from "../domain.ts";
import { iconFor } from "../../../shared/tui-kit/icons.ts";
import { BoxedDelegate } from "../../../shared/tui-kit/boxed.ts";
import { peekLine, renderToolRow } from "../../../shared/tui-kit/row.ts";

type Theme = ExtensionContext["ui"]["theme"];

export const PEEK_LINES = 3;

/** Where the counts would go on a call that applied nothing. */
const FAILED_MARKER = "✗ failed";

/** The directory tells you where; the basename tells you what. Only the
 * second one earns full contrast — the same split the footer uses. */
export function paintPath(path: string, theme: Theme) {
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
  private failed = false;

  update(change: FileChange, theme: Theme, failed = false): void {
    this.change = change;
    this.theme = theme;
    this.failed = failed;
  }

  override render(width: number): string[] {
    if (!this.change || !this.theme) return [];
    return renderCollapsedRow(this.change, width, this.theme, this.failed);
  }
}

/** The result slot of a FAILED collapsed call: the reason, dimmed, on the
 * line the hunk peek would have used. Only this slot has the error text
 * (renderCall never sees the result), so the failed row is drawn across both
 * slots — header there, reason here. */
export class NoteRow extends Container {
  private text = "";
  private theme: Theme | undefined;

  update(text: string, theme: Theme): void {
    this.text = text;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    return renderNote(this.text, width, this.theme);
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
    context.lastComponent instanceof EmptyRow ||
    context.lastComponent instanceof NoteRow ||
    context.lastComponent instanceof BoxedDelegate;
  return ours ? { ...context, lastComponent: undefined } : context;
}

export function renderCollapsedRow(
  change: FileChange,
  width: number,
  theme: Theme,
  failed = false,
): string[] {
  const parts = {
    icon: iconFor(change.path),
    title: paintPath(change.path, theme),
    right: failed ? theme.fg("error", FAILED_MARKER) : counts(change, theme),
  };
  // Nothing was applied, so there is no diff to peek at: the reason comes
  // from the result slot (NoteRow) instead.
  if (failed) return renderToolRow(parts, width, theme);

  const hunk = largestHunk(change.hunks);
  const changed = hunk?.lines.filter((line) => line.kind !== "context") ?? [];
  const peek =
    changed.length === 0
      ? []
      : [
          changed
            .slice(0, PEEK_LINES)
            .map((line) => line.text.trim())
            .join(" · "),
        ];
  return renderToolRow({ ...parts, peek }, width, theme);
}

/** The reason line under a failed header. Empty text renders no line at all:
 * a bare `│` says less than nothing. */
export function renderNote(text: string, width: number, theme: Theme): string[] {
  const line = text.replace(/\s+/g, " ").trim();
  return line ? [peekLine(line, width, theme)] : [];
}
