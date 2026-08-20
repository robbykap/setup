import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import { UI_ICONS } from "../../../shared/tui-kit/icons.ts";
import {
  CollapsedRow,
  EmptyRow,
  LiveCallRow,
  LivePeekRow,
  RestoredRow,
  delegationContext,
  renderCollapsedRow,
} from "./row.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

/**
 * A REAL Theme for the one invariant that is about escapes rather than text:
 * the stub above returns its input, so it could never emit a background fill
 * whether or not the row asked for one. Built the way picker.test.ts does,
 * since the live singleton is not exported.
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

const realTheme = new Theme(
  fill(FG_COLORS, "#cba6f7") as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
) as never;

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: "call-1",
    tool: "bash",
    command: "git status --short",
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 0,
    durationMs: 420,
    status: "ok",
    output: "M src/ui/picker.ts\nM src/store.ts",
    outputLines: 2,
    outputBytes: 40,
    ...overrides,
  };
}

test("renders exactly two lines", () => {
  assert.equal(renderCollapsedRow(record(), 80, theme).length, 2);
});

test("the header carries the icon, command and the outcome", () => {
  const [header] = renderCollapsedRow(record(), 80, theme);
  assert.ok(header!.includes(UI_ICONS.terminal.glyph));
  assert.match(header!, /git status --short/);
  assert.match(header!, /420ms/);
  assert.match(header!, /2 lines/);
});

test("running call row shows icon, command, and running marker", () => {
  const row = new LiveCallRow();
  row.update("npm test", theme);
  const lines = row.render(60);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes(UI_ICONS.terminal.glyph));
  assert.ok(lines[0]!.includes("npm test"));
  assert.ok(lines[0]!.includes("running"));
});

test("live peek row shows the last output line, dim, no box", () => {
  const row = new LivePeekRow();
  row.update("compiling…\nlinking…\n", theme);
  const lines = row.render(60);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("linking…"));
  assert.ok(!lines[0]!.includes("\x1b[48"));
});

test("the peek is the last output line, not the first", () => {
  const [, peek] = renderCollapsedRow(record(), 80, theme);
  assert.match(peek!, /src\/store\.ts/);
  assert.doesNotMatch(peek!, /picker\.ts/);
});

test("a command that printed nothing is one line", () => {
  const lines = renderCollapsedRow(
    record({ output: "", outputLines: 0 }),
    80,
    theme,
  );
  assert.equal(lines.length, 1);
});

test("a failure shows its exit code", () => {
  const [header] = renderCollapsedRow(
    record({ status: "failed", exitCode: 128, output: "fatal: no repo" }),
    80,
    theme,
  );
  assert.match(header!, /exit 128/);
});

test("a multi-line script shows its first line and how much was folded", () => {
  const [header] = renderCollapsedRow(
    record({ command: "cd /tmp\nmake\nmake install" }),
    80,
    theme,
  );
  assert.match(header!, /cd \/tmp/);
  assert.match(header!, /\+2 more/);
  assert.doesNotMatch(header!, /make/);
});

test("no line is ever wider than the width it was given", () => {
  for (const width of [20, 40, 80, 200]) {
    for (const line of renderCollapsedRow(
      record({ command: "x".repeat(300), output: "y".repeat(300) }),
      width,
      theme,
    )) {
      assert.ok(
        visibleWidth(line) <= width,
        `line of ${visibleWidth(line)} cells at width ${width}`,
      );
    }
  }
});

test("colour codes in the output never reach the row", () => {
  // truncateToWidth adds its own reset codes, so the test is about the
  // output's escapes specifically: the ones that would make a line wider
  // than the cells we claim it occupies.
  const lines = renderCollapsedRow(
    record({ output: "done\r\n\u001b[32mok\u001b[0m", outputLines: 2 }),
    60,
    theme,
  );
  const peek = lines[1]!;
  assert.match(peek, /ok/);
  assert.doesNotMatch(peek, /\[32m/);
  assert.ok(visibleWidth(peek) <= 60);
});

test("the component reuses its record until told otherwise", () => {
  const row = new CollapsedRow();
  assert.deepEqual(row.render(80), []);
  row.update(record(), theme);
  assert.equal(row.render(80).length, 2);
});

test("a failed record collapses to header plus a plain output tail", () => {
  const failed = record({
    status: "failed",
    exitCode: 1,
    output: "make: *** [build] Error 1\nsrc/main.c:12: undefined reference\n",
    outputLines: 2,
  });
  const lines = renderCollapsedRow(failed, 80, realTheme);
  assert.ok(
    lines.length >= 2 && lines.length <= 4,
    `expected 2-4 lines, got ${lines.length}`,
  );
  // `\x1b[4` opens a background fill (48;…) or an underline: a failure is a
  // plain row like every other, foreground colours only.
  for (const line of lines) assert.ok(!line.includes("\x1b[4"), line);
});

test("a failure shows more of its tail than a success does", () => {
  const output = "one\ntwo\nthree\nfour";
  const ok = renderCollapsedRow(record({ output, outputLines: 4 }), 80, theme);
  const failed = renderCollapsedRow(
    record({ output, outputLines: 4, status: "failed", exitCode: 2 }),
    80,
    theme,
  );
  assert.equal(ok.length, 2);
  assert.equal(failed.length, 4);
  assert.deepEqual(
    failed.slice(1).map((line) => line.trim()),
    ["│ two", "│ three", "│ four"],
  );
});

test("delegation hides our components from the built-in renderer", () => {
  const ours = delegationContext({ lastComponent: new CollapsedRow() });
  assert.equal(ours.lastComponent, undefined);
  const empty = delegationContext({ lastComponent: new EmptyRow() });
  assert.equal(empty.lastComponent, undefined);
  const live = delegationContext({ lastComponent: new LiveCallRow() });
  assert.equal(live.lastComponent, undefined);
  const peek = delegationContext({ lastComponent: new LivePeekRow() });
  assert.equal(peek.lastComponent, undefined);
  const restored = delegationContext({ lastComponent: new RestoredRow() });
  assert.equal(restored.lastComponent, undefined);

  const theirs = new Container();
  assert.equal(delegationContext({ lastComponent: theirs }).lastComponent, theirs);
});

test("restored row shows the command and outcome, no duration or line count", () => {
  const row = new RestoredRow();
  row.update("npm test", "all good\n", false, theme);
  const lines = row.render(60);
  assert.ok(lines[0]!.includes(UI_ICONS.terminal.glyph));
  assert.ok(lines[0]!.includes("npm test"));
  assert.ok(lines[0]!.includes("done"));
});

test("a failed restored row shows failed and a deeper peek, no box", () => {
  const row = new RestoredRow();
  row.update("npm test", "one\ntwo\nthree\nfour", true, realTheme);
  const lines = row.render(60);
  assert.ok(lines[0]!.includes("failed"));
  assert.equal(lines.length, 4);
  for (const line of lines) assert.ok(!line.includes("\x1b[48"), line);
});
