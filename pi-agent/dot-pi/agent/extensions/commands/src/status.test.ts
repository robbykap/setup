/**
 * Pins the commands status segment. The theme is a REAL Theme, as in
 * render/row.test.ts: an error tail is only distinguishable from a neutral one
 * by the escapes it carries, which a stub returning its input never emits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../../shared/tui-kit/icons.ts";
import { formatCommandsStatus } from "./status.ts";

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
    error: "#f38ba8",
  } as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const icon = UI_ICONS.terminal.glyph;

test("no commands run clears the segment", () => {
  assert.equal(formatCommandsStatus(theme, { commands: 0, failed: 0 }), undefined);
});

test("the segment counts commands, singular at one", () => {
  assert.equal(
    strip(formatCommandsStatus(theme, { commands: 1, failed: 0 })!),
    `${icon} 1 cmd`,
  );
  assert.equal(
    strip(formatCommandsStatus(theme, { commands: 12, failed: 0 })!),
    `${icon} 12 cmds`,
  );
});

test("failures trail the count in the error colour", () => {
  const segment = formatCommandsStatus(theme, { commands: 12, failed: 3 })!;
  assert.equal(strip(segment), `${icon} 12 cmds 3✗`);
  assert.ok(segment.includes(theme.fg("error", "3✗")));
  assert.ok(!segment.includes(theme.fg("dim", "3✗")));
});
