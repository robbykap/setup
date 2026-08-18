/**
 * The picker's row model: filtering, selection, and the shape of one line.
 * Pure and separately tested — the overlay class around it is hard to test,
 * this is not, and this is where the mistakes that shatter a panel live.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  formatAge,
  formatDuration,
  formatLines,
  formatStatus,
  originLabel,
  statusColor,
  statusGlyph,
  summarizeCommand,
} from "../domain.ts";
import { oneLine } from "../output.ts";

export interface PickerState {
  query: string;
  index: number;
  /** The selected record's id, so the cursor survives a list that grew. */
  id?: string;
}

export function createPickerState(): PickerState {
  return { query: "", index: 0 };
}

/**
 * Case-insensitive substring match over the command, the tool name and the
 * origin — the three things you would actually type to find a command again.
 */
export function filterRecords(
  records: ReadonlyArray<CommandRecord>,
  query: string,
): ReadonlyArray<CommandRecord> {
  const needle = query.trim().toLowerCase();
  if (!needle) return records;
  return records.filter((record) =>
    [record.command, record.tool, originLabel(record.origin)]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

/** Keep the cursor on the record it was on, or clamp it into range. */
export function reconcilePickerSelection(
  state: PickerState,
  records: ReadonlyArray<Pick<CommandRecord, "id">>,
) {
  const stable = state.id
    ? records.findIndex((record) => record.id === state.id)
    : -1;
  state.index =
    stable >= 0
      ? stable
      : Math.min(Math.max(0, state.index), Math.max(0, records.length - 1));
  state.id = records[state.index]?.id;
}

/** fd and rg earn a badge; bash is the default and gets a bare prompt. */
function toolBadge(record: CommandRecord, theme: Theme) {
  return record.tool === "bash"
    ? theme.fg("dim", "$")
    : theme.fg("toolTitle", record.tool);
}

/**
 * One row, exactly `width` cells or narrower: status, command on the left;
 * origin, duration, size and age on the right. The command is truncated
 * first, because the right column is the part with fixed meaning.
 */
export function renderPickerRow(
  record: CommandRecord,
  width: number,
  theme: Theme,
  now: number,
): string {
  const summary = summarizeCommand(record.command);
  const glyph = theme.fg(statusColor(record), statusGlyph(record));
  const command = oneLine(summary.text);
  const left =
    `${glyph} ${toolBadge(record, theme)} ` +
    theme.fg("text", command) +
    (summary.more > 0 ? theme.fg("dim", ` +${summary.more}`) : "");

  const dot = theme.fg("dim", " · ");
  const rightParts: string[] = [];
  const origin = originLabel(record.origin);
  if (origin) rightParts.push(theme.fg("accent", oneLine(origin)));
  if (record.status !== "ok") {
    rightParts.push(theme.fg(statusColor(record), formatStatus(record)));
  }
  rightParts.push(theme.fg("muted", formatDuration(record.durationMs)));
  rightParts.push(theme.fg("muted", formatLines(record.outputLines)));
  rightParts.push(theme.fg("dim", formatAge(record.startedAt, now)));
  const right = rightParts.join(dot);

  const rightWidth = visibleWidth(right);
  const leftMax = Math.max(0, width - rightWidth - 2);
  const leftFitted = truncateToWidth(left, leftMax, theme.fg("dim", "…"));
  const gap = Math.max(1, width - visibleWidth(leftFitted) - rightWidth);
  return truncateToWidth(`${leftFitted}${" ".repeat(gap)}${right}`, width);
}
