/**
 * Background fills that survive a row's own colours.
 *
 * A row is a chain of `open…close` segments, and a full `\x1b[0m` anywhere in
 * it also cancels a background opened around the row — so a naive
 * `opener + row + reset` drops the fill partway across. fillLine re-opens the
 * background after every full reset, so the fill holds edge to edge, and the
 * fill adds no visible cells — the invariant every overlay line lives by.
 *
 * `theme.fg` is not the culprit; it closes with the narrow `\x1b[39m`, which
 * leaves the background standing and so goes un-chased. `theme.bg` is a
 * different story: it closes with `\x1b[49m`, which clears the fill for the
 * remainder of the row, so fillLine chases that as well as the full `\x1b[0m`.
 * The full resets come from paintIcon. Syntax-highlighted code is not a
 * source: pi's highlightCode emits only truecolor `\x1b[38;2;…m` openers
 * closed by `\x1b[39m`, so it passes through a fill untouched.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { pad } from "./frame.ts";
import type { Rgb } from "./icons.ts";

const RESET = "\x1b[0m";
const BG_CLOSE = "\x1b[49m"; // theme.bg's own closer: clears the fill, narrowly
const PROBE = " ";

/**
 * The opening escape sequence a paint function emits before its text — its
 * closer is deliberately dropped, because fillLine supplies its own.
 * Assumes `paint` returns `opener + text + closer`; anything else yields ""
 * and fillLine degrades to plain padding rather than corrupting the row.
 */
export function openerOf(paint: (text: string) => string): string {
  const painted = paint(PROBE);
  const at = painted.indexOf(PROBE);
  return at > 0 ? painted.slice(0, at) : "";
}

/** A truecolor background opener, for tints ThemeBg has no name for. */
export function rgbBgOpener([r, g, b]: Rgb): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

/** Pad (or truncate) to `width`, then hold `opener`'s background across the
 * whole row, re-opening after each inner reset. */
export function fillLine(text: string, width: number, opener: string): string {
  const padded = pad(text, width);
  if (!opener || width <= 0) return padded;
  const held = padded
    .replaceAll(RESET, RESET + opener)
    .replaceAll(BG_CLOSE, BG_CLOSE + opener);
  return opener + held + RESET;
}

// Deriving the opener means painting a probe string; a picker re-derives it
// for every visible row, so hold onto it per theme.
const SELECTED_OPENERS = new WeakMap<Theme, string>();

/** The selected row in a picker: the theme's own selection background. */
export function paintSelected(
  text: string,
  width: number,
  theme: Theme,
): string {
  let opener = SELECTED_OPENERS.get(theme);
  if (opener === undefined) {
    opener = openerOf((t) => theme.bg("selectedBg", t));
    SELECTED_OPENERS.set(theme, opener);
  }
  return fillLine(text, width, opener);
}

/**
 * Diff-line tints, literal RGB for the same reason the icons are: ThemeBg's
 * eight names have no diff entries. Both are Mocha base (30,30,46) nudged
 * toward the theme's green and red, dark enough that highlighted foreground
 * tokens stay readable on top.
 */
export const DIFF_ADDED_BG: Rgb = [40, 52, 46];
export const DIFF_REMOVED_BG: Rgb = [56, 40, 50];
