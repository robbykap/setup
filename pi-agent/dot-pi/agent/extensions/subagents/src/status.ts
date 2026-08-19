/**
 * The status segment for subagents, as a pure function of the three counts.
 *
 * Only the non-zero counts appear: the first of them heads the segment, the
 * rest trail it. That is also the empty check — all three zero (which includes
 * "no subagents at all") means there is nothing to show — so callers need no
 * guard of their own.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../../shared/tui-kit/icons.ts";
import { statusSegment, type StatusTail } from "../../shared/tui-kit/status.ts";

export interface SubagentStatusCounts {
  readonly running: number;
  readonly done: number;
  readonly failed: number;
}

export function formatSubagentsStatus(
  theme: Theme,
  counts: SubagentStatusCounts,
): string | undefined {
  const entries = [
    { count: counts.running, label: "running", kind: "neutral" as const },
    { count: counts.done, label: "done", kind: "neutral" as const },
    { count: counts.failed, label: "failed", kind: "error" as const },
  ].filter((entry) => entry.count > 0);
  if (entries.length === 0) return undefined;

  const [head, ...rest] = entries;
  const tails: StatusTail[] = rest.map((entry) => ({
    text: `${entry.count} ${entry.label}`,
    kind: entry.kind,
  }));
  return statusSegment(theme, UI_ICONS.agent, head.count, head.label, tails);
}
