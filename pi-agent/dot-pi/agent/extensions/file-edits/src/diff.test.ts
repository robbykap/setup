import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnifiedPatch, largestHunk } from "./diff.ts";

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
