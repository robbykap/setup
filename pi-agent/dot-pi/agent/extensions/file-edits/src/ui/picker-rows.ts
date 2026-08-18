/**
 * Row layout and filtering for the picker, kept apart from the component so
 * both are testable without a terminal.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describeOrigin, type FileChange } from "../domain.ts";
import { iconFor, paintIcon } from "../icons.ts";

type Theme = ExtensionContext["ui"]["theme"];

export function formatAge(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} ago`;
}

/** Filtering reorders by match quality; with no query the store's
 * most-recent-first order is preserved. fuzzyFilter lowercases both sides, so
 * matching is case-insensitive, and it treats whitespace and slashes as token
 * separators. */
export function filterChanges(
  changes: ReadonlyArray<FileChange>,
  query: string,
): ReadonlyArray<FileChange> {
  if (!query.trim()) return changes;
  return fuzzyFilter([...changes], query, (change) => change.path);
}

/** The picker's filter and cursor, threaded through picker → viewer → picker
 * so reopening the picker does not forget either. Mirrors
 * background-terminals' DashboardSelection. */
export interface PickerState {
  query: string;
  path?: string;
  index: number;
}

export function createPickerState(): PickerState {
  return { query: "", index: 0 };
}

/** Re-anchors the cursor to `state.path` when it is still present in `rows`;
 * otherwise degrades to the nearest row at the previous index. Mutates
 * `state` in place, same contract as reconcileDashboardSelection. */
export function reconcilePickerSelection(
  state: PickerState,
  rows: ReadonlyArray<Pick<FileChange, "path">>,
): void {
  const stableIndex = state.path
    ? rows.findIndex((row) => row.path === state.path)
    : -1;
  state.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(Math.max(0, state.index), Math.max(0, rows.length - 1));
  state.path = rows[state.index]?.path;
}

export function renderPickerRow(
  change: FileChange,
  width: number,
  theme: Theme,
  now: number,
): string {
  const left = `${paintIcon(iconFor(change.path))} ${theme.fg("text", change.path)}`;

  const counts = [
    change.added > 0 ? theme.fg("toolDiffAdded", `+${change.added}`) : "",
    change.removed > 0 ? theme.fg("toolDiffRemoved", `−${change.removed}`) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const detail = change.isNew
    ? theme.fg("success", "new file")
    : theme.fg("muted", `${change.edits} edit${change.edits === 1 ? "" : "s"}`);

  const origin = describeOrigin(change.origin);
  const tail = origin
    ? theme.fg("accent", origin)
    : theme.fg("dim", formatAge(now - change.updatedAt));

  const right = `${counts}  ${detail}  ${tail}`;
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(
    `${left}${" ".repeat(gap)}${right}`,
    width,
    theme.fg("dim", "…"),
  );
}
