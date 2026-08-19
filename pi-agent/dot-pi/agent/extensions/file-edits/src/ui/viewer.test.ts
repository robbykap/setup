import assert from "node:assert/strict";
import { test } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import type { FileChange } from "../domain.ts";
import { createFileEditStore } from "../store.ts";
import {
  DiffViewer,
  emptyBodyMessage,
  highlightForChange,
  needsHunkResolution,
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
    hunksPending: false,
    ...overrides,
  };
}

test("a change with hunks needs nothing from git", () => {
  assert.equal(needsHunkResolution(change()), false);
});

test("a child's change still needs resolving", () => {
  assert.equal(needsHunkResolution(change({ hunksPending: true })), true);
});

test("a written file needs resolving even though nothing is pending", () => {
  // write reports no patch at all (record.ts measureWrite), so the record
  // arrives with zero hunks and hunksPending already false. Without this
  // case the viewer draws an empty panel.
  assert.equal(needsHunkResolution(change({ hunks: [] })), true);
});

test("an untracked file is described, not left blank", () => {
  assert.match(emptyBodyMessage(change({ hunks: [] })) ?? "", /no diff/i);
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
  const map = highlightForChange(MULTI_HUNK, MULTI_HUNK.path);
  const lines = MULTI_HUNK.hunks.flatMap((hunk) => hunk.lines);
  assert.equal(map.size, lines.length);
  for (const line of lines) {
    // Highlighting may degrade to plain, but never to a different shape.
    assert.ok(map.has(line));
    assert.equal(visibleWidth(map.get(line)!), visibleWidth(line.text));
  }
});

test("a second look at the same change reuses the cached map", () => {
  assert.equal(
    highlightForChange(MULTI_HUNK, MULTI_HUNK.path),
    highlightForChange(MULTI_HUNK, MULTI_HUNK.path),
  );
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
  const first = highlightForChange(before, before.path);

  store.resolveHunks("src/a.ts", {
    hunks: MULTI_HUNK.hunks,
    added: 2,
    removed: 1,
  });
  const after = store.get("src/a.ts")!;
  assert.notEqual(after, before, "resolveHunks must replace the object");
  assert.notEqual(highlightForChange(after, after.path), first);
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
const ADDED_TINT = "\x1b[48;2;40;52;46m";

function renderAt(width: number, mode: "stacked" | "split"): string[] {
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
    () => {},
  );
  return viewer.render(width);
}

for (const mode of ["stacked", "split"] as const) {
  for (const width of [100, 60]) {
    test(`${mode}@${width}: added lines carry the tint at exact width`, () => {
      const lines = renderAt(width, mode);
      const tinted = lines.filter((line) => line.includes(ADDED_TINT));
      assert.ok(tinted.length > 0, "no added line carried the tint");
      for (const line of tinted) assert.equal(visibleWidth(line), width);
    });
  }
}
