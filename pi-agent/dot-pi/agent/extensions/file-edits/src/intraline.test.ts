import assert from "node:assert/strict";
import { test } from "node:test";
import { wordSpans } from "./intraline.ts";

test("identical lines have no changed spans", () => {
  assert.deepEqual(
    wordSpans("return ranked[0]", "return ranked[0]").removed.filter((span) => span.changed),
    [],
  );
});

test("a changed tail is marked on both sides", () => {
  const { removed, added } = wordSpans("return ranked[0]", "return pickModel(x)");
  assert.equal(removed.map((span) => span.text).join(""), "return ranked[0]");
  assert.equal(added.map((span) => span.text).join(""), "return pickModel(x)");
  assert.equal(removed.find((span) => span.changed)?.text.includes("ranked"), true);
  assert.equal(added.find((span) => span.changed)?.text.includes("pickModel"), true);
});

test("a shared prefix stays unchanged", () => {
  const { added } = wordSpans("const a = 1", "const a = 2");
  assert.equal(added[0]?.changed, false);
  assert.match(added.filter((span) => span.changed).map((span) => span.text).join(""), /2/);
});

test("wholly different lines are entirely changed", () => {
  const { removed, added } = wordSpans("aaa", "bbb");
  assert.ok(removed.every((span) => span.changed));
  assert.ok(added.every((span) => span.changed));
});

test("spans always reconstruct the original text", () => {
  const before = "  if (!model) throw new Error('x')";
  const after = "  if (!model) throw new NoModelError(effort)";
  const { removed, added } = wordSpans(before, after);
  assert.equal(removed.map((span) => span.text).join(""), before);
  assert.equal(added.map((span) => span.text).join(""), after);
});
