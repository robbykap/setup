import assert from "node:assert/strict";
import { test } from "node:test";
import { createViewerState, stepId } from "./viewer.ts";

const ids = ["a", "b", "c"];

test("n and p walk the list", () => {
  assert.equal(stepId(ids, "a", 1), "b");
  assert.equal(stepId(ids, "b", -1), "a");
});

test("walking wraps at both ends", () => {
  assert.equal(stepId(ids, "c", 1), "a");
  assert.equal(stepId(ids, "a", -1), "c");
});

test("a record that left the list lands on the first one", () => {
  assert.equal(stepId(ids, "gone", 1), "a");
});

test("an empty list goes nowhere", () => {
  assert.equal(stepId([], "a", 1), null);
});

test("the viewer prefers the full log when there is one", () => {
  assert.equal(createViewerState().full, true);
});
