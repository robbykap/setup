/**
 * One line of status furniture above the editor, shared by every extension.
 *
 * Extensions keep publishing through ctx.ui.setStatus(); this module only
 * decides how the collected strings are ordered, joined, and trimmed to fit.
 * Nothing here touches the UI, so it is testable with a stub theme.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];

/** Same separator the footer uses, so the two rows read as one system. */
const SEPARATOR = " ◆ ";

/**
 * Fixed left-to-right order. A segment never moves under the reader, and
 * anything not listed here sorts after these, alphabetically.
 */
export const SEGMENT_ORDER = [
  "file-edits",
  "commands",
  "subagents",
  "background-terminals",
  "workflows",
  "summaries",
] as const;

function rank(key: string) {
  const index = SEGMENT_ORDER.indexOf(key as (typeof SEGMENT_ORDER)[number]);
  return index === -1 ? SEGMENT_ORDER.length : index;
}

/** Status text may contain newlines; the bar is strictly one line. */
function flatten(text: string) {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function order(statuses: ReadonlyMap<string, string>) {
  return [...statuses.entries()]
    .map(([key, text]) => ({ key, text: flatten(text) }))
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/**
 * Compose the status line, or undefined when there is nothing to say (the
 * caller then clears the widget so the row disappears entirely).
 *
 * Overflow drops whole segments from the right rather than truncating every
 * segment into mush; the last survivor is truncated only if it alone is too
 * wide.
 */
export function composeStatusBar(
  statuses: ReadonlyMap<string, string>,
  width: number,
  theme: Theme,
): string | undefined {
  const segments = order(statuses);
  if (segments.length === 0) return undefined;

  const separator = theme.fg("dim", SEPARATOR);
  const separatorWidth = visibleWidth(SEPARATOR);

  const kept: string[] = [];
  let used = 0;
  for (const segment of segments) {
    const cost =
      visibleWidth(segment.text) + (kept.length === 0 ? 0 : separatorWidth);
    if (kept.length > 0 && used + cost > width) break;
    kept.push(segment.text);
    used += cost;
  }

  return truncateToWidth(kept.join(separator), width, theme.fg("dim", "…"));
}
