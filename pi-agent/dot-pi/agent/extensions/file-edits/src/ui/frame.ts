/**
 * Overlay framing. Every line an overlay returns must be exactly `width`
 * visible cells; a line that is even one cell off makes the whole panel look
 * shattered, because the terminal has no way to know the row was meant to be
 * padded.
 *
 * These are the same two primitives background-terminals/src/ui/ps.ts uses,
 * lifted into one place so the picker and the viewer cannot drift apart.
 * Widths are measured with visibleWidth, never String.length: every one of
 * these strings carries ANSI colour escapes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Fit styled text to exactly `width` cells, truncating or padding as needed. */
export function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

/**
 * A horizontal rule of exactly `width` cells, optionally with a label set into
 * it. The label is truncated so the rule can never overflow, which is what
 * makes the corner glyphs line up.
 */
export function borderSegment(
  theme: Theme,
  width: number,
  title = "",
  align: "left" | "right" = "left",
): string {
  const label = title
    ? ` ${truncateToWidth(title, Math.max(0, width - 3))} `
    : "";
  const labelWidth = visibleWidth(label);
  const rule = "─".repeat(Math.max(0, width - 1 - labelWidth));

  if (align === "right") {
    return (
      theme.fg("border", rule) +
      (label ? theme.fg("text", label) : "") +
      theme.fg("border", "─")
    );
  }
  return (
    theme.fg("border", "─") +
    (label ? theme.fg("text", label) : "") +
    theme.fg("border", rule)
  );
}

/** Top edge: ╭ … ╮, exactly `width` cells. */
export function topBorder(theme: Theme, width: number, title = ""): string {
  return (
    theme.fg("border", "╭") +
    borderSegment(theme, width - 2, title) +
    theme.fg("border", "╮")
  );
}

/** Bottom edge: ╰ … ╯, exactly `width` cells. */
export function bottomBorder(theme: Theme, width: number, title = ""): string {
  return (
    theme.fg("border", "╰") +
    borderSegment(theme, width - 2, title) +
    theme.fg("border", "╯")
  );
}

/** One body row, walled on both sides, exactly `width` cells. */
export function bodyRow(theme: Theme, width: number, content: string): string {
  const wall = theme.fg("border", "│");
  return wall + pad(content, width - 2) + wall;
}

/**
 * A header or legend line that sits outside the box. Still exactly `width`
 * cells, so it cannot leave a ragged edge above or below the panel.
 */
export function outerLine(width: number, content: string): string {
  return pad(content, width);
}

/**
 * How many body rows the panel draws.
 *
 * Fixed per frame so the overlay is a stable rectangle: if it grew and shrank
 * with the content, the transcript underneath would show through and the box
 * would jump while you type a filter.
 *
 * The size follows the same rule /ps and /subagents use — the whole overlay
 * occupies exactly `terminalRows - 1`, covering the header, chat and editor
 * while leaving pi's own footer row visible. `chromeLines` is everything that
 * is not a body row: the title line, both borders, and the key legend.
 */
export function bodyHeight(terminalRows: number, chromeLines: number): number {
  return Math.max(6, (terminalRows || 30) - chromeLines - 1);
}
