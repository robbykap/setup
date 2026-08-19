/**
 * Pins the file-edits status segment. The theme is a REAL Theme, as in
 * render/row.test.ts: the subject is partly which colour role paints which run
 * of text, and a stub that returns its input emits no colour at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { FALLBACK_FILE_ICON } from "../../shared/tui-kit/icons.ts";
import { formatFilesStatus } from "./status.ts";

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
  {
    ...fill(FG_COLORS, "#cdd6f4"),
    accent: "#89b4fa",
    muted: "#6c7086",
    dim: "#585b70",
    toolDiffAdded: "#a6e3a1",
    toolDiffRemoved: "#f38ba8",
  } as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const icon = FALLBACK_FILE_ICON.glyph;

test("no touched files clears the segment", () => {
  assert.equal(
    formatFilesStatus(theme, { files: 0, added: 0, removed: 0 }),
    undefined,
  );
});

test("the segment counts files and trails the diff totals", () => {
  const segment = formatFilesStatus(theme, {
    files: 3,
    added: 12,
    removed: 4,
  })!;
  assert.equal(strip(segment), `${icon} 3 files +12 −4`);
  assert.ok(segment.includes(theme.fg("toolDiffAdded", "+12")));
  assert.ok(segment.includes(theme.fg("toolDiffRemoved", "−4")));
});

test("a zero diff total leaves no tail, and one file is singular", () => {
  assert.equal(
    strip(formatFilesStatus(theme, { files: 1, added: 0, removed: 7 })!),
    `${icon} 1 file −7`,
  );
  assert.equal(
    strip(formatFilesStatus(theme, { files: 2, added: 9, removed: 0 })!),
    `${icon} 2 files +9`,
  );
  assert.equal(
    strip(formatFilesStatus(theme, { files: 2, added: 0, removed: 0 })!),
    `${icon} 2 files`,
  );
});
