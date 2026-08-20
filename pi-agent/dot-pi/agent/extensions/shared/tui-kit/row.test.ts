/**
 * The shared tool row: icon + painted title + right-aligned outcome + dim
 * peek lines. The layout every transcript surface uses, so it is tested
 * once, here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { UI_ICONS } from "./icons.ts";
import { errorLine, peekLine, plainResultText, renderToolRow, toolCallTitle } from "./row.ts";

// plainResultText's more-lines hint goes through keyHint(), which reads the
// global theme singleton and throws until it has been initialized.
initTheme();

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
  assert.ok(lines[0]!.includes("✓"));
});

test("an ANSI-painted title still aligns the right-aligned outcome", () => {
  const lines = renderToolRow(
    {
      icon: UI_ICONS.terminal,
      title: theme.bold(theme.fg("text", "npm test")),
      right: "✓ ok",
    },
    40,
    theme,
  );
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]!), 40);
  assert.ok(lines[0]!.includes("✓ ok"));
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

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

test("plainResultText strips ANSI and control bytes", () => {
  const dirty = "\x1b[2J\x1b[31mhello\x1b[0m\x07 world\x1b]0;title\x07";
  const text = plainResultText(
    textResult(dirty),
    theme,
    { isError: false },
    { expanded: true },
  );
  // The kit's own theme.fg painting is allowed to add escapes; none of the
  // input's clear-screen/color/BEL/OSC-title bytes may survive into it.
  assert.ok(!text.includes("\x1b[2J"));
  assert.ok(!text.includes("\x1b[31m"));
  assert.ok(!text.includes("\x07"));
  assert.ok(!text.includes("title"));
  assert.ok(text.includes("hello world"));
});

test("plainResultText caps collapsed output at 10 lines with a hint", () => {
  const body = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  const text = plainResultText(
    textResult(body),
    theme,
    { isError: false },
    { expanded: false },
  );
  const lines = text.split("\n");
  assert.equal(lines.length, 11);
  assert.ok(lines.at(-1)!.includes("more lines"));
  assert.ok(text.includes("line 9"));
  assert.ok(!text.includes("line 10\n") && !text.includes("line 10)"));
});

test("plainResultText shows everything when expanded", () => {
  const body = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  const text = plainResultText(
    textResult(body),
    theme,
    { isError: false },
    { expanded: true },
  );
  assert.equal(text.split("\n").length, 25);
  assert.ok(text.includes("line 24"));
  assert.ok(!text.includes("more lines"));
});

test("plainResultText joins all text content blocks", () => {
  const result = {
    content: [
      { type: "text", text: "first" },
      { type: "image", data: "ignored" },
      { type: "text", text: "second" },
    ],
  };
  const text = plainResultText(
    result as never,
    theme,
    { isError: false },
    { expanded: true },
  );
  assert.ok(text.includes("first"));
  assert.ok(text.includes("second"));
});

test("plainResultText marks errors with a leading ✗ and error paint", () => {
  const text = plainResultText(
    textResult("boom"),
    theme,
    { isError: true },
    { expanded: true },
  );
  assert.ok(text.includes("✗ boom"));
});

test("plainResultText paints success lines with toolOutput", () => {
  const text = plainResultText(
    textResult("ok"),
    theme,
    { isError: false },
    { expanded: true },
  );
  assert.equal(text, theme.fg("toolOutput", "ok"));
});

test("errorLine sanitizes ANSI/control bytes and marks the first line", () => {
  const dirty = "\x1b[31mboom\x1b[0m\x07 raw stderr";
  const text = errorLine(dirty, theme);
  assert.ok(!text.includes("\x1b[31m"));
  assert.ok(!text.includes("\x07"));
  assert.ok(text.includes("✗ boom raw stderr"));
});

test("errorLine caps at 10 lines like plainResultText", () => {
  const body = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  const text = errorLine(body, theme);
  const lines = text.split("\n");
  assert.equal(lines.length, 11);
  assert.ok(lines.at(-1)!.includes("more lines"));
});

test("errorLine paints every line with error", () => {
  const text = errorLine("one\ntwo", theme);
  assert.equal(
    text,
    `${theme.fg("error", "✗ one")}\n${theme.fg("error", "two")}`,
  );
});

test("toolCallTitle folds whitespace runs and caps a long detail", () => {
  const title = toolCallTitle(
    UI_ICONS.terminal,
    "bg_start\n  name",
    "a\n\nb  " + "c".repeat(100),
    theme,
  );
  assert.ok(!title.includes("\n"));
  assert.ok(!title.includes("  "));
  assert.ok(title.includes("…"));
});
