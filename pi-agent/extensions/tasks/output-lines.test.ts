import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLineCache,
  oneLine,
  sanitizeText,
  toLines,
} from "./src/ui/output-lines.ts";

test("sanitizeText strips ANSI escapes and carriage returns", () => {
  assert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
  assert.equal(sanitizeText("a\rb"), "ab");
  assert.equal(sanitizeText("keep\ttabs and\nnewlines"), "keep    tabs and\nnewlines");
});

test("sanitizeText drops other control characters", () => {
  assert.equal(sanitizeText("bel\u0007end"), "belend");
});

test("oneLine collapses everything onto a single row", () => {
  assert.equal(oneLine("two\nlines  here"), "two lines here");
});

test("toLines splits on newlines and wraps at the width", () => {
  assert.deepEqual(toLines("abcdef\ngh", 3), ["abc", "def", "gh"]);
});

test("toLines preserves empty lines", () => {
  assert.deepEqual(toLines("a\n\nb", 10), ["a", "", "b"]);
});

test("toLines of empty text is empty", () => {
  assert.deepEqual(toLines("", 10), []);
});

test("the line cache recomputes only when text or width changes", () => {
  const cache = createLineCache();
  const first = cache.get("a\nb", 10);
  assert.equal(cache.get("a\nb", 10), first, "same inputs reuse the array");
  assert.notEqual(cache.get("a\nb", 4), first, "a new width recomputes");
  assert.deepEqual(cache.get("a\nc", 10), ["a", "c"]);
});
