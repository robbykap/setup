import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightBlock, languageForPath } from "./highlight.ts";

test("languageForPath resolves common extensions and swallows failures", () => {
  assert.equal(typeof (languageForPath("a/b/c.ts") ?? ""), "string");
  assert.equal(languageForPath("noext"), undefined);
});

test("highlightBlock preserves line count for real code", () => {
  const code = "const a = 1;\nfunction f() {\n  return a;\n}";
  const lines = highlightBlock(code, "typescript");
  assert.equal(lines.length, 4);
});

test("highlightBlock falls back to plain lines when language is unknown", () => {
  const code = "one\ntwo";
  assert.deepEqual(highlightBlock(code, "not-a-language-xyz"), ["one", "two"]);
  assert.deepEqual(highlightBlock(code, undefined), ["one", "two"]);
});
