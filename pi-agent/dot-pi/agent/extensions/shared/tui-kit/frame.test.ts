/**
 * Overlay geometry primitives. These exist because the first version of the
 * file-edits overlays shipped with lines that were 2 cells too wide, 1 cell
 * too narrow, and a header that collapsed to its content width — which made
 * the panels look shattered even though every unit test passed.
 *
 * The invariant every primitive here upholds: whatever it returns is exactly
 * `width` VISIBLE cells. Tests that render a whole extension overlay live with
 * that extension (see file-edits/src/ui/geometry.test.ts); this file must not
 * import from any extension.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { bodyHeight, bodyRow, pad, sectionRule, topBorder } from "./frame.ts";

/**
 * A REAL Theme, not a stub whose helpers return their input. The entire bug
 * class here is ANSI escape bytes being counted as visible cells, so a theme
 * that emits no escapes would test nothing. The live singleton is not part of
 * the package's public exports, so we build an equivalent one.
 */
const FG_COLORS = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error",
  "warning", "muted", "dim", "text", "thinkingText", "searchMatchText",
  "userMessageText", "customMessageText", "customMessageLabel", "toolTitle",
  "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
  "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];
const BG_COLORS = [
  "selectedBg", "scrollbarThumb", "searchMatchBg", "userMessageBg",
  "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg",
];
const fill = (names: string[], hex: string) =>
  Object.fromEntries(names.map((name) => [name, hex]));

const theme = new Theme(
  fill(FG_COLORS, "#cba6f7") as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

test("the test theme really does emit escape sequences", () => {
  const painted = theme.fg("accent", "x");
  assert.ok(painted.length > 1, "theme produced no ANSI escapes");
  assert.equal(visibleWidth(painted), 1);
});

const ROWS = 30;

// --- the primitives ---------------------------------------------------------

test("pad fits styled text to exactly the given width", () => {
  assert.equal(visibleWidth(pad(theme.fg("accent", "hi"), 10)), 10);
  assert.equal(visibleWidth(pad("", 7)), 7);
  // Over-long input is truncated, not allowed to overflow.
  assert.equal(visibleWidth(pad("x".repeat(40), 10)), 10);
});

test("borders and rows are exactly the requested width", () => {
  for (const width of [20, 61, 100]) {
    assert.equal(visibleWidth(topBorder(theme, width)), width);
    assert.equal(visibleWidth(topBorder(theme, width, "a label")), width);
    assert.equal(visibleWidth(bodyRow(theme, width, "")), width);
    assert.equal(
      visibleWidth(bodyRow(theme, width, theme.fg("accent", "content"))),
      width,
    );
  }
});

test("a label longer than the border cannot overflow it", () => {
  assert.equal(visibleWidth(topBorder(theme, 20, "x".repeat(80))), 20);
});

test("sectionRule is exactly width cells, label truncated", () => {
  const rule = sectionRule(theme, 20, "a very long label that cannot fit");
  assert.equal(visibleWidth(rule), 20);
  const bare = sectionRule(theme, 20);
  assert.equal(visibleWidth(bare), 20);
});

test("the body leaves exactly one row for pi's footer", () => {
  // 4 chrome lines + body = rows - 1.
  assert.equal(bodyHeight(ROWS, 4) + 4, ROWS - 1);
  // Tiny terminals still get a usable panel rather than a negative height.
  assert.ok(bodyHeight(5, 4) >= 6);
});
