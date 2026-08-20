/**
 * The baseline store, exercised against a fake filesystem. The fake records
 * which paths it was asked to READ, because "an enormous file is never loaded"
 * is a claim about a call that must not happen, not about a returned value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createBaselineStore, type BaselineIo } from "./baseline.ts";

function fakeIo(files: Record<string, string>) {
  const reads: string[] = [];
  const io: BaselineIo = {
    readFile(path) {
      reads.push(path);
      return files[path] ?? null;
    },
    fileSize(path) {
      const content = files[path];
      return content === undefined ? null : Buffer.byteLength(content);
    },
  };
  return { io, reads };
}

test("the first capture wins, however many follow", () => {
  const { io } = fakeIo({ "/w/a.ts": "one\n" });
  const store = createBaselineStore(io);

  store.capture("a.ts", "/w/a.ts");
  store.capture("a.ts", "/w/a.ts");

  assert.deepEqual(store.get("a.ts"), { content: "one\n", source: "snapshot" });
  assert.equal(store.size(), 1);
});

test("a file that is not there yet is captured as absent", () => {
  const { io } = fakeIo({});
  const store = createBaselineStore(io);

  store.capture("new.ts", "/w/new.ts");

  assert.deepEqual(store.get("new.ts"), { content: null, source: "absent" });
});

test("captureAbsent records a creation without touching the disk", () => {
  const { io, reads } = fakeIo({ "/w/a.ts": "one\n" });
  const store = createBaselineStore(io);

  store.captureAbsent("a.ts");

  assert.deepEqual(store.get("a.ts"), { content: null, source: "absent" });
  assert.deepEqual(reads, []);
});

test("an oversized file is never read, and holds no baseline", () => {
  const { io, reads } = fakeIo({ "/w/big.ts": "x".repeat(50) });
  const store = createBaselineStore(io, { maxBytes: 10 });

  store.capture("big.ts", "/w/big.ts");

  assert.equal(store.get("big.ts"), undefined);
  assert.deepEqual(reads, []);
});

test("a binary file holds no baseline: NUL means no line diff worth showing", () => {
  const { io } = fakeIo({ "/w/bin": `PNG${String.fromCharCode(0)}data` });
  const store = createBaselineStore(io);

  store.capture("bin", "/w/bin");

  assert.equal(store.get("bin"), undefined);
});

test("adopt takes a baseline computed elsewhere, and only the first one", () => {
  const { io } = fakeIo({});
  const store = createBaselineStore(io);

  store.adopt("a.ts", { content: "from git\n", source: "git" });
  store.adopt("a.ts", { content: "later\n", source: "git" });

  assert.deepEqual(store.get("a.ts"), { content: "from git\n", source: "git" });
});

test("a snapshot is not overwritten by a git blob", () => {
  const { io } = fakeIo({ "/w/a.ts": "snapshot\n" });
  const store = createBaselineStore(io);

  store.capture("a.ts", "/w/a.ts");
  store.adopt("a.ts", { content: "blob\n", source: "git" });

  assert.equal(store.get("a.ts")?.content, "snapshot\n");
});

test("clear empties the store", () => {
  const { io } = fakeIo({ "/w/a.ts": "one\n" });
  const store = createBaselineStore(io);
  store.capture("a.ts", "/w/a.ts");

  store.clear();

  assert.equal(store.size(), 0);
  assert.equal(store.get("a.ts"), undefined);
});
