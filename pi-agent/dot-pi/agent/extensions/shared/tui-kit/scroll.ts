/**
 * One scroll model for every viewer, so `j` means the same thing in /cmds,
 * /files, and /ps output.
 *
 * Views that also accept typed text (the subagent takeover has a message
 * editor) pass vimKeys: false — printable keys and ctrl-u/ctrl-d belong to
 * the editor there, and only arrows and page keys scroll.
 */

import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

export type ScrollAction =
  | "line-up"
  | "line-down"
  | "half-up"
  | "half-down"
  | "page-up"
  | "page-down"
  | "top"
  | "bottom";

export interface ScrollKeyOptions {
  readonly vimKeys: boolean;
}

export function scrollActionFor(
  data: string,
  keybindings: KeybindingsManager,
  { vimKeys }: ScrollKeyOptions,
): ScrollAction | null {
  if (keybindings.matches(data, "tui.editor.cursorUp")) return "line-up";
  if (keybindings.matches(data, "tui.editor.cursorDown")) return "line-down";
  if (keybindings.matches(data, "tui.editor.pageUp")) return "page-up";
  if (keybindings.matches(data, "tui.editor.pageDown")) return "page-down";
  if (!vimKeys) return null;
  if (data === "k") return "line-up";
  if (data === "j") return "line-down";
  if (data === "\x15") return "half-up"; // ctrl-u
  if (data === "\x04") return "half-down"; // ctrl-d
  if (data === "g") return "top";
  if (data === "G") return "bottom";
  return null;
}

const FAR = Number.MAX_SAFE_INTEGER;

/** Offset counts lines up from the end; 0 is pinned to the tail. Callers
 * clamp against their own max in render, where content length is known. */
export function applyBottomAnchored(
  offset: number,
  action: ScrollAction,
  viewport: number,
): number {
  const half = Math.max(1, Math.floor(viewport / 2));
  switch (action) {
    case "line-up": return offset + 1;
    case "line-down": return Math.max(0, offset - 1);
    case "half-up": return offset + half;
    case "half-down": return Math.max(0, offset - half);
    case "page-up": return offset + viewport;
    case "page-down": return Math.max(0, offset - viewport);
    case "top": return FAR;
    case "bottom": return 0;
  }
}

/** Offset counts lines down from the start; 0 is the first line. */
export function applyTopAnchored(
  offset: number,
  action: ScrollAction,
  viewport: number,
): number {
  const half = Math.max(1, Math.floor(viewport / 2));
  switch (action) {
    case "line-up": return Math.max(0, offset - 1);
    case "line-down": return offset + 1;
    case "half-up": return Math.max(0, offset - half);
    case "half-down": return offset + half;
    case "page-up": return Math.max(0, offset - viewport);
    case "page-down": return offset + viewport;
    case "top": return 0;
    case "bottom": return FAR;
  }
}

export function clampOffset(offset: number, max: number): number {
  return Math.max(0, Math.min(offset, max));
}
