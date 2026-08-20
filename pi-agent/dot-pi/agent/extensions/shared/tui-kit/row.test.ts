/**
 * The shared tool row: icon + painted title + right-aligned outcome + dim
 * peek lines. The layout every transcript surface uses, so it is tested
 * once, here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { UI_ICONS } from "./icons.ts";
import { peekLine, renderToolRow, toolCallTitle } from "./row.ts";

/** A REAL Theme, not a stub — see frame.test.ts for why. */
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
  { ...fill(FG_COLORS, "#cdd6f4"), muted: "#6c7086", dim: "#585b70" } as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

test("header carries the icon, title left, outcome right", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "npm test", right: "✓ ok" },
    40,
    theme,
  );
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes(UI_ICONS.terminal.glyph));
  assert.ok(lines[0]!.includes("npm test"));
  assert.ok(lines[0]!.includes("✓ ok"));
  // Right-aligned: outcome ends at the row edge.
  assert.equal(visibleWidth(lines[0]!), 40);
});

test("peek lines render dim gutters and skip blanks", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "ls", peek: ["a.ts", "   ", "b.ts"] },
    40,
    theme,
  );
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.includes("│"));
  assert.ok(lines[1]!.includes("a.ts"));
  assert.ok(lines[2]!.includes("b.ts"));
});

test("no line carries a background fill", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "npm test", right: "✓", peek: ["done"] },
    40,
    theme,
  );
  for (const line of lines) assert.ok(!line.includes("\x1b[48"));
});

test("a too-long header truncates instead of wrapping", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "x".repeat(100), right: "✓" },
    30,
    theme,
  );
  assert.equal(lines.length, 1);
  assert.ok(visibleWidth(lines[0]!) <= 30);
});

test("toolCallTitle paints icon, bold name, and detail", () => {
  const title = toolCallTitle(UI_ICONS.agent, "subagent_spawn", "fix tests", theme);
  assert.ok(title.includes(UI_ICONS.agent.glyph));
  assert.ok(title.includes("subagent_spawn"));
  assert.ok(title.includes("fix tests"));
});

test("peekLine fits the width", () => {
  assert.ok(visibleWidth(peekLine("hello", 20, theme)) <= 20);
});
