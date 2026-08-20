import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import type { DiffLine, FileChange } from "../domain.ts";
import { createFileEditStore } from "../store.ts";
import {
  ADDED_EMPHASIS_OPENER,
  ADDED_OPENER,
  codeBody,
  emphasisRanges,
  DiffViewer,
  emptyBodyMessage,
  highlightForChange,
  needsHunkResolution,
  REMOVED_EMPHASIS_OPENER,
  REMOVED_OPENER,
  serializeHunks,
  type ViewMode,
} from "./viewer.ts";

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: "src/a.ts",
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [{ kind: "add" as const, text: "hello", newLine: 1 }],
      },
    ],
    added: 1,
    removed: 0,
    edits: 1,
    isNew: false,
    updatedAt: 0,
    origin: { kind: "self" },
    patches: [],
    hunksPending: false,
    ...overrides,
  };
}

test("every held change is resolved on open, hunks or not", () => {
  // Resolution is a file read and a diff. Anything cheaper goes stale: hunks
  // resolved three edits ago describe the file as it was three edits ago.
  assert.equal(needsHunkResolution(change()), true);
  assert.equal(needsHunkResolution(change({ hunks: [] })), true);
  assert.equal(needsHunkResolution(change({ hunksPending: true })), true);
});

test("a change the store no longer holds resolves nothing", () => {
  assert.equal(needsHunkResolution(undefined), false);
});

test("an untracked file is described, not left blank", () => {
  assert.match(emptyBodyMessage(change({ hunks: [] })) ?? "", /no diff/i);
});

test("the resolver's own account of an empty diff wins over the guess", () => {
  const note = "no changes: the file matches what it was when the session started";
  assert.equal(emptyBodyMessage(change({ hunks: [] }), note), note);
});

test("a note cannot blank out a diff that does exist", () => {
  assert.equal(emptyBodyMessage(change(), "ignored"), null);
});

test("a change with hunks has no placeholder", () => {
  assert.equal(emptyBodyMessage(change()), null);
});

test("a missing change says so", () => {
  assert.match(emptyBodyMessage(undefined) ?? "", /no longer tracked/i);
});

// --- highlighting -----------------------------------------------------------

const MULTI_HUNK = change({
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "context" as const, text: "const a = 1", oldLine: 1, newLine: 1 },
        { kind: "remove" as const, text: "const b = 2", oldLine: 2 },
        { kind: "add" as const, text: "const b = 3", newLine: 2 },
      ],
    },
    {
      oldStart: 20,
      newStart: 20,
      lines: [{ kind: "add" as const, text: "export {}", newLine: 20 }],
    },
  ],
});

test("every hunk line gets a highlight entry", () => {
  const map = highlightForChange(MULTI_HUNK);
  const lines = MULTI_HUNK.hunks.flatMap((hunk) => hunk.lines);
  assert.equal(map.size, lines.length);
  for (const line of lines) {
    // Highlighting may degrade to plain, but never to a different shape.
    assert.ok(map.has(line));
    assert.equal(visibleWidth(map.get(line)!), visibleWidth(line.text));
  }
});

test("a second look at the same change reuses the cached map", () => {
  assert.equal(highlightForChange(MULTI_HUNK), highlightForChange(MULTI_HUNK));
});

test("resolveHunks replaces the change, so the highlights are rebuilt", () => {
  // store.resolveHunks does `changes.set(path, { ...previous, hunks })` — a new
  // object every time, which is what makes the WeakMap key sound: a new diff
  // re-highlights, a scroll (same object) never does.
  const store = createFileEditStore();
  store.record({
    path: "src/a.ts",
    hunks: MULTI_HUNK.hunks,
    added: 2,
    removed: 1,
    isNew: false,
    origin: { kind: "self" },
    at: 0,
  });
  const before = store.get("src/a.ts")!;
  const first = highlightForChange(before);

  store.resolveHunks("src/a.ts", {
    hunks: MULTI_HUNK.hunks,
    added: 2,
    removed: 1,
  });
  const after = store.get("src/a.ts")!;
  assert.notEqual(after, before, "resolveHunks must replace the object");
  assert.notEqual(highlightForChange(after), first);
});

