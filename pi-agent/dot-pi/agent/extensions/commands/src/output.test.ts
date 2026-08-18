import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildOutputLines,
  createOutputLineCache,
  oneLine,
  sanitizeText,
} from "./output.ts";

test("ansi colour codes are stripped", () => {
  assert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
});

test("osc payloads do not survive as visible text", () => {
  assert.equal(sanitizeText("\u001b]0;my title\u0007ok"), "ok");
});

test("tabs become spaces, control bytes disappear", () => {
  assert.equal(sanitizeText("a\tb\u0000c"), "a  bc");
});

test("newlines never survive a one-line render", () => {
  assert.equal(oneLine("git status\n--short  "), "git status --short");
});

test("long lines are wrapped to the width, never wider", () => {
  const lines = buildOutputLines("x".repeat(120), 40);
  assert.ok(lines.length >= 3);
  for (const line of lines) assert.ok(visibleWidth(line) <= 40);
});

test("blank lines are kept, so output keeps its shape", () => {
  assert.deepEqual(buildOutputLines("a\n\nb", 40), ["a", "", "b"]);
});

test("the cache rewraps when the key or the width changes", () => {
  const cache = createOutputLineCache();
  const first = cache.get("a b c", "one", 40);
  assert.equal(cache.get("a b c", "one", 40), first);
  assert.notEqual(cache.get("a b c", "one", 10), first);
  assert.notEqual(cache.get("different", "two", 10), first);
});
