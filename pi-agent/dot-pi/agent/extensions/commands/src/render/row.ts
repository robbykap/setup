/**
 * The two-line collapsed row: what a shell command looks like in the
 * transcript when you are not reading its output. The command, a
 * right-aligned outcome, and a peek at the LAST output line — for a command,
 * the tail is the result, unlike a diff where the head is.
 *
 * A failure collapses the same way, just with a deeper peek: the last few
 * lines instead of one, in plain dim text rather than the built-in's red box.
 * ctrl+o still expands to the full output.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  formatDuration,
  formatLines,
  formatStatus,
  isFailure,
  statusColor,
  statusGlyph,
  summarizeCommand,
} from "../domain.ts";
import { oneLine, sanitizeText } from "../output.ts";
import { UI_ICONS } from "../../../shared/tui-kit/icons.ts";
import { peekLine, renderToolRow } from "../../../shared/tui-kit/row.ts";
import { BoxedDelegate } from "../../../shared/tui-kit/boxed.ts";

/** How many trailing lines a row peeks at: one for a success, and two more
 * for a failure, where the line before the error usually names the cause. */
const PEEK_LINES = 1;
const FAILURE_PEEK_LINES = 3;

type Theme = ExtensionContext["ui"]["theme"];

/**
 * A pi-tui component, because a render slot hands whatever it returned back
 * to whoever renders that slot next, and the built-in bash renderer calls
 * methods on it that a bare object literal cannot answer.
 *
 * Width is unknown until render time, so the row is drawn there rather than
 * baked into child Text components that would wrap instead of truncate.
 */
export class CollapsedRow extends Container {
  private record: CommandRecord | undefined;
  private theme: Theme | undefined;

  update(record: CommandRecord, theme: Theme): void {
    this.record = record;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.record || !this.theme) return [];
    return renderCollapsedRow(this.record, width, this.theme);
  }
}

/** The result slot's component while the row is collapsed: renderCall draws
 * the whole row, so there is nothing left to add. */
export class EmptyRow extends Container {}

/** The call slot while the command is still running: icon, command, and a
 * running marker — the boxed built-in live line replaced. */
export class LiveCallRow extends Container {
  private command = "";
  private theme: Theme | undefined;

  update(command: string, theme: Theme): void {
    this.command = command;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    return renderToolRow(
      {
        icon: UI_ICONS.terminal,
        title: paintCommand(this.command, this.theme),
        right: this.theme.fg("warning", "… running"),
      },
      width,
      this.theme,
    );
  }
}

/** The result slot while output is still streaming: a dim peek at the last
 * line so far. Re-rendered every time a new chunk arrives. */
export class LivePeekRow extends Container {
  private output = "";
  private theme: Theme | undefined;

  update(output: string, theme: Theme): void {
    this.output = output;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    const theme = this.theme;
    return tailLines(this.output, PEEK_LINES).map((line) =>
      peekLine(line, width, theme),
    );
  }
}

/** The result slot for a call restored from a saved session: execute never
 * ran, so there is no record — no duration, no line count, just what the
 * saved result carried. */
export class RestoredRow extends Container {
  private command = "";
  private output = "";
  private failed = false;
  private theme: Theme | undefined;

  update(command: string, output: string, failed: boolean, theme: Theme): void {
    this.command = command;
    this.output = output;
    this.failed = failed;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    const theme = this.theme;
    return renderToolRow(
      {
        icon: UI_ICONS.terminal,
        title: paintCommand(this.command, theme),
        right: this.failed
          ? theme.fg("error", "✗ failed")
          : theme.fg("success", "✓ done"),
        peek: tailLines(this.output, this.failed ? FAILURE_PEEK_LINES : PEEK_LINES),
      },
      width,
      theme,
    );
  }
}

/**
 * The context to hand the built-in renderer when delegating. A slot's
 * `lastComponent` is whatever that slot returned last time, so after a
 * collapsed render it is one of ours — and the built-in caches state on the
 * component it is given. Ours are hidden; its own is handed straight back.
 */
export function delegationContext<T extends { lastComponent: unknown }>(
  context: T,
): T {
  const ours =
    context.lastComponent instanceof CollapsedRow ||
    context.lastComponent instanceof EmptyRow ||
    context.lastComponent instanceof LiveCallRow ||
    context.lastComponent instanceof LivePeekRow ||
    context.lastComponent instanceof RestoredRow ||
    context.lastComponent instanceof BoxedDelegate;
  return ours ? { ...context, lastComponent: undefined } : context;
}

function outcome(record: CommandRecord, theme: Theme) {
  const color = statusColor(record);
  const parts = [
    theme.fg(color, `${statusGlyph(record)} ${formatStatus(record)}`),
    theme.fg("muted", formatDuration(record.durationMs)),
  ];
  if (record.outputLines > 0) {
    parts.push(theme.fg("muted", formatLines(record.outputLines)));
  }
  return parts.join(theme.fg("dim", " · "));
}

/** The command painted the way every bash row titles itself. */
export function paintCommand(command: string, theme: Theme): string {
  const summary = summarizeCommand(command);
  return (
    theme.bold(theme.fg("text", oneLine(summary.text))) +
    (summary.more > 0 ? theme.fg("dim", ` +${summary.more} more`) : "")
  );
}

export function renderCollapsedRow(
  record: CommandRecord,
  width: number,
  theme: Theme,
): string[] {
  return renderToolRow(
    {
      icon: UI_ICONS.terminal,
      title: paintCommand(record.command, theme),
      right: outcome(record, theme),
      peek: tailLines(
        record.output,
        isFailure(record) ? FAILURE_PEEK_LINES : PEEK_LINES,
      ),
    },
    width,
    theme,
  );
}

/** The last `count` lines with anything on them, oldest first. Blank lines are
 * skipped rather than counted: a row of empties is not a peek. */
function tailLines(output: string, count: number): string[] {
  const lines = sanitizeText(output).split("\n");
  const tail: string[] = [];
  for (let index = lines.length - 1; index >= 0 && tail.length < count; index -= 1) {
    const line = oneLine(lines[index] ?? "");
    if (line) tail.unshift(line);
  }
  return tail;
}
