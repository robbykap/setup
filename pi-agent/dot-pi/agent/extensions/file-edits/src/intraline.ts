/**
 * Word-level diff within a replaced line, so the eye lands on the part that
 * actually changed.
 *
 * The built-in renderer uses the `diff` package; this extension carries no
 * dependencies, so this is a plain LCS over word tokens. Lines are short, so
 * the quadratic table costs nothing.
 */

export interface Span {
  readonly text: string;
  readonly changed: boolean;
}

export interface WordSpans {
  readonly removed: ReadonlyArray<Span>;
  readonly added: ReadonlyArray<Span>;
}

/** Split into words and the runs of punctuation/space between them, so
 * rebuilt spans are byte-identical to the input. */
function tokenize(line: string): string[] {
  return line.match(/\w+|\W/g) ?? [];
}

function merge(tokens: string[], changed: boolean[]): Span[] {
  const spans: Span[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const last = spans[spans.length - 1];
    if (last && last.changed === changed[index]) {
      spans[spans.length - 1] = {
        text: last.text + tokens[index]!,
        changed: last.changed,
      };
    } else {
      spans.push({ text: tokens[index]!, changed: changed[index]! });
    }
  }
  return spans;
}

export function wordSpans(before: string, after: string): WordSpans {
  const left = tokenize(before);
  const right = tokenize(after);

  // lengths[i][j] = LCS length of left[i..] and right[j..]
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const leftChanged = new Array<boolean>(left.length).fill(true);
  const rightChanged = new Array<boolean>(right.length).fill(true);

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftChanged[i] = false;
      rightChanged[j] = false;
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    removed: merge(left, leftChanged),
    added: merge(right, rightChanged),
  };
}
