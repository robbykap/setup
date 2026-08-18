import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCallRecords,
  executeAndRecord,
  measureEdit,
  measureWrite,
} from "./record.ts";
import { createFileEditStore } from "./store.ts";

const CWD = "/repo";

/** Two separate one-line edits to the same file, as the edit tool reports
 * them: a unified patch in details.patch. */
const patchOf = (added: number, removed: number) => {
  const lines = [
    `@@ -1,${removed + 1} +1,${added + 1} @@`,
    " context",
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ];
  return `${lines.join("\n")}\n`;
};

const editResult = (added: number, removed: number) => ({
  content: [{ type: "text" as const, text: "ok" }],
  details: { patch: patchOf(added, removed) },
});

test("an edit records its own counts per call and accumulates in the store", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  const params = { path: "src/router.ts" };
  const measure = measureEdit(CWD);

  await executeAndRecord({
    toolCallId: "call-1",
    params,
    run: async () => editResult(3, 1),
    measure,
    store,
    calls,
    at: 1000,
  });
  await executeAndRecord({
    toolCallId: "call-2",
    params,
    run: async () => editResult(5, 2),
    measure,
    store,
    calls,
    at: 2000,
  });

  const first = calls.get("call-1")!;
  const second = calls.get("call-2")!;
  assert.equal(first.added, 3);
  assert.equal(first.removed, 1);
  assert.equal(second.added, 5);
  assert.equal(second.removed, 2);
  // A row describes one call: never the file's history.
  assert.equal(first.edits, 1);
  assert.equal(second.edits, 1);
  assert.equal(first.hunks[0]!.lines.filter((l) => l.kind === "add").length, 3);
  assert.equal(second.hunks[0]!.lines.filter((l) => l.kind === "add").length, 5);

  // The store stays cumulative: the picker and the status segment want totals.
  const cumulative = store.get("src/router.ts")!;
  assert.equal(cumulative.added, 8);
  assert.equal(cumulative.removed, 3);
  assert.equal(cumulative.edits, 2);
});

test("a per-call record is keyed by tool call id and cleared with the session", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "a.ts" },
    run: async () => editResult(1, 0),
    measure: measureEdit(CWD),
    store,
    calls,
    at: 1,
  });
  assert.ok(calls.get("call-1"));
  assert.equal(calls.get("call-nope"), undefined);
  calls.clear();
  assert.equal(calls.get("call-1"), undefined);
});

test("an edit result with no details still records the call", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/a.ts" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureEdit(CWD),
    store,
    calls,
    at: 7,
  });
  const change = calls.get("call-1")!;
  assert.equal(change.path, "src/a.ts");
  assert.equal(change.added, 0);
  assert.equal(change.removed, 0);
  assert.deepEqual(change.hunks, []);
  assert.equal(change.hunksPending, false);
  assert.equal(change.updatedAt, 7);
  assert.deepEqual(change.origin, { kind: "self" });
});

test("write has no details, so its counts come from the content", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "/repo/src/new.ts", content: "a\nb\nc" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureWrite(CWD, () => false),
    store,
    calls,
    at: 3,
  });
  const change = calls.get("call-1")!;
  assert.equal(change.path, "src/new.ts");
  assert.equal(change.added, 3);
  assert.equal(change.removed, 0);
  assert.equal(change.isNew, true);
});

test("write over an existing file is not new", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/old.ts", content: "a\n" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureWrite(CWD, () => true),
    store,
    calls,
    at: 3,
  });
  assert.equal(calls.get("call-1")!.isNew, false);
});

test("write decides newness before the file is written", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  let written = false;
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/new.ts", content: "a\n" },
    run: async () => {
      written = true;
      return { content: [], details: undefined };
    },
    measure: measureWrite(CWD, () => written),
    store,
    calls,
    at: 3,
  });
  assert.equal(calls.get("call-1")!.isNew, true);
});

test("a failing execute propagates unchanged and records nothing", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  const failure = new Error("Could not edit file: src/a.ts. Error code: ENOENT.");
  await assert.rejects(
    executeAndRecord({
      toolCallId: "call-1",
      params: { path: "src/a.ts" },
      run: async () => {
        throw failure;
      },
      measure: measureEdit(CWD),
      store,
      calls,
      at: 1,
    }),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );
  assert.equal(store.size(), 0);
  assert.equal(calls.get("call-1"), undefined);
});

test("the delegated result is passed through untouched", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  const expected = {
    content: [{ type: "text" as const, text: "Successfully replaced 1 block(s) in a.ts." }],
    details: { diff: "diff", patch: patchOf(1, 1), firstChangedLine: 12 },
  };
  const actual = await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "a.ts" },
    run: async () => expected,
    measure: measureEdit(CWD),
    store,
    calls,
    at: 1,
  });
  assert.equal(actual, expected);
  assert.deepEqual(actual, {
    content: [{ type: "text", text: "Successfully replaced 1 block(s) in a.ts." }],
    details: { diff: "diff", patch: patchOf(1, 1), firstChangedLine: 12 },
  });
});

test("an edit's store key comes from storeKeyFor", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "/repo/src/a.ts" },
    run: async () => editResult(1, 0),
    measure: measureEdit(CWD),
    store,
    calls,
    at: 1,
  });
  assert.equal(calls.get("call-1")!.path, "src/a.ts");
});
