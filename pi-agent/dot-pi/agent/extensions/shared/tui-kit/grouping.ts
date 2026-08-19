/**
 * Grouping for pickers: a render-time transform only. Selection, filtering,
 * and store order stay flat; this interleaves header rows and answers where
 * a flat index landed, so the cursor math never learns about groups.
 */

export type DisplayRow<T> =
  | { readonly kind: "header"; readonly label: string }
  | { readonly kind: "item"; readonly item: T; readonly index: number };

/** Group order follows first appearance in the input. Pickers hand us
 * most-recent-first rows, so the most recently active group leads. */
export function groupRows<T>(
  items: ReadonlyArray<T>,
  labelOf: (item: T) => string,
): ReadonlyArray<DisplayRow<T>> {
  const rows: DisplayRow<T>[] = [];
  const seen = new Map<string, DisplayRow<T>[]>();
  for (const [index, item] of items.entries()) {
    const label = labelOf(item);
    let bucket = seen.get(label);
    if (!bucket) {
      bucket = [];
      seen.set(label, bucket);
    }
    bucket.push({ kind: "item", item, index });
  }
  for (const [label, bucket] of seen) {
    rows.push({ kind: "header", label }, ...bucket);
  }
  return rows;
}

/** Where a flat item index renders, or -1 when it is not on screen. */
export function displayIndexOf<T>(
  rows: ReadonlyArray<DisplayRow<T>>,
  itemIndex: number,
): number {
  return rows.findIndex(
    (row) => row.kind === "item" && row.index === itemIndex,
  );
}
