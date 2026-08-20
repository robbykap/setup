import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { groupLabel } from "../domain.ts";
import {
  createPickerState,
  filterChanges,
  formatAge,
  reconcilePickerSelection,
  renderPickerRow,
} from "./picker-rows.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

const change = {
  path: "src/router.ts",
  hunks: [],
  added: 12,
  removed: 4,
  edits: 2,
  isNew: false,
  updatedAt: 1_000_000,
  origin: { kind: "self" } as const,
  patches: [],
  hunksPending: false,
};

test("a row carries path, counts, edit count and age", () => {
  const row = renderPickerRow(change, 80, theme, 1_031_000);
  assert.match(row, /src\/router\.ts/);
  assert.match(row, /\+12/);
  assert.match(row, /−4/);
  assert.match(row, /2 edits/);
  assert.match(row, /0:31 ago/);
});

test("one edit is singular", () => {
  const row = renderPickerRow({ ...change, edits: 1 }, 80, theme, 1_000_000);
  assert.match(row, /1 edit\b/);
});

test("new files say so instead of counting edits", () => {
  const row = renderPickerRow({ ...change, isNew: true }, 80, theme, 1_000_000);
  assert.match(row, /new file/);
});

test("child-session origins are tagged", () => {
  const row = renderPickerRow(
    { ...change, origin: { kind: "subagent", id: "sa-2", name: "sa-2" } },
    80,
    theme,
    1_000_000,
  );
  assert.match(row, /sa-2/);
});

test("rows never exceed the width", () => {
  assert.ok(visibleWidth(renderPickerRow(change, 40, theme, 1_000_000)) <= 40);
});

// --- group labels -----------------------------------------------------------

test("a file this session edited is modified, and a file it created is new", () => {
  assert.equal(groupLabel(change), "modified");
  assert.equal(groupLabel({ ...change, isNew: true }), "new");
});

test("a child session's changes group by who made them, new or not", () => {
  const subagent = { kind: "subagent", id: "sa-2", name: "sa-2" } as const;
  assert.equal(groupLabel({ ...change, origin: subagent }), "from agents");
  assert.equal(
    groupLabel({ ...change, origin: subagent, isNew: true }),
    "from agents",
  );
  assert.equal(
    groupLabel({ ...change, origin: { kind: "workflow", label: "ship" } }),
    "from agents",
  );
});

test("formatAge counts up in mm:ss then minutes", () => {
  assert.equal(formatAge(0), "0:00 ago");
  assert.equal(formatAge(31_000), "0:31 ago");
  assert.equal(formatAge(3_600_000), "60:00 ago");
});

test("the cursor re-anchors to the same path when the list order changes", () => {
  const state = createPickerState();
  state.path = "b.ts";
  state.index = 1;
  reconcilePickerSelection(state, [
    { path: "b.ts" },
    { path: "a.ts" },
    { path: "c.ts" },
  ]);
  assert.equal(state.index, 0);
  assert.equal(state.path, "b.ts");
});

test("the cursor degrades to the nearest row when the anchored path disappears", () => {
  const state = createPickerState();
  state.path = "b.ts";
  state.index = 1;
  reconcilePickerSelection(state, [{ path: "a.ts" }, { path: "c.ts" }]);
  assert.equal(state.index, 1);
  assert.equal(state.path, "c.ts");
});

test("the cursor clamps to the last row when the list shrinks below it", () => {
  const state = createPickerState();
  state.path = "gone.ts";
  state.index = 4;
  reconcilePickerSelection(state, [{ path: "a.ts" }]);
  assert.equal(state.index, 0);
  assert.equal(state.path, "a.ts");
});

test("an empty list leaves no path anchored", () => {
  const state = createPickerState();
  state.path = "gone.ts";
  state.index = 0;
  reconcilePickerSelection(state, []);
  assert.equal(state.index, 0);
  assert.equal(state.path, undefined);
});

test("filtering is fuzzy and case-insensitive", () => {
  const changes = [change, { ...change, path: "docs/design.md" }];
  assert.deepEqual(
    filterChanges(changes, "rtr").map((item) => item.path),
    ["src/router.ts"],
  );
  assert.deepEqual(
    filterChanges(changes, "DESIGN").map((item) => item.path),
    ["docs/design.md"],
  );
  assert.equal(filterChanges(changes, "").length, 2);
  assert.equal(filterChanges(changes, "zzz").length, 0);
});