// --- the tint ---------------------------------------------------------------

/**
 * A REAL Theme, for the reason geometry.test.ts spells out: a stub whose
 * helpers return their input emits no escape bytes, and escape bytes — the
 * tint, and the width it must not add — are the subject here.
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
const keybindings = getKeybindings() as never;

function viewerFor(
  width: number,
  mode: ViewMode,
  hunks = MULTI_HUNK.hunks,
  requestRender: () => void = () => {},
) {
  const store = createFileEditStore();
  store.record({
    path: "src/a.ts",
    hunks,
    added: 2,
    removed: 1,
    isNew: false,
    origin: { kind: "self" },
    at: 0,
  });
  return new DiffViewer(
    { requestRender, terminal: { rows: 30, columns: width } } as never,
    theme,
    keybindings,
    store,
    "src/a.ts",
    { mode },
    ["src/a.ts"],
    undefined,
    undefined,
    () => {},
  );
}

function renderAt(width: number, mode: ViewMode): string[] {
  const store = createFileEditStore();
  store.record({
    path: "src/a.ts",
    hunks: MULTI_HUNK.hunks,
    added: 2,
    removed: 1,
    isNew: false,
    origin: { kind: "self" },
    at: 0,
  });
  const viewer = new DiffViewer(
    { requestRender() {}, terminal: { rows: 30, columns: width } } as never,
    theme,
    keybindings,
    store,
    "src/a.ts",
    { mode },
    ["src/a.ts"],
    undefined,
    undefined,
    () => {},
  );
  const lines = viewer.render(width);
  if (mode === "split") {
    // Below MIN_SPLIT_WIDTH the viewer renders stacked and says so, which
    // would make every split case a second stacked case in disguise.
    assert.ok(
      !lines.some((line) => line.includes("too narrow")),
      `split fell back to stacked at width ${width}`,
    );
  }
  return lines;
}

/**
 * Split needs a width it can actually split at: below MIN_SPLIT_WIDTH the
 * viewer renders stacked, so a split case at 60 would have tested stacked
 * twice and called it coverage.
 */
const WIDTHS: Record<ViewMode, readonly number[]> = {
  stacked: [100, 60],
  split: [100, 92],
};

