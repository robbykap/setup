/**
 * Background fills that survive a row's own colours.
 *
 * A row is a chain of `open…close` segments, and a full `\x1b[0m` anywhere in
 * it also cancels a background opened around the row — so a naive
 * `opener + row + reset` drops the fill partway across. fillLine re-opens the
 * background after every full reset, so the fill holds edge to edge, and the
 * visible width never changes — the invariant every overlay line lives by.
 *
 * Theme.fg/bg are not the culprit; they close with the narrow `\x1b[39m` /
 * `\x1b[49m` and leave the background standing. The full resets come from
 * paintIcon and from syntax-highlighted code pasted into a row.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { pad } from "./frame.ts";
import type { Rgb } from "./icons.ts";

const RESET = "\x1b[0m";
const PROBE = " ";

/** The opening escape sequence a paint function emits before its text. */
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
  if (!opener) return padded;
  return opener + padded.replaceAll(RESET, RESET + opener) + RESET;
}

/** The selected row in a picker: the theme's own selection background. */
export function paintSelected(
  text: string,
  width: number,
  theme: Theme,
): string {
  return fillLine(text, width, openerOf((t) => theme.bg("selectedBg", t)));
}

/**
 * Diff-line tints, literal RGB for the same reason the icons are: ThemeBg's
 * eight names have no diff entries. Both are Mocha base (30,30,46) nudged
 * toward the theme's green and red, dark enough that highlighted foreground
 * tokens stay readable on top.
 */
export const DIFF_ADDED_BG: Rgb = [40, 52, 46];
export const DIFF_REMOVED_BG: Rgb = [56, 40, 50];
