/**
 * The picker overlay's geometry, and the selection fill.
 *
 * rows.test.ts covers the row model with a stub theme; this suite renders the
 * real component with a real Theme, because the invariants here are about ANSI
 * escapes: every line is exactly `width` VISIBLE cells, and the selected row —
 * and only the selected row — carries the theme's selection background.
 *
 * Mirrors file-edits/src/ui/geometry.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { openerOf } from "../../../shared/tui-kit/paint.ts";
import type { CommandRecord } from "../domain.ts";
import { createCommandStore, type CommandStore } from "../store.ts";
import { CommandPicker } from "./picker.ts";

/**
 * A REAL Theme, not a stub whose helpers return their input: a theme that
 * emits no escapes would test nothing. The live singleton is not part of the
 * package's public exports, so we build an equivalent one.
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

/**
 * A real KeybindingsManager, but cast: pi-tui and pi-coding-agent each expose
 * a KeybindingsManager type, and depending on where the extension is checked
 * from they resolve to two declarations of the same runtime class.
 */
const keybindings = getKeybindings() as never;
const ROWS = 30;
/** The whole overlay is terminal rows - 1, leaving pi's footer visible. */
const EXPECTED_LINES = ROWS - 1;

function stubTui(columns = 100) {
  return { requestRender() {}, terminal: { rows: ROWS, columns } } as never;
}

function record(id: string, at: number): CommandRecord {
  return {
    id,
    tool: "bash",
    command: `echo ${id}`,
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: at,
    durationMs: 10,
    status: "ok",
    output: "",
    outputLines: 0,
    outputBytes: 0,
  };
}

function storeWith(count: number): CommandStore {
  const store = createCommandStore();
  const now = Date.now();
  for (let index = 0; index < count; index += 1) {
    store.record(record(`c${index}`, now - index * 1000));
  }
  return store;
}

function assertExact(lines: string[], width: number, label: string) {
  lines.forEach((line, index) => {
    assert.equal(
      visibleWidth(line),
      width,
      `${label}: line ${index} is ${visibleWidth(line)} cells, want ${width}\n${JSON.stringify(line)}`,
    );
  });
}

for (const width of [100, 72, 60]) {
  test(`picker renders exact-width lines at ${width}`, () => {
    const picker = new CommandPicker(
      stubTui(width),
      theme,
      keybindings,
      storeWith(3),
      { query: "", index: 0 },
      () => {},
    );
    const lines = picker.render(width);
    assertExact(lines, width, `picker@${width}`);
    assert.equal(lines.length, EXPECTED_LINES);
  });
}

test("the selected row carries the selection background, and only it", () => {
  const picker = new CommandPicker(
    stubTui(),
    theme,
    keybindings,
    storeWith(3),
    { query: "", index: 1 },
    () => {},
  );
  const lines = picker.render(100);
  const opener = openerOf((text) => theme.bg("selectedBg", text));
  assert.ok(opener.length > 0, "the theme produced no selection background");

  const filled = lines.filter((line) => line.includes(opener));
  assert.equal(filled.length, 1, "exactly one row should be highlighted");
  // Two lines of chrome above the body, and index 1 with a short list that
  // starts at row 0.
  assert.equal(filled[0], lines[3]);
  assertExact(lines, 100, "picker with a selection fill");
});
