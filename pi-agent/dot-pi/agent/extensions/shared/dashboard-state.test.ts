/**
 * The child-file event and the patch it now carries.
 *
 * The guard is the interesting part: an emitter one version behind sends no
 * patch at all, and its file still belongs in the parent's picker. "Absent is
 * valid, wrong type is not" is the whole contract.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isChildFileEvent, patchOf } from "./dashboard-state.ts";

const origin = { kind: "subagent", id: "sa-1", name: "sa-1" } as const;

test("an event with a patch is valid", () => {
  assert.equal(
    isChildFileEvent({ path: "a.ts", origin, patch: "@@ -1 +1 @@\n-a\n+b\n" }),
    true,
  );
});

test("an event without a patch stays valid: the emitter may be older", () => {
  assert.equal(isChildFileEvent({ path: "a.ts", origin }), true);
});

test("a patch of the wrong type is rejected", () => {
  assert.equal(isChildFileEvent({ path: "a.ts", origin, patch: 42 }), false);
  assert.equal(isChildFileEvent({ path: "a.ts", origin, patch: null }), false);
});

test("the path and the origin are still required", () => {
  assert.equal(isChildFileEvent({ origin }), false);
  assert.equal(isChildFileEvent({ path: "a.ts" }), false);
  assert.equal(isChildFileEvent(undefined), false);
});

test("patchOf reads an edit result", () => {
  assert.deepEqual(patchOf({ details: { patch: "@@ -1 +1 @@\n" } }), {
    patch: "@@ -1 +1 @@\n",
  });
});

test("patchOf finds nothing where there is nothing: write, or no result", () => {
  assert.deepEqual(patchOf({ content: [{ type: "text", text: "ok" }] }), {});
  assert.deepEqual(patchOf({ details: undefined }), {});
  assert.deepEqual(patchOf(undefined), {});
  assert.deepEqual(patchOf(null), {});
});

test("patchOf refuses a patch that is not a non-empty string", () => {
  assert.deepEqual(patchOf({ details: { patch: 7 } }), {});
  assert.deepEqual(patchOf({ details: { patch: "" } }), {});
  assert.deepEqual(patchOf({ details: { patch: { hunks: [] } } }), {});
});

test("the result of patchOf spreads into a ChildFile", () => {
  // The reason it returns an object rather than a string | undefined: a
  // spread of {} leaves no `patch` key at all, which is what the guard and
  // JSON serialization both want.
  const file = { path: "a.ts", ...patchOf({ details: {} }) };
  assert.deepEqual(file, { path: "a.ts" });
  assert.equal("patch" in file, false);
});
