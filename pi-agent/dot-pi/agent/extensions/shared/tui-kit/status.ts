/**
 * One shape for every extension's status segment, so the bar reads as one
 * system: painted icon, accent count, muted label, then optional tails —
 * error tails in the error colour, neutral tails dim.
 *
 * A tail may carry its own `paint` when the colour is itself information the
 * segment would lose otherwise (file-edits' +added/−removed, which are read as
 * diff colours everywhere else in the TUI). The kit stays minimal: `kind` is
 * the default, `paint` the deliberate exception.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { paintIcon, type FileIcon } from "./icons.ts";

export interface StatusTail {
  readonly text: string;
  readonly kind: "error" | "neutral";
  /** Wins over `kind` when present. */
  readonly paint?: (text: string) => string;
}

export function statusSegment(
  theme: Theme,
  icon: FileIcon,
  count: number | string,
  label: string,
  tails: ReadonlyArray<StatusTail> = [],
): string {
  const parts = [
    `${paintIcon(icon)} ${theme.fg("accent", String(count))} ${theme.fg("muted", label)}`,
  ];
  for (const tail of tails) {
    parts.push(
      tail.paint
        ? tail.paint(tail.text)
        : theme.fg(tail.kind === "error" ? "error" : "dim", tail.text),
    );
  }
  return parts.join(" ");
}
