import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffContents,
  parseUnifiedPatch,
  largestHunk,
  pairRows,
} from "./diff.ts";

const PATCH = `--- a/src/router.ts
+++ b/src/router.ts
@@ -37,3 +37,4 @@
 const ranked = rank(candidates)
-return ranked[0]
+const model = pickModel(ranked, effort)
+if (!model) throw new NoModelError(effort)
`;

test("parses hunks with old and new line numbers", () => {
  const parsed = parseUnifiedPatch(PATCH);
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 1);
  const hunk = parsed.hunks[0]!;
  assert.equal(hunk.oldStart, 37);
  assert.equal(hunk.newStart, 37);
  assert.deepEqual(
    hunk.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    [
      ["context", 37, 37],
      ["remove", 38, undefined],
      ["add", undefined, 38],
      ["add", undefined, 39],
    ],
  );
});

test("counts additions and removals", () => {
  const parsed = parseUnifiedPatch(PATCH);
  assert.equal(parsed?.added, 2);
  assert.equal(parsed?.removed, 1);
});

test("handles multiple hunks", () => {
  const parsed = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,2 @@\n c\n+d\n`,
  );
  assert.equal(parsed?.hunks.length, 2);
  assert.equal(parsed?.hunks[1]?.oldStart, 10);
  assert.equal(parsed?.added, 2);
});

test("ignores the no-newline marker", () => {
  const parsed = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n`);
  assert.equal(parsed?.removed, 1);
  assert.equal(parsed?.added, 1);
  assert.equal(parsed?.hunks[0]?.lines.length, 2);
});

test("returns null for text that is not a patch", () => {
  assert.equal(parseUnifiedPatch("not a patch at all"), null);
  assert.equal(parseUnifiedPatch(""), null);
});

test("single-line hunk headers without counts are accepted", () => {
  const parsed = parseUnifiedPatch(`@@ -5 +5 @@\n-a\n+b\n`);
  assert.equal(parsed?.hunks[0]?.oldStart, 5);
});

test("largestHunk picks the hunk with the most changed lines", () => {
  const parsed = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,3 @@\n c\n+d\n+e\n+f\n`,
  )!;
  assert.equal(largestHunk(parsed.hunks)?.oldStart, 10);
});

test("largestHunk returns undefined for no hunks", () => {
  assert.equal(largestHunk([]), undefined);
});

test("context lines appear on both sides of a split", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n a\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [["a", "a"]],
  );
});

test("a removal and an addition line up on one row", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n-old\n+new\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [["old", "new"]],
  );
});

test("extra additions get empty left cells", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,3 @@\n-old\n+a\n+b\n+c\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [
      ["old", "a"],
      [undefined, "b"],
      [undefined, "c"],
    ],
  );
});

test("extra removals get empty right cells", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,3 +1,1 @@\n-a\n-b\n+c\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [
      ["a", "c"],
      ["b", undefined],
    ],
  );
});

test("hunks are separated by a gap row", () => {
  const { hunks } = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n a\n@@ -9,1 +9,1 @@\n b\n`,
  )!;
  const rows = pairRows(hunks);
  assert.equal(rows.length, 3);
  assert.equal(rows[1]!.separator, true);
});

test("a removed line that starts with -- is not mistaken for a header", () => {
  const parsed = parseUnifiedPatch(
    `@@ -1,2 +1,2 @@\n--- old comment\n+-- new comment\n ok\n`,
  );
  assert.equal(parsed?.removed, 1);
  assert.equal(parsed?.added, 1);
  const kinds = parsed!.hunks[0]!.lines.map((line) => line.kind);
  assert.deepEqual(kinds, ["remove", "add", "context"]);
  // The context line must still be numbered after the removal it follows.
  assert.equal(parsed!.hunks[0]!.lines[2]!.oldLine, 2);
});

test("an added line that starts with ++ is not mistaken for a header", () => {
  const parsed = parseUnifiedPatch(`@@ -1,1 +1,2 @@\n c\n+++i;\n`);
  assert.equal(parsed?.added, 1);
  assert.equal(parsed!.hunks[0]!.lines[1]!.text, "++i;");
});

test("a multi-file patch splits into separate hunks", () => {
  const parsed = parseUnifiedPatch(
    `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -5,1 +5,1 @@\n-c\n+d\n`,
  );
  assert.equal(parsed?.hunks.length, 2);
  assert.equal(parsed?.hunks[1]?.oldStart, 5);
  assert.equal(parsed?.added, 2);
});

// diffContents is the baseline-vs-disk half of the module: no tool hands us a
// patch for a `write`, or for anything a subagent did.
test("identical contents are not a diff", () => {
  assert.equal(diffContents("a.ts", "one\ntwo\n", "one\ntwo\n"), null);
});

test("a replaced line is one hunk, counted once each way", () => {
  const parsed = diffContents("a.ts", "one\ntwo\n", "one\nTWO\n");
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.added, 1);
  assert.equal(parsed.removed, 1);
  const texts = parsed.hunks[0]!.lines.map((line) => line.text);
  assert.ok(texts.includes("TWO"));
  assert.ok(texts.includes("two"));
});

test("a file that did not exist reads as all additions", () => {
  const parsed = diffContents("a.ts", "", "one\ntwo\n");
  assert.equal(parsed?.added, 2);
  assert.equal(parsed?.removed, 0);
});

test("an append at end of file only adds", () => {
  const parsed = diffContents("a.ts", "one\n", "one\ntwo\n");
  assert.equal(parsed?.added, 1);
  assert.equal(parsed?.removed, 0);
});

test("content with no trailing newline still diffs", () => {
  const parsed = diffContents("a.ts", "one", "two");
  assert.equal(parsed?.added, 1);
  assert.equal(parsed?.removed, 1);
  // The "\\ No newline at end of file" marker annotates a line; it is not one.
  assert.ok(
    parsed!.hunks[0]!.lines.every((line) => !line.text.startsWith("No newline")),
  );
});
