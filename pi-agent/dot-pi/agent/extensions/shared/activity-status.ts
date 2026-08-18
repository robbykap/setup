/**
 * One compact segment for the shared status bar above the editor.
 *
 * The "how to open it" hint that used to live here is gone: on a single shared
 * line it is noise once the command is known, and /subagents and /workflows
 * are both discoverable from the command palette.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Theme = ExtensionContext["ui"]["theme"];

interface ActivityCounts {
  running: number;
  done: number;
  failed: number;
}

const GLYPHS = {
  subagents: "⌘",
  workflows: "⚙",
} as const;

export function formatActivityStatus(
  theme: Theme,
  label: keyof typeof GLYPHS,
  counts: ActivityCounts,
): string | undefined {
  const parts: string[] = [];
  if (counts.running > 0) {
    parts.push(theme.fg("warning", `${counts.running} running`));
  }
  if (counts.done > 0) parts.push(theme.fg("success", `${counts.done} done`));
  if (counts.failed > 0) {
    parts.push(theme.fg("error", `${counts.failed} failed`));
  }
  if (parts.length === 0) return undefined;

  return `${theme.fg("accent", GLYPHS[label])} ${parts.join(theme.fg("dim", " · "))}`;
}
