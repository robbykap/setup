/**
 * When a tool about to write should snapshot the file first.
 *
 * The regression: after a /reload the store is repopulated from the session
 * log, but the baselines are not — they live at the pinned commit. Snapshotting
 * again on the next edit rebased the diff onto the middle of the session, so a
 * file edited three times showed only the third edit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSnapshot } from "./index.ts";
import type { FileChange } from "./src/domain.ts";

const change = (overrides: Partial<FileChange> = {}): FileChange => ({
  path: "a.ts",
  hunks: [],
  patches: [],
  added: 2,
  removed: 2,
  edits: 2,
  isNew: false,
  updatedAt: 1,
  origin: { kind: "self" },
  hunksPending: true,
  ...overrides,
});

test("a file this session has never touched is snapshotted", () => {
  assert.equal(shouldSnapshot(undefined), true);
});

test("a file already in the store keeps the baseline it has", () => {
  assert.equal(shouldSnapshot(change()), false);
});

test("history replayed after a reload is not re-baselined", () => {
  // Its baseline is waiting at the pinned commit; a fresh snapshot would be
  // the file as it stands three edits in.
  assert.equal(shouldSnapshot(change({ restored: true })), false);
});
