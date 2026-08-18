/**
 * Turning captured output into display lines. Sanitization happens here — at
 * render time, never at capture time — because raw ANSI and control bytes make
 * a line wider than the width we declare to the TUI, which smears the overlay.
 *
 * Same rules as background-terminals/src/ui/output-view.ts; kept separate
 * rather than imported so neither extension can break the other's viewer.
 */

import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

// OSC strings (titles, hyperlinks) end in BEL or ST. Stripped first, so their
// payload never becomes visible text after only the ESC byte is removed.
// eslint-disable-next-line no-control-regex
const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// Standards-shaped CSI matcher: parameters are deliberately unbounded.
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// Remaining two-byte and charset escape forms (for example ESC ( 0).
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

export function sanitizeText(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replaceAll("\t", "  ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/** One-line-safe rendering of arbitrary text (commands, titles): a newline
 * inside a fixed-height row desyncs the renderer. */
export function oneLine(text: string) {
  return sanitizeText(text.replace(/\s+/g, " ")).trim();
}

/** Split, sanitize and wrap output into lines that fit `width`. */
export function buildOutputLines(text: string, width: number): string[] {
  const safeWidth = Math.max(10, width);
  const lines: string[] = [];
  for (const raw of sanitizeText(text).split("\n")) {
    if (raw.length === 0) {
      lines.push("");
      continue;
    }
    lines.push(...wrapTextWithAnsi(raw, safeWidth));
  }
  return lines;
}

/**
 * Wrapping the same text on every keystroke is wasted work in a view whose
 * content only changes when you switch what you are looking at.
 */
export function createOutputLineCache() {
  let cachedKey: string | undefined;
  let cachedWidth = -1;
  let cachedLines: string[] = [];

  return {
    get(text: string, key: string, width: number): string[] {
      if (key === cachedKey && width === cachedWidth) return cachedLines;
      cachedKey = key;
      cachedWidth = width;
      cachedLines = buildOutputLines(text, width);
      return cachedLines;
    },
  };
}
