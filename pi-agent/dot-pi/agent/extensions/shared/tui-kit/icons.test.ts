import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ALL_ICONS, iconFor, paintIcon } from "./icons.ts";

/** Assert on codepoints, not literal glyphs: a mangled private-use character
 * would otherwise make an empty-vs-empty comparison pass silently. */
function codePointOf(path: string) {
  return iconFor(path).glyph.codePointAt(0);
}

test("known extensions get their own glyph and color", () => {
  assert.equal(codePointOf("src/router.ts"), 0xe628);
  assert.deepEqual(iconFor("src/router.ts").rgb, [137, 180, 250]);
  assert.equal(codePointOf("a/b/main.py"), 0xe73c);
  assert.equal(codePointOf("theme.json"), 0xe60b);
  assert.equal(codePointOf("README.md"), 0xe73e);
});

test("every icon paints as exactly one cell", () => {
  for (const icon of ALL_ICONS) {
    assert.equal([...icon.glyph].length, 1);
    assert.equal(
      visibleWidth(paintIcon(icon)),
      1,
      `bad width for ${icon.glyph.codePointAt(0)?.toString(16)}`,
    );
  }
});

test("matching is case-insensitive", () => {
  assert.equal(codePointOf("A.TS"), codePointOf("a.ts"));
});

test("exact filenames win over extensions", () => {
  assert.equal(codePointOf("Dockerfile"), 0xe7b0);
  assert.equal(codePointOf("some/dir/Dockerfile"), 0xe7b0);
});

test("unknown extensions fall back to a generic document", () => {
  assert.equal(codePointOf("data.xyzzy"), 0xf016);
  assert.deepEqual(iconFor("data.xyzzy").rgb, [166, 173, 200]);
});

test("files with no extension fall back too", () => {
  assert.equal(codePointOf("LICENSE"), 0xf016);
});

test("paintIcon wraps the glyph in a truecolor escape", () => {
  const icon = iconFor("a.ts");
  assert.equal(paintIcon(icon), `\x1b[38;2;137;180;250m${icon.glyph}\x1b[0m`);
});

test("expanded coverage maps new extensions to their own glyphs", () => {
  assert.equal(codePointOf("a.rb"), 0xe739);
  assert.equal(codePointOf("b.java"), 0xe738);
  assert.equal(codePointOf("d.vue"), 0xe6a0);
  assert.equal(codePointOf("dir/.env"), 0xe615);
  assert.deepEqual(iconFor("dir/.env").rgb, [249, 226, 175]);
});
