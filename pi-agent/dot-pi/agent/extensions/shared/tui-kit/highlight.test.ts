import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { highlightBlock, languageForPath } from "./highlight.ts";

test("languageForPath resolves common extensions and swallows failures", () => {
  assert.equal(languageForPath("a/b/c.ts"), "typescript");
  assert.equal(languageForPath("noext"), undefined);
});

test("highlightBlock preserves line count for real code", () => {
  const code = "const a = 1;\nfunction f() {\n  return a;\n}";
  const lines = highlightBlock(code, "typescript");
  assert.equal(lines.length, 4);
});

test("highlightBlock falls back to plain lines when the highlighter throws (no theme initialised)", () => {
  // Without initTheme the unknown-language branch reads theme.fg and throws.
  const code = "one\ntwo";
  assert.deepEqual(highlightBlock(code, "not-a-language-xyz"), ["one", "two"]);
  assert.deepEqual(highlightBlock(code, undefined), ["one", "two"]);
});

// Last on purpose: initTheme mutates a global singleton, and the tests above
// depend on the theme still being uninitialised.
test("highlightBlock preserves line count under a live theme", () => {
  initTheme("dark");
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const unknown = highlightBlock("one\ntwo", "not-a-language-xyz");
  assert.equal(unknown.length, 2);
  assert.deepEqual(unknown.map(strip), ["one", "two"]);

  const code = "const a = 1;\nfunction f() {\n  return a;\n}";
  assert.equal(highlightBlock(code, "typescript").length, 4);
});
