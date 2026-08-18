/**
 * Turning raw process output into renderable rows.
 *
 * Process output contains ANSI colour, cursor movement and carriage returns.
 * Inside a fixed-height overlay those sequences smear the screen, so
 * everything is stripped down to plain text before it is displayed.
 */

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function sanitizeText(text: string): string {
  return text
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    // A lone carriage return means "redraw this line" (progress bars). There
    // is nothing to redraw in a scrollback view, so drop it.
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .replace(CONTROL, "");
}

/** Safe rendering of arbitrary text inside a single row. */
export function oneLine(text: string): string {
  return sanitizeText(text).replace(/\s+/g, " ").trim();
}

/** Sanitize, split on newlines, and hard-wrap at the given width. */
export function toLines(text: string, width: number): string[] {
  const clean = sanitizeText(text);
  if (clean === "") return [];
  const columns = Math.max(1, width);
  const out: string[] = [];
  for (const line of clean.split("\n")) {
    if (line.length <= columns) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += columns) {
      out.push(line.slice(i, i + columns));
    }
  }
  return out;
}

export interface LineCache {
  get(text: string, width: number): string[];
}

/** Wrapping runs on every repaint of a live task; memoize the last result so a
 * chatty process does not re-split its whole tail dozens of times a second. */
export function createLineCache(): LineCache {
  let cachedText: string | undefined;
  let cachedWidth = -1;
  let cachedLines: string[] = [];
  return {
    get(text, width) {
      if (text === cachedText && width === cachedWidth) return cachedLines;
      cachedText = text;
      cachedWidth = width;
      cachedLines = toLines(text, width);
      return cachedLines;
    },
  };
}
