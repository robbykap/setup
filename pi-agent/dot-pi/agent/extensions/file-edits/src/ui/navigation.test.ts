import assert from "node:assert/strict";
import { test } from "node:test";
import { siblingPath } from "./navigation.ts";

const paths = ["a.ts", "b.ts", "c.ts"];

test("n/p cycle within the given path list, wrapping at the ends", () => {
  assert.equal(siblingPath(paths, "a.ts", 1), "b.ts");
  assert.equal(siblingPath(paths, "c.ts", 1), "a.ts");
  assert.equal(siblingPath(paths, "a.ts", -1), "c.ts");
});

test("n/p cycle within a filtered subset rather than the whole store", () => {
  const filtered = ["a.ts", "c.ts"]; // b.ts filtered out
  assert.equal(siblingPath(filtered, "a.ts", 1), "c.ts");
  assert.equal(siblingPath(filtered, "c.ts", 1), "a.ts");
});

test("an empty filter means the whole list", () => {
  assert.equal(siblingPath(paths, "b.ts", 1), "c.ts");
});

test("a current path missing from the list has no sibling", () => {
  assert.equal(siblingPath(paths, "missing.ts", 1), undefined);
});

test("an empty path list has no sibling", () => {
  assert.equal(siblingPath([], "a.ts", 1), undefined);
});
