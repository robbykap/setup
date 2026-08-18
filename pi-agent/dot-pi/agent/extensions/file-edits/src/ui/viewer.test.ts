import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange } from "../domain.ts";
import { emptyBodyMessage, needsHunkResolution } from "./viewer.ts";

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
