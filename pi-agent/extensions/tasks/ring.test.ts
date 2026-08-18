import assert from "node:assert/strict";
import { test } from "node:test";
import { createRingBuffer } from "./src/ring.ts";

test("keeps everything while under the limit", () => {
  const ring = createRingBuffer(100);
  ring.append(Buffer.from("hello "));
  ring.append(Buffer.from("world"));
  assert.equal(ring.view.text, "hello world");
  assert.equal(ring.view.totalBytes, 11);
  assert.equal(ring.view.droppedBytes, 0);
});

test("keeps everything at exactly the limit", () => {
  const ring = createRingBuffer(5);
  ring.append(Buffer.from("abcde"));
  assert.equal(ring.view.text, "abcde");
  assert.equal(ring.view.droppedBytes, 0);
});

test("drops the oldest bytes past the limit", () => {
  const ring = createRingBuffer(5);
  ring.append(Buffer.from("abcde"));
  ring.append(Buffer.from("fgh"));
  assert.equal(ring.view.text, "defgh");
  assert.equal(ring.view.totalBytes, 8);
  assert.equal(ring.view.droppedBytes, 3);
});

test("a single oversized chunk keeps only its tail", () => {
  const ring = createRingBuffer(4);
  ring.append(Buffer.from("abcdefghij"));
  assert.equal(ring.view.text, "ghij");
  assert.equal(ring.view.droppedBytes, 6);
});

test("never leaves a partial UTF-8 sequence at the front", () => {
  // "é" is 2 bytes; cutting between them would decode as U+FFFD.
  const ring = createRingBuffer(3);
  ring.append(Buffer.from("éé"));
  assert.equal(ring.view.text, "é");
  assert.equal(ring.view.droppedBytes, 2);
  assert.ok(!ring.view.text.includes("\uFFFD"));
});

test("decodes multi-byte characters split across appends", () => {
  const ring = createRingBuffer(100);
  const bytes = Buffer.from("é");
  ring.append(bytes.subarray(0, 1));
  ring.append(bytes.subarray(1));
  assert.equal(ring.view.text, "é");
});

test("replace swaps the contents and resets accounting", () => {
  const ring = createRingBuffer(100);
  ring.append(Buffer.from("old"));
  ring.replace("brand new");
  assert.equal(ring.view.text, "brand new");
  assert.equal(ring.view.totalBytes, 9);
  assert.equal(ring.view.droppedBytes, 0);
});

test("replace past the limit keeps the tail and records the drop", () => {
  const ring = createRingBuffer(4);
  ring.replace("abcdefgh");
  assert.equal(ring.view.text, "efgh");
  assert.equal(ring.view.totalBytes, 8);
  assert.equal(ring.view.droppedBytes, 4);
});

test("the view object identity is stable across mutations", () => {
  const ring = createRingBuffer(100);
  const view = ring.view;
  ring.append(Buffer.from("x"));
  assert.equal(view.text, "x");
  assert.equal(view, ring.view);
});
