/**
 * The status segment for commands, as a pure function of the store's totals.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../../shared/tui-kit/icons.ts";
import { statusSegment, type StatusTail } from "../../shared/tui-kit/status.ts";

export interface CommandStatusTotals {
  readonly commands: number;
  readonly failed: number;
}

export function formatCommandsStatus(
  theme: Theme,
  totals: CommandStatusTotals,
): string | undefined {
  const { commands, failed } = totals;
  if (commands === 0) return undefined;
  const tails: StatusTail[] =
    failed > 0 ? [{ text: `${failed}✗`, kind: "error" }] : [];
  return statusSegment(
    theme,
    UI_ICONS.terminal,
    commands,
    `cmd${commands === 1 ? "" : "s"}`,
    tails,
  );
}
