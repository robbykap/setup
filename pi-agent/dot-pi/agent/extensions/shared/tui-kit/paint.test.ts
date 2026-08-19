/**
 * The fill invariant: a painted line is exactly `width` visible cells AND its
 * background reaches every one of them. The second half is what breaks in
 * practice — content carrying a full `\x1b[0m` reset clears the background
 * too, so a naive `opener + row + reset` drops the fill partway across. These
 * tests assert the re-opening, not just the width.
 *
 * Theme.fg/bg are NOT that hazard: they close with the narrow `\x1b[39m` /
 * `\x1b[49m`, which leave the other channel alone. The real source of full
 * resets in these rows is paintIcon (and syntax highlighting), so that is what
 * the row test below paints with.
 *
 * The theme here is a REAL Theme, for the same reason frame.test.ts uses one:
 * a stub whose helpers return their input emits no escape bytes, and escape
 * bytes are the entire subject.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { iconFor, paintIcon } from "./icons.ts";
import {
  DIFF_ADDED_BG,
  DIFF_REMOVED_BG,
  fillLine,
  openerOf,
  paintSelected,
  rgbBgOpener,
} from "./paint.ts";

const RESET = "\x1b[0m";
const BG_OPENER = "\x1b[48;5;237m";
const bg = (text: string) => `${BG_OPENER}${text}${RESET}`;

test("openerOf extracts the escape prefix of a paint function", () => {
  assert.equal(openerOf(bg), BG_OPENER);
  assert.equal(
    openerOf((t) => t),
    "",
  );
});

test("fillLine pads plain text to width under one background run", () => {
  const line = fillLine("abc", 10, BG_OPENER);
  assert.equal(visibleWidth(line), 10);
  assert.ok(line.startsWith(BG_OPENER));
  assert.ok(line.endsWith(RESET));
});

test("fillLine re-opens the background after inner resets", () => {
  const colored = `red\x1b[31mhot${RESET}end`;
  const line = fillLine(colored, 12, BG_OPENER);
  assert.equal(visibleWidth(line), 12);
  // Every reset inside is chased by the opener, so the fill never drops.
  const inner = line.slice(BG_OPENER.length, -RESET.length);
  for (const piece of inner.split(RESET).slice(1)) {
    assert.ok(piece.startsWith(BG_OPENER));
  }
});

test("fillLine without an opener is plain padding", () => {
  assert.equal(fillLine("abc", 6, ""), "abc   ");
});

test("fillLine truncates overlong rows to exactly width", () => {
  const line = fillLine("x".repeat(50), 10, rgbBgOpener(DIFF_ADDED_BG));
  assert.equal(visibleWidth(line), 10);
});

test("rgbBgOpener emits a truecolor background for the diff tints", () => {
  assert.equal(rgbBgOpener(DIFF_ADDED_BG), "\x1b[48;2;40;52;46m");
  assert.notEqual(rgbBgOpener(DIFF_REMOVED_BG), rgbBgOpener(DIFF_ADDED_BG));
});

// --- against a real theme ---------------------------------------------------

// The Theme constructor resolves every name in the fg record, so the list has
// to be complete — same roster frame.test.ts builds its theme from.
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

// `muted` differs from `accent` so the two fg runs in the row test are
// distinguishable byte sequences.
const theme = new Theme(
  { ...fill(FG_COLORS, "#cba6f7"), muted: "#6c7086" } as never,
  fill(BG_COLORS, "#45475a") as never,
  "truecolor",
);

test("the test theme really does emit background escape sequences", () => {
  const painted = theme.bg("selectedBg", "x");
  assert.ok(painted.length > 1, "theme produced no ANSI escapes");
  assert.equal(visibleWidth(painted), 1);
});

test("paintSelected fills the row with the theme's selection background", () => {
  const opener = openerOf((t) => theme.bg("selectedBg", t));
  assert.ok(opener.length > 0, "selectedBg produced no opener");

  const line = paintSelected("hello", 20, theme);
  assert.equal(visibleWidth(line), 20);
  assert.ok(line.includes(opener));
});

test("paintSelected holds the background across an icon's full reset", () => {
  const opener = openerOf((t) => theme.bg("selectedBg", t));
  const row = `${paintIcon(iconFor("main.ts"))} ${theme.fg("text", "main.ts")}`;
  const line = paintSelected(row, 30, theme);

  assert.equal(visibleWidth(line), 30);
  // One opener for the row, plus one chasing the icon's \x1b[0m.
  assert.equal(line.split(opener).length - 1, 2);
  // The theme's own narrow fg reset needs no chasing, and gets none.
  assert.ok(!line.includes(`\x1b[39m${opener}`));
});
