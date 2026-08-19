import assert from "node:assert/strict";
import { test } from "node:test";
import { failedCallPath, failedChange, failureReason } from "./failure.ts";

test("the failed path comes from the arguments, cwd-relative", () => {
  assert.equal(failedCallPath({ path: "src/a.ts" }, "/repo"), "src/a.ts");
  assert.equal(failedCallPath({ path: "/repo/src/a.ts" }, "/repo"), "src/a.ts");
});

test("file_path is accepted too, the way the built-ins accept it", () => {
  assert.equal(failedCallPath({ file_path: "src/a.ts" }, "/repo"), "src/a.ts");
});

test("arguments with no usable path name nothing", () => {
  assert.equal(failedCallPath({}, "/repo"), undefined);
  assert.equal(failedCallPath({ path: 42 }, "/repo"), undefined);
  assert.equal(failedCallPath({ path: "  " }, "/repo"), undefined);
  assert.equal(failedCallPath(undefined, "/repo"), undefined);
});

test("the reason is the result's text blocks, folded to one line", () => {
  assert.equal(
    failureReason([
      { type: "text", text: "Could not edit file: a.ts.\nError code: ENOENT." },
    ]),
    "Could not edit file: a.ts. Error code: ENOENT.",
  );
});

test("non-text blocks and missing text contribute nothing", () => {
  assert.equal(failureReason([{ type: "image", data: "…" }]), "");
  assert.equal(failureReason([{ type: "text" }]), "");
  assert.equal(failureReason(undefined), "");
});

test("escapes in a reason are stripped, not passed through", () => {
  // The reason is drawn inside a dim line: a stray SGR from a tool message
  // would repaint the rest of the row.
  assert.equal(
    failureReason([{ type: "text", text: "\u001b[41mboom\u001b[0m" }]),
    "boom",
  );
});

test("a failed change is the path and nothing else", () => {
  const change = failedChange("src/a.ts");
  assert.equal(change.path, "src/a.ts");
  assert.equal(change.added, 0);
  assert.equal(change.removed, 0);
  assert.equal(change.isNew, false);
  assert.deepEqual(change.hunks, []);
});
