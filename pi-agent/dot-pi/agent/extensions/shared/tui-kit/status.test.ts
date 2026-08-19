/**
 * Tests for the one status-segment shape. The theme is a REAL Theme, as in
 * frame.test.ts and paint.test.ts: the subject is which colour role paints
 * which run of text, and a stub that returns its input emits no colour at all.
 * `error` and `dim` therefore get hexes distinct from everything else, so a
 * test can tell an error tail from a neutral one by its bytes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { UI_ICONS, paintIcon } from "./icons.ts";
import { statusSegment } from "./status.ts";

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
    error: "#f38ba8",
    dim: "#585b70",
  } as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("renders icon, count, then label", () => {
  const segment = statusSegment(theme, UI_ICONS.terminal, 3, "cmds");
  assert.equal(strip(segment), `${UI_ICONS.terminal.glyph} 3 cmds`);
  assert.ok(segment.includes(paintIcon(UI_ICONS.terminal)));
  assert.ok(segment.includes(theme.fg("accent", "3")));
  assert.ok(segment.includes(theme.fg("muted", "cmds")));
});

test("a string count is rendered as given", () => {
  assert.equal(
    strip(statusSegment(theme, UI_ICONS.agent, "2/5", "agents")),
    `${UI_ICONS.agent.glyph} 2/5 agents`,
  );
});

test("error tails carry the error colour, neutral tails the dim one", () => {
  const segment = statusSegment(theme, UI_ICONS.terminal, 3, "cmds", [
    { text: "1✗", kind: "error" },
    { text: "+9", kind: "neutral" },
  ]);
  assert.equal(strip(segment), `${UI_ICONS.terminal.glyph} 3 cmds 1✗ +9`);
  assert.ok(segment.includes(theme.fg("error", "1✗")));
  assert.ok(segment.includes(theme.fg("dim", "+9")));
  // The two colours really are distinguishable in this fixture.
  assert.notEqual(theme.fg("error", "x"), theme.fg("dim", "x"));
  assert.ok(!segment.includes(theme.fg("error", "+9")));
});

test("a tail's paint override wins over its kind", () => {
  const segment = statusSegment(theme, UI_ICONS.terminal, 1, "cmds", [
    {
      text: "+9",
      kind: "neutral",
      paint: (text) => theme.fg("toolDiffAdded", text),
    },
  ]);
  assert.ok(segment.includes(theme.fg("toolDiffAdded", "+9")));
  assert.ok(!segment.includes(theme.fg("dim", "+9")));
  assert.equal(strip(segment), `${UI_ICONS.terminal.glyph} 1 cmds +9`);
});

test("the segment is exactly as wide as its unstyled text", () => {
  const cases: Array<[number | string, string, Parameters<typeof statusSegment>[4]]> = [
    [7, "files", undefined],
    [12, "cmds", [{ text: "3✗", kind: "error" }]],
    [1, "agents", [{ text: "+120", kind: "neutral" }, { text: "−4", kind: "neutral" }]],
  ];
  for (const [count, label, tails] of cases) {
    const segment = statusSegment(theme, UI_ICONS.clock, count, label, tails);
    const plain = [`x ${count} ${label}`, ...(tails ?? []).map((t) => t.text)]
      .join(" ");
    assert.equal(visibleWidth(segment), visibleWidth(plain));
  }
});

test("every icon leaves the segment one cell wider than its text", () => {
  // Guards the "<1 cell>" assumption above: nerd-font glyphs must not be wide.
  for (const icon of [UI_ICONS.clock, UI_ICONS.check, UI_ICONS.agent]) {
    assert.equal(visibleWidth(paintIcon(icon)), 1);
  }
});
