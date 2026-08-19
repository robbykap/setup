/**
 * Overlay geometry. These exist because the first version of both overlays
 * shipped with lines that were 2 cells too wide, 1 cell too narrow, and a
 * header that collapsed to its content width — which made the panels look
 * shattered even though every unit test passed.
 *
 * The invariants, matching /ps and /subagents:
 *   - every rendered line is exactly `width` VISIBLE cells
 *   - the panel is a fixed rectangle of `terminal rows - 1` lines, whatever
 *     the content
 *
 * The frame primitives themselves are covered by shared/tui-kit/frame.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { parseUnifiedPatch } from "../diff.ts";
import { createFileEditStore, type FileEditStore } from "../store.ts";
import { openerOf } from "../../../shared/tui-kit/paint.ts";
import { FilePicker } from "./picker.ts";
import { DiffViewer } from "./viewer.ts";

/**
 * A REAL Theme, not a stub whose helpers return their input. The entire bug
 * class here is ANSI escape bytes being counted as visible cells, so a theme
 * that emits no escapes would test nothing. The live singleton is not part of
 * the package's public exports, so we build an equivalent one.
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

test("the test theme really does emit escape sequences", () => {
  const painted = theme.fg("accent", "x");
  assert.ok(painted.length > 1, "theme produced no ANSI escapes");
  assert.equal(visibleWidth(painted), 1);
});

/**
 * A real KeybindingsManager, but cast: pi-tui and pi-coding-agent each expose
 * a KeybindingsManager type, and depending on where the extension is checked
 * from (repo vs installed under ~/.pi/agent) they resolve to two different
 * declarations of the same runtime class. The components want the agent's one.
 */
const keybindings = getKeybindings() as never;
const ROWS = 30;
/** The whole overlay is terminal rows - 1, leaving pi's footer visible. */
const EXPECTED_LINES = ROWS - 1;

function stubTui(columns = 100) {
  return { requestRender() {}, terminal: { rows: ROWS, columns } } as never;
}

const PATCH = parseUnifiedPatch(
  `@@ -37,4 +37,5 @@\n const ranked = rank(candidates)\n-return ranked[0]\n+const model = pickModel(ranked, effort)\n+if (!model) throw new NoModelError(effort)\n ok\n`,
)!;

function storeWith(count: number): FileEditStore {
  const store = createFileEditStore();
  const now = Date.now();
  for (let index = 0; index < count; index += 1) {
    store.record({
      path: `src/file${index}.ts`,
      hunks: PATCH.hunks,
      added: 12,
      removed: 4,
      isNew: false,
      origin: { kind: "self" },
      at: now - index * 1000,
    });
  }
  return store;
}

/** A store holding one self-edited file, one new file, one from a subagent. */
function mixedStore(): FileEditStore {
  const store = createFileEditStore();
  const now = Date.now();
  store.record({
    path: "src/router.ts",
    hunks: PATCH.hunks,
    added: 12,
    removed: 4,
    isNew: false,
    origin: { kind: "self" },
    at: now,
  });
  store.record({
    path: "src/new.ts",
    hunks: PATCH.hunks,
    added: 9,
    removed: 0,
    isNew: true,
    origin: { kind: "self" },
    at: now - 1000,
  });
  store.record({
    path: "docs/x.md",
    hunks: PATCH.hunks,
    added: 3,
    removed: 1,
    isNew: false,
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
    at: now - 2000,
  });
  return store;
}

/** Section rules are the only lines drawn with the dashed glyph. */
const ruleLines = (lines: string[]) => lines.filter((line) => line.includes("╌"));

function assertExact(lines: string[], width: number, label: string) {
  lines.forEach((line, index) => {
    assert.equal(
      visibleWidth(line),
      width,
      `${label}: line ${index} is ${visibleWidth(line)} cells, want ${width}\n${JSON.stringify(line)}`,
    );
  });
}

// --- the picker -------------------------------------------------------------

