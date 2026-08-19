/**
 * Pins the subagents status segment. The theme is a REAL Theme, as in
 * takeover.test.ts: an error tail is only distinguishable from a neutral one
 * by the escapes it carries, which a stub returning its input never emits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../shared/tui-kit/icons.ts";
import { formatSubagentsStatus } from "./src/status.ts";

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
const icon = UI_ICONS.agent.glyph;

test("all-zero counts clear the segment", () => {
  assert.equal(
    formatSubagentsStatus(theme, { running: 0, done: 0, failed: 0 }),
    undefined,
  );
});

test("only the non-zero counts show, running first", () => {
  assert.equal(
    strip(formatSubagentsStatus(theme, { running: 2, done: 5, failed: 0 })!),
    `${icon} 2 running 5 done`,
  );
  assert.equal(
    strip(formatSubagentsStatus(theme, { running: 0, done: 3, failed: 0 })!),
    `${icon} 3 done`,
  );
});

test("failures carry the error colour wherever they land", () => {
  const trailing = formatSubagentsStatus(theme, {
    running: 1,
    done: 2,
    failed: 4,
  })!;
  assert.equal(strip(trailing), `${icon} 1 running 2 done 4 failed`);
  assert.ok(trailing.includes(theme.fg("error", "4 failed")));

  // Failures alone head the segment, where the shared shape paints the count
  // accent and the label muted rather than both in the error colour.
  const heading = formatSubagentsStatus(theme, {
    running: 0,
    done: 0,
    failed: 4,
  })!;
  assert.equal(strip(heading), `${icon} 4 failed`);
});
