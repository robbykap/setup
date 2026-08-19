import assert from "node:assert/strict";
import { test } from "node:test";
import { displayIndexOf, groupRows } from "./grouping.ts";

interface Entry {
  readonly name: string;
  readonly group: string;
}

const labelOf = (entry: Entry) => entry.group;

const entries: ReadonlyArray<Entry> = [
  { name: "recent", group: "today" },
  { name: "older", group: "yesterday" },
  { name: "recent-too", group: "today" },
  { name: "oldest", group: "yesterday" },
];

test("items keep their flat order within a group", () => {
  const rows = groupRows(entries, labelOf);
  const today = rows.filter((row) => row.kind === "item" && row.item.group === "today");
  assert.deepEqual(
    today.map((row) => (row.kind === "item" ? row.item.name : null)),
    ["recent", "recent-too"],
  );
  assert.deepEqual(
    today.map((row) => (row.kind === "item" ? row.index : null)),
    [0, 2],
  );
});

test("group order follows first appearance, so the most recent group leads", () => {
  const rows = groupRows(entries, labelOf);
  assert.deepEqual(
    rows.filter((row) => row.kind === "header").map((row) => row.kind === "header" && row.label),
    ["today", "yesterday"],
  );
  assert.equal(rows[0]?.kind, "header");
  assert.equal(rows[0]?.kind === "header" && rows[0].label, "today");
});

test("one header row per group", () => {
  const rows = groupRows(entries, labelOf);
  assert.equal(rows.filter((row) => row.kind === "header").length, 2);
  assert.equal(rows.filter((row) => row.kind === "item").length, 4);
  assert.equal(rows.length, 6);
});

test("displayIndexOf maps a flat item index to its display row", () => {
  const rows = groupRows(entries, labelOf);
  // header today, 0, 2, header yesterday, 1, 3
  assert.equal(displayIndexOf(rows, 0), 1);
  assert.equal(displayIndexOf(rows, 2), 2);
  assert.equal(displayIndexOf(rows, 1), 4);
  assert.equal(displayIndexOf(rows, 3), 5);
  assert.equal(displayIndexOf(rows, 9), -1);
});

test("empty input yields no rows", () => {
  assert.deepEqual(groupRows([], labelOf), []);
  assert.equal(displayIndexOf(groupRows([], labelOf), 0), -1);
});

test("a single group still gets its header", () => {
  const rows = groupRows([{ name: "only", group: "today" }], labelOf);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.kind === "header" && rows[0].label, "today");
  assert.equal(displayIndexOf(rows, 0), 1);
});
