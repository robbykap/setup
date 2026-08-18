import assert from "node:assert/strict";
import { test } from "node:test";
import { formatActivityStatus } from "./activity-status.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

test("subagents get their own glyph and compact counts", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 2, done: 1, failed: 0 }),
    "⌘ 2 running · 1 done",
  );
});

test("workflows get their own glyph", () => {
  assert.equal(
    formatActivityStatus(theme, "workflows", { running: 1, done: 0, failed: 0 }),
    "⚙ 1 running",
  );
});

test("failures are reported", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 0, done: 2, failed: 1 }),
    "⌘ 2 done · 1 failed",
  );
});

test("all-zero counts produce no segment at all", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 0, done: 0, failed: 0 }),
    undefined,
  );
});
