import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import {
  CollapsedRow,
  EmptyRow,
  NoteRow,
  delegationContext,
  renderCollapsedRow,
  renderNote,
} from "./row.ts";
import { parseUnifiedPatch } from "../diff.ts";
import { failedChange } from "../failure.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

/**
 * A REAL Theme for the one invariant that is about escapes rather than text:
 * the stub above returns its input, so it could never emit a background fill
 * whether or not the row asked for one. Built the way geometry.test.ts does,
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

const parsed = parseUnifiedPatch(
  `@@ -37,3 +37,4 @@\n const ranked = rank(candidates)\n-return ranked[0]\n+const model = pickModel(ranked, effort)\n+if (!model) throw new NoModelError(effort)\n`,
)!;

const change = {
  path: "src/router.ts",
  hunks: parsed.hunks,
  added: 12,
  removed: 4,
  edits: 1,
  isNew: false,
  updatedAt: 0,
  origin: { kind: "self" } as const,
  hunksPending: false,
};

test("renders exactly two lines", () => {
  assert.equal(renderCollapsedRow(change, 80, theme).length, 2);
});

test("the header carries the path and the counts", () => {
  const [header] = renderCollapsedRow(change, 80, theme);
  assert.match(header!, /src\/router\.ts/);
  assert.match(header!, /\+12/);
  assert.match(header!, /−4/);
});

test("the peek shows changed lines, not context", () => {
  const [, peek] = renderCollapsedRow(change, 80, theme);
  assert.match(peek!, /pickModel/);
  assert.doesNotMatch(peek!, /const ranked/);
});

test("the peek is capped", () => {
  const many = parseUnifiedPatch(
    `@@ -1,1 +1,6 @@\n+a\n+b\n+c\n+d\n+e\n`,
  )!;
  const [, peek] = renderCollapsedRow({ ...change, hunks: many.hunks }, 80, theme);
  assert.match(peek!, /\ba\b/);
  assert.match(peek!, /\bb\b/);
  assert.match(peek!, /\bc\b/);
  assert.doesNotMatch(peek!, /\bd\b/);
  assert.doesNotMatch(peek!, /\be\b/);
});

test("every line fits the width", () => {
  // visibleWidth, not .length: paintIcon always emits truecolor escapes, so a
  // raw character count would measure the escape bytes too.
  for (const line of renderCollapsedRow(change, 30, theme)) {
    assert.ok(visibleWidth(line) <= 30, `too wide: ${JSON.stringify(line)}`);
  }
});

test("the peek separator does not knock later fragments back to full contrast", () => {
  // The kit's peekLine wraps the whole line dim; a painted separator inside
  // it would embed its own reset and break that run partway through.
  const many = parseUnifiedPatch(`@@ -1,1 +1,3 @@\n+alpha\n+beta\n`)!;
  const [, peek] = renderCollapsedRow(
    { ...change, hunks: many.hunks },
    80,
    realTheme,
  );
  const resets = peek!.match(/\x1b\[39m/g) ?? [];
  assert.equal(resets.length, 2, peek);
});

test("a narrow row keeps the counts even with a long path", () => {
  // The kit truncates the title first, not the right-aligned outcome: a
  // narrow row should still show what the call did.
  const long = { ...change, path: "src/very/deeply/nested/router-module.ts" };
  const [header] = renderCollapsedRow(long, 30, theme);
  assert.match(header!, /\+12/);
});

test("a file with no hunks renders a single header line", () => {
  const lines = renderCollapsedRow({ ...change, hunks: [], hunksPending: true }, 80, theme);
  assert.equal(lines.length, 1);
});

test("new files are labelled", () => {
  const [header] = renderCollapsedRow({ ...change, isNew: true, removed: 0 }, 80, theme);
  assert.match(header!, /new/);
});

test("the row component renders the row at the width it is given", () => {
  const row = new CollapsedRow();
  row.update(change, theme);
  assert.deepEqual(row.render(80), renderCollapsedRow(change, 80, theme));
  assert.deepEqual(row.render(40), renderCollapsedRow(change, 40, theme));
});

test("a failed call collapses to a header with a failure marker", () => {
  const lines = renderCollapsedRow(failedChange("src/router.ts"), 80, theme, true);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /src\/router\.ts/);
  assert.match(lines[0]!, /✗ failed/);
});

test("a failed row states no counts it does not have", () => {
  // failedChange carries zeroes, but a row that ever fell back to the last
  // known counts would claim the failed call had applied them.
  const lines = renderCollapsedRow({ ...change, added: 12 }, 80, theme, true);
  assert.doesNotMatch(lines[0]!, /\+12/);
  assert.doesNotMatch(lines[0]!, /−4/);
});

test("a failed row is plain text: no background fill anywhere", () => {
  // `\x1b[4` opens a background fill (48;…) or an underline: a failure is a
  // plain row like every other, foreground colours only. This is the whole
  // point of the row — the built-in draws a red box here.
  const lines = [
    ...renderCollapsedRow(failedChange("src/router.ts"), 80, realTheme, true),
    ...renderNote("Could not edit file: src/router.ts.", 80, realTheme),
  ];
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(!line.includes("\x1b[4"), line);
});

test("the note is a one-line dim reason", () => {
  const lines = renderNote("Could not edit\nfile: src/router.ts.", 80, theme);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.trim(), "│ Could not edit file: src/router.ts.");
});

test("a note with nothing to say renders nothing", () => {
  assert.deepEqual(renderNote("", 80, theme), []);
  assert.deepEqual(renderNote("   \n ", 80, theme), []);
  assert.deepEqual(new NoteRow().render(80), []);
});

test("the note fits the width", () => {
  const note = new NoteRow();
  note.update("a reason far longer than the terminal is wide".repeat(4), theme);
  for (const line of note.render(30)) {
    assert.ok(visibleWidth(line) <= 30, `too wide: ${JSON.stringify(line)}`);
  }
});

test("the row component keeps the failed flag it was given", () => {
  const row = new CollapsedRow();
  row.update(failedChange("src/router.ts"), theme, true);
  assert.match(row.render(80)[0]!, /✗ failed/);
  row.update(change, theme);
  assert.deepEqual(row.render(80), renderCollapsedRow(change, 80, theme));
});

test("delegation hides our components from a built-in renderer", () => {
  // edit.js:276-277 calls clear() on whatever the slot returned last time.
  assert.equal(
    delegationContext({ lastComponent: new CollapsedRow() }).lastComponent,
    undefined,
  );
  assert.equal(
    delegationContext({ lastComponent: new EmptyRow() }).lastComponent,
    undefined,
  );
  assert.equal(
    delegationContext({ lastComponent: new NoteRow() }).lastComponent,
    undefined,
  );
});

test("delegation hands a built-in its own component back", () => {
  // write.js:175-179 keeps its incremental highlight cache on that component:
  // blanking it unconditionally would re-highlight the whole file per chunk.
  const builtIn = new Container();
  const state = {};
  const context = { lastComponent: builtIn, state, expanded: false };
  assert.equal(delegationContext(context).lastComponent, builtIn);
  assert.equal(delegationContext(context).state, state);
  assert.equal(
    delegationContext({ lastComponent: undefined }).lastComponent,
    undefined,
  );
});

test("the row component is a real pi-tui component", () => {
  // A built-in renderer that receives this as lastComponent does
  // `component.clear()` (edit.js:276-277) before using it: a bare object
  // literal would throw there and fall back to raw text.
  const row = new CollapsedRow();
  assert.ok(row instanceof Container);
  row.clear();
  row.invalidate();
  assert.deepEqual(row.render(80), []);
});