const stripAnsi = (line: string) => line.replaceAll(/\x1b\[[0-9;]*m/g, "");

/** The one rendered row whose visible text matches — rows are identified by
 * what a reader would see, because the escapes are the thing under test. */
function row(lines: string[], pattern: RegExp): string {
  const found = lines.filter((line) => pattern.test(stripAnsi(line)));
  assert.equal(found.length, 1, `expected one row matching ${pattern}`);
  return found[0]!;
}

for (const mode of ["stacked", "split"] as const) {
  for (const width of WIDTHS[mode]) {
    test(`${mode}@${width}: added lines carry the tint at exact width`, () => {
      const lines = renderAt(width, mode);
      const tinted = lines.filter((line) => line.includes(ADDED_OPENER));
      assert.ok(tinted.length > 0, "no added line carried the tint");
      for (const line of tinted) assert.equal(visibleWidth(line), width);
    });

    test(`${mode}@${width}: each tint lands on its own kind of line`, () => {
      const lines = renderAt(width, mode);
      // In stacked the marker names the kind; in split the pane does, and the
      // paired remove/add share a row — so the lone add and the lone context
      // row are what each tint gets pinned against.
      const added =
        mode === "stacked" ? row(lines, /\+ const b = 3/) : row(lines, /export \{\}/);
      const removed =
        mode === "stacked"
          ? row(lines, /− const b = 2/)
          : row(lines, /const b = 2/);
      const context = row(lines, /const a = 1/);

      assert.ok(added.includes(ADDED_OPENER), "add row lost its tint");
      assert.ok(!added.includes(REMOVED_OPENER), "add row wore the remove tint");
      assert.ok(removed.includes(REMOVED_OPENER), "remove row lost its tint");
      assert.ok(
        !context.includes(ADDED_OPENER) && !context.includes(REMOVED_OPENER),
        "context row was tinted",
      );
    });
  }
}

// --- the code body ----------------------------------------------------------

/**
 * Under `node --test` there is no live theme singleton, so highlightBlock
 * hands every line back unchanged and the highlighted branch of codeBody is
 * never reached through render(). Feed it a highlighted string directly.
 */
const HIGHLIGHTED = "\x1b[38;2;1;2;3mconst\x1b[39m a = 1";
const CONTEXT: DiffLine = {
  kind: "context",
  text: "const a = 1",
  oldLine: 1,
  newLine: 1,
};

test("a highlighted line is passed through, escapes and all", () => {
  assert.equal(codeBody(theme, CONTEXT, undefined, HIGHLIGHTED), HIGHLIGHTED);
});

test("a line highlighting declined to touch gets the flat diff colour", () => {
  const body = codeBody(theme, CONTEXT, undefined, CONTEXT.text);
  assert.equal(body, theme.fg("toolDiffContext", CONTEXT.text));
  assert.notEqual(body, CONTEXT.text, "the row would render uncoloured");
});

test("a context line keeps its highlighting even beside a counterpart", () => {
  // Only changed lines get intraline spans; a context line never does, so its
  // highlighting survives.
  assert.equal(codeBody(theme, CONTEXT, "const a = 2", HIGHLIGHTED), HIGHLIGHTED);
});

// --- emphasis over highlighting ---------------------------------------------

const strip = (text: string) => text.replaceAll(/\x1b\[[0-9;]*m/g, "");

const ADDED_LINE: DiffLine = { kind: "add", text: "const a = 1", newLine: 1 };
const REMOVED_LINE: DiffLine = { kind: "remove", text: "const a = 2", oldLine: 1 };

test("a changed line keeps its syntax colours and gains the emphasis tint", () => {
  // The regression this replaced: highlighting was dropped entirely on any
  // line with a counterpart, so the eye lost the code to find the change.
  const body = codeBody(theme, ADDED_LINE, "const a = 2", HIGHLIGHTED);

  assert.ok(body.includes("\x1b[38;2;1;2;3m"), "syntax colour survived");
  assert.ok(body.includes(ADDED_EMPHASIS_OPENER), "changed words are emphasised");
  assert.equal(strip(body), "const a = 1");
});

test("emphasis closes back to the line's own tint, never to a reset", () => {
  // The row sits on its tint edge to edge; a reset here would punch a hole in
  // it that fillLine has no reason to repair.
  const body = codeBody(theme, REMOVED_LINE, "const a = 1", "const a = 2");

  assert.ok(body.includes(REMOVED_EMPHASIS_OPENER));
  assert.ok(body.includes(REMOVED_EMPHASIS_OPENER + "2"));
  assert.ok(body.includes(REMOVED_OPENER), "closed back to the soft tint");
});

test("only the words that differ are emphasised", () => {
  const body = codeBody(theme, ADDED_LINE, "const a = 2", "const a = 1");
  const upTo = body.indexOf(ADDED_EMPHASIS_OPENER);

  assert.ok(upTo > 0);
  // Everything before the first emphasis is the shared prefix.
  assert.equal(strip(body.slice(0, upTo)), "const a = ");
});

test("a line whose counterpart differs nowhere is left alone", () => {
  const body = codeBody(theme, ADDED_LINE, ADDED_LINE.text, HIGHLIGHTED);
  assert.equal(body, HIGHLIGHTED);
});

test("emphasis adds no visible cells", () => {
  // The invariant every overlay line in this panel lives by.
  const plain = "const alpha = 1";
  const line: DiffLine = { kind: "add", text: plain, newLine: 1 };
  assert.equal(strip(codeBody(theme, line, "const beta = 1", plain)), plain);
});

test("ranges are converted through the line, not accumulated", () => {
  // wordSpans counts UTF-16 units and overlayRanges counts code points; an
  // astral character is where the two disagree.
  const ranges = emphasisRanges(
    [
      { text: "a\u{1F600}", changed: false },
      { text: "b", changed: true },
    ],
    "a\u{1F600}b",
  );
  assert.deepEqual(ranges, [{ start: 2, end: 3 }]);
});

// --- what `y` puts on the clipboard -----------------------------------------

test("each kind of line gets its patch marker", () => {
  assert.equal(
    serializeHunks(MULTI_HUNK.hunks.slice(0, 1)),
    " const a = 1\n-const b = 2\n+const b = 3",
  );
});

test("hunks are separated by a blank line", () => {
  // Two hunks run together would paste as one contiguous block of code that
  // never existed in the file.
  assert.equal(
    serializeHunks(MULTI_HUNK.hunks),
    " const a = 1\n-const b = 2\n+const b = 3\n\n+export {}",
  );
});

test("the remove marker is ASCII, not the dash the panel draws", () => {
  // marker() uses U+2212 so the gutter lines up under a proportional-looking
  // font; a patch on the clipboard has to be a patch.
  assert.ok(!serializeHunks(MULTI_HUNK.hunks).includes("\u2212"));
});

test("no hunks serialize to nothing", () => {
  assert.equal(serializeHunks([]), "");
});

test("`y` copies the diff and shows the receipt", async () => {
  let copied: string | undefined;
  const viewer = viewerFor(100, "stacked");
  viewer.copier = (text) => {
    copied = text;
  };
  viewer.handleInput("y");
  // The note lands when the copier settles, not when the key arrives.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(copied, serializeHunks(MULTI_HUNK.hunks));
  assert.ok(
    viewer.render(100).some((line) => stripAnsi(line).includes("copied diff")),
    "the footer never showed the receipt",
  );
});

test("`y` with nothing to copy says so and never reaches the clipboard", async () => {
  let called = false;
  const viewer = viewerFor(100, "stacked", []);
  viewer.copier = () => {
    called = true;
  };
  viewer.handleInput("y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, false, "an empty diff went to the clipboard");
  assert.ok(
    viewer
      .render(100)
      .some((line) => stripAnsi(line).includes("nothing to copy")),
    "the footer never said why nothing happened",
  );
});

test("the legend fits an 80-column terminal", () => {
  // The footer is one line; wider than the narrowest terminal anyone uses and
  // the close key — the way out — is what falls off the end.
  const legend = viewerFor(100, "stacked").render(100).at(-1)!;
  assert.ok(visibleWidth(stripAnsi(legend).trimEnd()) <= 80, legend);
});

// --- scrolling --------------------------------------------------------------

test("`k` after `G` steps back one line, not out of the sentinel", () => {
  // G stores MAX_SAFE_INTEGER; only render() knows the real maximum, so it
  // has to write the clamped offset back before the next key reads it.
  // A body taller than the 26-row viewport, so there is somewhere to scroll.
  const long = [
    {
      oldStart: 1,
      newStart: 1,
      lines: Array.from({ length: 60 }, (_, i) => ({
        kind: "context" as const,
        text: `line ${i}`,
        oldLine: i + 1,
        newLine: i + 1,
      })),
    },
  ];
  const shows = (lines: string[], text: string) =>
    lines.some((line) => new RegExp(`${text}\\b`).test(stripAnsi(line)));

  const viewer = viewerFor(100, "stacked", long);
  viewer.handleInput("G");
  const bottom = viewer.render(100);
  assert.ok(shows(bottom, "line 59"), "`G` did not reach the last line");

  viewer.handleInput("k");
  const up = viewer.render(100);
  // Exactly one line back: the last line is gone, the one before it is now
  // the bottom row. A sentinel left in this.offset would have shown the same
  // rows twice instead.
  assert.ok(!shows(up, "line 59"), "`k` after `G` did not move");
  assert.ok(shows(up, "line 58"), "`k` after `G` moved more than a line");
});
