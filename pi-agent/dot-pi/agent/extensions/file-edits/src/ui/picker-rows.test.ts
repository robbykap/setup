import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { filterChanges, formatAge, renderPickerRow } from "./picker-rows.ts";

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

test("formatAge counts up in mm:ss then minutes", () => {
  assert.equal(formatAge(0), "0:00 ago");
  assert.equal(formatAge(31_000), "0:31 ago");
  assert.equal(formatAge(3_600_000), "60:00 ago");
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
