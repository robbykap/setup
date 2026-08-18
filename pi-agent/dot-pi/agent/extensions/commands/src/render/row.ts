/**
 * The two-line collapsed row: what a shell command looks like in the
 * transcript when you are not reading its output. The command, a
 * right-aligned outcome, and a peek at the LAST output line — for a command,
 * the tail is the result, unlike a diff where the head is.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Container,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  formatDuration,
  formatLines,
  formatStatus,
  lastOutputLine,
  statusColor,
  statusGlyph,
  summarizeCommand,
} from "../domain.ts";
import { oneLine } from "../output.ts";

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
    context.lastComponent instanceof EmptyRow;
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

export function renderCollapsedRow(
  record: CommandRecord,
  width: number,
  theme: Theme,
): string[] {
  const summary = summarizeCommand(record.command);
  const command = oneLine(summary.text);
  const left =
    theme.fg("dim", " $ ") +
    theme.bold(theme.fg("text", command)) +
    (summary.more > 0 ? theme.fg("dim", ` +${summary.more} more`) : "");
  const right = outcome(record, theme);

  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    `${left}${" ".repeat(gap)}${right}`,
    width,
    theme.fg("dim", "…"),
  );

  const peek = oneLine(lastOutputLine(record.output));
  if (!peek) return [header];

  return [
    header,
    truncateToWidth(
      `   ${theme.fg("dim", "│")} ${theme.fg("dim", peek)}`,
      width,
      theme.fg("dim", "…"),
    ),
  ];
}