for (const width of [100, 90, 72, 60]) {
  test(`picker renders exact-width lines at ${width}`, () => {
    const picker = new FilePicker(
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

test("the picker is the same rectangle whatever the file count", () => {
  for (const count of [0, 1, 3, 40]) {
    const picker = new FilePicker(
      stubTui(),
      theme,
      keybindings,
      storeWith(count),
      { query: "", index: 0 },
      () => {},
    );
    const lines = picker.render(100);
    assert.equal(lines.length, EXPECTED_LINES, `${count} files`);
    assertExact(lines, 100, `picker with ${count} files`);
  }
});

test("the selected row carries the selection background, and only it", () => {
  const picker = new FilePicker(
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
  // The store lists most-recent-first, so index 1 of three files is file1.
  assert.ok(filled[0]?.includes("src/file1.ts"), "the wrong row is highlighted");
  assertExact(lines, 100, "picker with a selection fill");
});

test("an unfiltered list is grouped under labelled rules", () => {
  const picker = new FilePicker(
    stubTui(),
    theme,
    keybindings,
    mixedStore(),
    { query: "", index: 0 },
    () => {},
  );
  const lines = picker.render(100);
  const rules = ruleLines(lines);
  assert.equal(rules.length, 3, "one rule per group");
  for (const label of ["modified", "new", "from agents"]) {
    assert.ok(
      rules.some((rule) => rule.includes(label)),
      `no rule labelled ${label}`,
    );
  }
  assertExact(lines, 100, "grouped picker");
  assert.equal(lines.length, EXPECTED_LINES);
});

test("grouping still highlights exactly one row, the selected one", () => {
  const store = mixedStore();
  // The cursor is a flat index into the store's order, not a display row.
  const index = store.list().findIndex((row) => row.path === "docs/x.md");
  const picker = new FilePicker(
    stubTui(),
    theme,
    keybindings,
    store,
    { query: "", index },
    () => {},
  );
  const lines = picker.render(100);
  const opener = openerOf((text) => theme.bg("selectedBg", text));
  const filled = lines.filter((line) => line.includes(opener));
  assert.equal(filled.length, 1, "exactly one row should be highlighted");
  assert.ok(filled[0]?.includes("docs/x.md"), "the wrong row is highlighted");
  assertExact(lines, 100, "grouped picker with a selection fill");
});

test("a filtered list is flat: the filter replaces the grouping", () => {
  const picker = new FilePicker(
    stubTui(),
    theme,
    keybindings,
    mixedStore(),
    { query: "src", index: 0 },
    () => {},
  );
  const lines = picker.render(100);
  assert.deepEqual(ruleLines(lines), [], "a filtered list should have no headers");
  assertExact(lines, 100, "filtered picker");
  assert.equal(lines.length, EXPECTED_LINES);
});

test("a filter matching nothing still fills the rectangle", () => {
  const picker = new FilePicker(
    stubTui(),
    theme,
    keybindings,
    storeWith(3),
    { query: "zzzzzzz", index: 0 },
    () => {},
  );
  const lines = picker.render(100);
  assert.equal(lines.length, EXPECTED_LINES);
  assertExact(lines, 100, "picker with no matches");
});

// --- the viewer -------------------------------------------------------------

for (const width of [100, 90, 72, 60]) {
  for (const mode of ["stacked", "split"] as const) {
    test(`viewer ${mode} renders exact-width lines at ${width}`, () => {
      const store = storeWith(2);
      const viewer = new DiffViewer(
        stubTui(width),
        theme,
        keybindings,
        store,
        "src/file0.ts",
        { mode },
        ["src/file0.ts", "src/file1.ts"],
        () => {},
      );
      const lines = viewer.render(width);
      assertExact(lines, width, `viewer ${mode}@${width}`);
      assert.equal(lines.length, EXPECTED_LINES);
    });
  }
}

test("a file with no diff yet still fills the rectangle", () => {
  const store = createFileEditStore();
  store.recordExternal({
    path: "docs/x.md",
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
    at: Date.now(),
  });
  const viewer = new DiffViewer(
    stubTui(),
    theme,
    keybindings,
    store,
    "docs/x.md",
    { mode: "stacked" },
    ["docs/x.md"],
    () => {},
  );
  const lines = viewer.render(100);
  assert.equal(lines.length, EXPECTED_LINES);
  assertExact(lines, 100, "viewer pending");
});

test("scrolling to the bottom keeps the rectangle intact", () => {
  const store = storeWith(1);
  const viewer = new DiffViewer(
    stubTui(),
    theme,
    keybindings,
    store,
    "src/file0.ts",
    { mode: "stacked" },
    ["src/file0.ts"],
    () => {},
  );
  for (let index = 0; index < 100; index += 1) viewer.handleInput("j");
  const lines = viewer.render(100);
  assert.equal(lines.length, EXPECTED_LINES);
  assertExact(lines, 100, "viewer scrolled to the end");
});
