/**
 * Emphasis laid over text that is already coloured.
 *
 * A word-level diff knows nothing about colour: wordSpans works on the raw
 * line, so its spans are offsets into plain characters. By the time a row is
 * rendered the same line is a chain of `\x1b[38;2;…m…\x1b[39m` runs from the
 * highlighter, and the offsets no longer line up with anything — the escape
 * bytes are not characters anyone can see, and cutting a string at a raw
 * offset lands in the middle of one as often as not. overlayRanges walks the
 * text counting only what is visible, so the emphasis is injected *around*
 * the codes already there rather than replacing them: every escape in comes
 * out again, in order, and the visible characters are untouched.
 *
 * Inside a range the same hazard paint.ts chases applies — a full `\x1b[0m`
 * or a background close `\x1b[49m` in the copied text cancels the emphasis
 * for the rest of the range, so each one is followed by the opener again.
 * Offsets count code points, not UTF-16 units, because that is how wordSpans
 * counts: one emoji is one character on both sides of the handoff.
 */

const RESET = "\x1b[0m";
const BG_CLOSE = "\x1b[49m"; // narrow background closer, and just as fatal here

export interface Range {
  /** Half-open [start, end) offsets into the VISIBLE characters of the text
   *  (i.e. the string with all ANSI escape sequences removed). */
  readonly start: number;
  readonly end: number;
}

/**
 * The length of the escape sequence starting at `index`, or 0 if what starts
 * there is not a complete `\x1b[…m`. An unterminated sequence is left as
 * visible text: better one stray character than a swallowed tail.
 */
function escapeLength(chars: ReadonlyArray<string>, index: number): number {
  if (chars[index] !== "\x1b" || chars[index + 1] !== "[") return 0;
  let end = index + 2;
  while (end < chars.length && /[0-9;]/.test(chars[end]!)) end += 1;
  return chars[end] === "m" ? end + 1 - index : 0;
}

/** Visible-character length: the count of code points that are not part of an
 *  ANSI escape sequence. */
export function visibleLength(text: string): number {
  const chars = [...text];
  let visible = 0;
  for (let index = 0; index < chars.length;) {
    const escape = escapeLength(chars, index);
    if (escape > 0) {
      index += escape;
    } else {
      visible += 1;
      index += 1;
    }
  }
  return visible;
}

/** Clamp, drop the empty ones, and fuse what touches — so callers can hand
 * over whatever their diff produced, in whatever order. */
function normalize(ranges: ReadonlyArray<Range>, limit: number): Range[] {
  const clamped = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, limit)),
      end: Math.max(0, Math.min(range.end, limit)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);

  const merged: Range[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** Wrap each visible range of `text` in `opener…closer`, leaving every escape
 * sequence already in `text` exactly where it was. */
export function overlayRanges(
  text: string,
  ranges: ReadonlyArray<Range>,
  opener: string,
  closer: string,
): string {
  if (ranges.length === 0 || !opener) return text;

  const chars = [...text];
  const spans = normalize(ranges, visibleLength(text));
  if (spans.length === 0) return text;

  let out = "";
  let visible = 0;
  let span = 0;
  let inside = false;

  for (let index = 0; index < chars.length;) {
    // A range is over the moment its last visible character is copied, so the
    // closer goes ahead of whatever escapes trail it — otherwise a reset just
    // past the end would be chased by an opener that dies on the next byte.
    if (inside && visible === spans[span]!.end) {
      out += closer;
      inside = false;
      span += 1;
    }

    const escape = escapeLength(chars, index);
    if (escape > 0) {
      const sequence = chars.slice(index, index + escape).join("");
      out += sequence;
      if (inside && (sequence === RESET || sequence === BG_CLOSE)) {
        out += opener;
      }
      index += escape;
      continue;
    }

    // The opener, by contrast, hugs its character: emitted ahead of the
    // escapes in front of it, a reset would cancel it on the spot.
    if (!inside && span < spans.length && visible === spans[span]!.start) {
      out += opener;
      inside = true;
    }

    out += chars[index];
    visible += 1;
    index += 1;
  }

  if (inside) out += closer;
  return out;
}
