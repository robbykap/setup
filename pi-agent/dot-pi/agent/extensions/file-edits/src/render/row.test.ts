import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCollapsedRow, PEEK_LINES } from "./row.ts";
import { parseUnifiedPatch } from "../diff.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

const parsed = parseUnifiedPatch(
  `@@ -37,3 +37,4 @@\n const ranked = rank(candidates)\n-return ranked[0]\n+const model = pickModel(ranked, effort)\n+if (!model) throw new NoModelError(effort)\n`,
)!;

const change = {
  path: "src/router.ts",
  hunks: parsed.hunks,
  added: 12,
  removed: 4,
  edits: 1,
  isNew: false,
  updatedAt: 0,
  origin: { kind: "self" } as const,
  hunksPending: false,
};

test("renders exactly two lines", () => {
  assert.equal(renderCollapsedRow(change, 80, theme).length, 2);
});

test("the header carries the path and the counts", () => {
  const [header] = renderCollapsedRow(change, 80, theme);
  assert.match(header!, /src\/router\.ts/);
  assert.match(header!, /\+12/);
  assert.match(header!, /−4/);
});

test("the peek shows changed lines, not context", () => {
  const [, peek] = renderCollapsedRow(change, 80, theme);
  assert.match(peek!, /pickModel/);
  assert.doesNotMatch(peek!, /const ranked/);
});

test("the peek is capped", () => {
  const many = parseUnifiedPatch(
    `@@ -1,1 +1,6 @@\n+a\n+b\n+c\n+d\n+e\n`,
  )!;
  const [, peek] = renderCollapsedRow({ ...change, hunks: many.hunks }, 80, theme);
  assert.equal(peek!.split("\n").length, 1);
  assert.equal(PEEK_LINES, 3);
});

test("every line fits the width", () => {
  // visibleWidth, not .length: paintIcon always emits truecolor escapes, so a
  // raw character count would measure the escape bytes too.
  for (const line of renderCollapsedRow(change, 30, theme)) {
    assert.ok(visibleWidth(line) <= 30, `too wide: ${JSON.stringify(line)}`);
  }
});

test("a file with no hunks renders a single header line", () => {
  const lines = renderCollapsedRow({ ...change, hunks: [], hunksPending: true }, 80, theme);
  assert.equal(lines.length, 1);
});

test("new files are labelled", () => {
  const [header] = renderCollapsedRow({ ...change, isNew: true, removed: 0 }, 80, theme);
  assert.match(header!, /new/);
});
