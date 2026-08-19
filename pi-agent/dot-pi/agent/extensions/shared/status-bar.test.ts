import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { composeStatusBar, SEGMENT_ORDER } from "./status-bar.ts";

// A theme stub: every helper is identity, so tests assert on plain text.
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

test("returns undefined when there are no segments", () => {
  assert.equal(composeStatusBar(new Map(), 80, theme), undefined);
});

test("joins segments with diamonds in fixed order", () => {
  const statuses = new Map([
    ["workflows", "wf 2/4"],
    ["file-edits", "7 files"],
    ["subagents", "2 running"],
  ]);
  assert.equal(
    composeStatusBar(statuses, 80, theme),
    "7 files ◆ 2 running ◆ wf 2/4",
  );
});

test("unknown keys sort after known ones, alphabetically", () => {
  const statuses = new Map([
    ["zebra", "z"],
    ["alpha", "a"],
    ["file-edits", "7 files"],
  ]);
  assert.equal(
    composeStatusBar(statuses, 80, theme),
    "7 files ◆ a ◆ z",
  );
});

test("drops lowest-priority segments whole when the line does not fit", () => {
  const statuses = new Map([
    ["file-edits", "7 files"],
    ["subagents", "2 running"],
    ["summaries", "summarizing"],
  ]);
  // "7 files ◆ 2 running" is 19 cells; adding summaries needs 35.
  assert.equal(composeStatusBar(statuses, 20, theme), "7 files ◆ 2 running");
});

test("truncates the last survivor rather than returning nothing", () => {
  const statuses = new Map([["file-edits", "a very long files segment"]]);
  const line = composeStatusBar(statuses, 10, theme);
  const stripped = line!.replace(/\x1b\[[0-9;]*m/g, "");
  assert.equal(stripped, "a very lo…");
  assert.equal(visibleWidth(line!), 10);
});

test("multi-line status text is flattened to one line", () => {
  const statuses = new Map([["subagents", "2 running\n1 done"]]);
  assert.equal(composeStatusBar(statuses, 80, theme), "2 running 1 done");
});

test("whitespace-only status text is dropped", () => {
  const statuses = new Map([
    ["file-edits", "   "],
    ["subagents", "\n\n"],
  ]);
  assert.equal(composeStatusBar(statuses, 80, theme), undefined);
});

test("segment order is the documented one", () => {
  assert.deepEqual(SEGMENT_ORDER, [
    "file-edits",
    "commands",
    "subagents",
    "background-terminals",
    "workflows",
    "summaries",
  ]);
});
