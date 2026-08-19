/**
 * The status segment for background terminals, as a pure function of the two
 * counts it reads.
 *
 * The head is always how many terminals this session is tracking — that number
 * must not change meaning when the last one settles — and "how many are still
 * running" is a tail on top of it. The icon carries the settle boundary: a
 * clock while any runs, a check once they all have.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../../shared/tui-kit/icons.ts";
import { statusSegment, type StatusTail } from "../../shared/tui-kit/status.ts";

export interface TerminalStatusCounts {
  readonly terminals: number;
  readonly running: number;
}

export function formatTerminalsStatus(
  theme: Theme,
  counts: TerminalStatusCounts,
): string | undefined {
  const { terminals, running } = counts;
  if (terminals === 0) return undefined;
  const tails: StatusTail[] =
    running > 0 ? [{ text: `${running} running`, kind: "neutral" }] : [];
  return statusSegment(
    theme,
    running > 0 ? UI_ICONS.clock : UI_ICONS.check,
    terminals,
    "terminal" + (terminals === 1 ? "" : "s"),
    tails,
  );
}
