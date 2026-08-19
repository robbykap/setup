/**
 * Pins the background-terminals status segment, above all the one thing that
 * regressed: the head count means "terminals this session is tracking" on both
 * sides of the settle boundary, and only the icon and the tail change there.
 *
 * The theme is a REAL Theme, as in ps.test.ts, since which colour role paints
 * which run of text is part of the subject.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { UI_ICONS } from "../shared/tui-kit/icons.ts";
import { formatTerminalsStatus } from "./src/status.ts";

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
const clock = UI_ICONS.clock.glyph;
const check = UI_ICONS.check.glyph;

test("no tracked terminals clears the segment", () => {
  assert.equal(formatTerminalsStatus(theme, { terminals: 0, running: 0 }), undefined);
});

test("the count stays the tracked total across the settle boundary", () => {
  const running = formatTerminalsStatus(theme, { terminals: 5, running: 1 })!;
  assert.equal(strip(running), `${clock} 5 terminals 1 running`);

  const settled = formatTerminalsStatus(theme, { terminals: 5, running: 0 })!;
  assert.equal(strip(settled), `${check} 5 terminals`);
});

test("the running tail is neutral, not an error", () => {
  const segment = formatTerminalsStatus(theme, { terminals: 3, running: 3 })!;
  assert.ok(segment.includes(theme.fg("dim", "3 running")));
  assert.ok(!segment.includes(theme.fg("error", "3 running")));
});

test("one terminal is singular whether it runs or has settled", () => {
  assert.equal(
    strip(formatTerminalsStatus(theme, { terminals: 1, running: 1 })!),
    `${clock} 1 terminal 1 running`,
  );
  assert.equal(
    strip(formatTerminalsStatus(theme, { terminals: 1, running: 0 })!),
    `${check} 1 terminal`,
  );
});
