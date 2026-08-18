import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  createPickerState,
  filterRecords,
  reconcilePickerSelection,
  renderPickerRow,
} from "./rows.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

function record(id: string, overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id,
    tool: "bash",
    command: `echo ${id}`,
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 0,
    durationMs: 10,
    status: "ok",
    output: "",
    outputLines: 0,
    outputBytes: 0,
    ...overrides,
  };
}

const records = [
  record("a", { command: "git status --short" }),
  record("b", { tool: "rg", command: "rg needle src" }),
  record("c", {
    command: "npm test",
    origin: { kind: "subagent", id: "s1", name: "auditor" },
  }),
];

test("the filter matches the command text", () => {
  assert.deepEqual(
    filterRecords(records, "git").map((entry) => entry.id),
    ["a"],
  );
});

test("the filter matches the tool and the origin too", () => {
  assert.deepEqual(
    filterRecords(records, "rg").map((entry) => entry.id),
    ["b"],
  );
  assert.deepEqual(
    filterRecords(records, "auditor").map((entry) => entry.id),
    ["c"],
  );
});

test("an empty filter keeps the list intact", () => {
  assert.equal(filterRecords(records, "   ").length, 3);
});

test("the cursor follows its record when the list grows", () => {
  const state = createPickerState();
  state.index = 1;
  reconcilePickerSelection(state, records);
  assert.equal(state.id, "b");

  reconcilePickerSelection(state, [record("new"), ...records]);
  assert.equal(state.index, 2);
  assert.equal(state.id, "b");
});

test("the cursor clamps into range when its record is gone", () => {
  const state = createPickerState();
  state.index = 2;
  state.id = "gone";
  reconcilePickerSelection(state, records.slice(0, 2));
  assert.equal(state.index, 1);
  assert.equal(state.id, "b");
});

test("an empty list leaves nothing selected", () => {
  const state = createPickerState();
  reconcilePickerSelection(state, []);
  assert.equal(state.index, 0);
  assert.equal(state.id, undefined);
});

test("a row shows the command and its right-hand columns", () => {
  const row = renderPickerRow(records[2]!, 100, theme, 60_000);
  assert.match(row, /npm test/);
  assert.match(row, /auditor/);
  assert.match(row, /1m ago/);
});

test("a failing row names the failure", () => {
  const row = renderPickerRow(
    record("d", { status: "failed", exitCode: 1 }),
    100,
    theme,
    0,
  );
  assert.match(row, /exit 1/);
});

test("a row never exceeds the width it was given", () => {
  const long = record("e", {
    command: "docker run --rm -it ".repeat(20),
    origin: { kind: "workflow", label: "a very long workflow label" },
  });
  for (const width of [24, 40, 80, 120]) {
    assert.ok(visibleWidth(renderPickerRow(long, width, theme, 0)) <= width);
  }
});
