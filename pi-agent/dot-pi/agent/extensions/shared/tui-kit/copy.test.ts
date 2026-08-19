import assert from "node:assert/strict";
import { test } from "node:test";
import { copyText } from "./copy.ts";

test("reports success with the label", async () => {
  const note = await copyText("hello", "command", async () => {});
  assert.equal(note, "copied command");
});

test("reports failure without throwing", async () => {
  const note = await copyText("hello", "command", async () => {
    throw new Error("no clipboard");
  });
  assert.equal(note, "copy failed");
});
