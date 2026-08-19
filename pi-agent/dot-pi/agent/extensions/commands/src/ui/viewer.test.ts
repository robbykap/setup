import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import { formatStatus, statusColor } from "../domain.ts";
import { createCommandStore } from "../store.ts";
import {
  buildBody,
  CommandViewer,
  createViewerState,
  stepId,
} from "./viewer.ts";

const ids = ["a", "b", "c"];

test("n and p walk the list", () => {
  assert.equal(stepId(ids, "a", 1), "b");
  assert.equal(stepId(ids, "b", -1), "a");
});

test("walking wraps at both ends", () => {
  assert.equal(stepId(ids, "c", 1), "a");
  assert.equal(stepId(ids, "a", -1), "c");
});

test("a record that left the list lands on the first one", () => {
  assert.equal(stepId(ids, "gone", 1), "a");
});

test("an empty list goes nowhere", () => {
  assert.equal(stepId([], "a", 1), null);
});

test("the viewer prefers the full log when there is one", () => {
  assert.equal(createViewerState().full, true);
});

// --- the framed command block -----------------------------------------------

/**
 * A REAL Theme, for the reason picker.test.ts spells out: a stub whose helpers
 * return their input emits no escape bytes, and the escapes — the status
 * colour, and the width they must not add — are the subject here.
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
// Two colours, so a rule painted with the wrong one is visibly wrong: with a
// single hex everywhere, "error" and "success" would emit the same bytes.
const theme = new Theme(
  { ...fill(FG_COLORS, "#cba6f7"), error: "#f38ba8" } as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);
const keybindings = getKeybindings() as never;

const stripAnsi = (line: string) => line.replaceAll(/\x1b\[[0-9;]*m/g, "");

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: "c1",
    tool: "bash",
    command: "npm test",
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 0,
    durationMs: 1200,
    status: "ok",
    exitCode: 0,
    output: "all good",
    outputLines: 1,
    outputBytes: 8,
    ...overrides,
  };
}

const WIDTH = 78;

test("the block runs command, output, then result", () => {
  const lines = buildBody(record(), ["all good"], theme, WIDTH);
  assert.match(stripAnsi(lines[0]!), /\$ npm test/);
  assert.ok(
    lines.some((line) => stripAnsi(line).includes("output")),
    "no output rule",
  );
  assert.match(stripAnsi(lines.at(-1)!), /ok · 1\.2s/);
});

test("every line of the block fits the width it was given", () => {
  const lines = buildBody(
    record({ command: "x".repeat(300) }),
    ["y".repeat(300), "short"],
    theme,
    WIDTH,
  );
  for (const line of lines) assert.ok(visibleWidth(line) <= WIDTH, line);
});

test("a script longer than three lines is shown whole", () => {
  // The old viewer clamped the command to three lines, which hid the tail of
  // every heredoc anyone came here to read.
  const command = ["a", "b", "c", "d", "e"].map((n) => `echo ${n}`).join("\n");
  const lines = buildBody(record({ command }), [], theme, WIDTH);
  for (const name of ["a", "b", "c", "d", "e"]) {
    assert.ok(
      lines.some((line) => stripAnsi(line).includes(`echo ${name}`)),
      `echo ${name} is missing from the block`,
    );
  }
  // The first command line wears the prompt; the rest are indented under it.
  assert.match(stripAnsi(lines[1]!), /^\$ echo a$/);
  assert.match(stripAnsi(lines[2]!), /^ {2}echo b$/);
});

test("a command with no output still gets both rules", () => {
  const lines = buildBody(record({ output: "" }), [], theme, WIDTH);
  assert.equal(lines.length, 4, stripAnsi(lines.join("\n")));
  assert.ok(stripAnsi(lines[2]!).includes("output"));
});

test("the result rule is painted with the status colour", () => {
  const failed = record({ status: "failed", exitCode: 2 });
  const rule = buildBody(failed, [], theme, WIDTH).at(-1)!;
  const label = ` ${formatStatus(failed)} · 1.2s `;
  assert.equal(statusColor(failed), "error");
  assert.ok(
    rule.includes(theme.fg("error", label)),
    `the failed rule is not painted error:\n${JSON.stringify(rule)}`,
  );
  // And a passing command does not borrow it.
  assert.ok(!buildBody(record(), [], theme, WIDTH).at(-1)!.includes(
    theme.fg("error", " ok · 1.2s "),
  ));
});

// --- the component -----------------------------------------------------------

function viewerFor(overrides: Partial<CommandRecord> = {}, rows = 30) {
  const store = createCommandStore();
  const entry = record(overrides);
  store.record(entry);
  return new CommandViewer(
    { requestRender() {}, terminal: { rows, columns: 100 } } as never,
    theme,
    keybindings,
    store,
    entry.id,
    createViewerState(),
    [entry.id],
    () => {},
  );
}

test("`y` copies the command and shows the receipt", async () => {
  let copied: string | undefined;
  const viewer = viewerFor({ command: "npm test\n  --workspaces" });
  viewer.copier = (text) => {
    copied = text;
  };
  viewer.handleInput("y");
  // The note lands when the copier settles, not when the key arrives.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(copied, "npm test\n  --workspaces");
  assert.ok(
    viewer
      .render(100)
      .some((line) => stripAnsi(line).includes("copied command")),
    "the footer never showed the receipt",
  );
});

test("`Y` copies the output that is on screen", async () => {
  let copied: string | undefined;
  const viewer = viewerFor({ output: "all good" });
  viewer.copier = (text) => {
    copied = text;
  };
  viewer.handleInput("Y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(copied, "all good");
});

test("`Y` with no output says so and never reaches the clipboard", async () => {
  let called = false;
  const viewer = viewerFor({ output: "", outputLines: 0, outputBytes: 0 });
  viewer.copier = () => {
    called = true;
  };
  viewer.handleInput("Y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, false, "an empty output went to the clipboard");
  assert.ok(
    viewer
      .render(100)
      .some((line) => stripAnsi(line).includes("nothing to copy")),
    "the footer never said why nothing happened",
  );
});

test("any other keypress clears the receipt", async () => {
  const viewer = viewerFor();
  viewer.copier = () => {};
  viewer.handleInput("y");
  await new Promise((resolve) => setImmediate(resolve));
  viewer.handleInput("j");
  assert.ok(
    !viewer.render(100).some((line) => stripAnsi(line).includes("copied")),
    "a stale receipt outlived the copy that produced it",
  );
});

test("the legend fits an 80-column terminal", () => {
  // The footer is one line; wider than the narrowest terminal anyone uses and
  // the close key — the way out — is what falls off the end.
  const legend = viewerFor({ fullOutputPath: "/tmp/spill.log" })
    .render(100)
    .at(-2)!;
  assert.match(stripAnsi(legend), /scroll/);
  assert.ok(visibleWidth(stripAnsi(legend).trimEnd()) <= 80, legend);
});

test("a copy receipt is on screen at 80 columns", async () => {
  // The receipt answers a question the reader just asked; the scroll hints are
  // on screen every other moment. At 80 cells only one of them fits.
  const viewer = viewerFor({ fullOutputPath: "/tmp/spill.log" });
  viewer.copier = () => {
    throw new Error("no clipboard here");
  };
  viewer.handleInput("Y");
  await new Promise((resolve) => setImmediate(resolve));
  const legend = viewer.render(100).at(-2)!;
  assert.ok(
    stripAnsi(truncateToWidth(legend, 80)).includes("failed to copy output"),
    `the receipt fell off an 80-column terminal:\n${stripAnsi(legend)}`,
  );
});

test("the overlay is one row shorter than the terminal", () => {
  for (const rows of [24, 30]) {
    assert.equal(viewerFor({}, rows).render(100).length, rows - 1, `rows=${rows}`);
  }
});

test("`f` puts the viewport back at the tail", () => {
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const viewer = viewerFor({ output, outputLines: 200 });
  const tail = viewer.render(100);
  viewer.handleInput("g");
  const top = viewer.render(100);
  assert.notDeepEqual(top, tail, "g did not scroll");
  // The two views show different text; an offset carried across the toggle
  // would land somewhere in the middle of it.
  viewer.handleInput("f");
  assert.deepEqual(viewer.render(100), tail);
});

test("`j` after `g` steps one line down, not out of the sentinel", () => {
  // g stores MAX_SAFE_INTEGER; only render() knows the real maximum, so it has
  // to write the clamped offset back before the next key reads it.
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const viewer = viewerFor({ output, outputLines: 200 });
  viewer.render(100);
  viewer.handleInput("g");
  const top = viewer.render(100);
  viewer.handleInput("j");
  const afterDown = viewer.render(100);
  assert.notDeepEqual(afterDown, top, "j after g did not move");
  assert.ok(
    stripAnsi(afterDown.join("\n")).includes("line 0"),
    "one line down from the top jumped past the start of the output",
  );
});
