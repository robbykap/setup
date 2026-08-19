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

test("a new file is in the store the moment the write returns", async () => {
  // The picker and the status segment read the store, not the viewer: a file
  // created this turn has to be listed before anything opens a diff.
  const store = createFileEditStore();
  const calls = createCallRecords();
  let listed: ReadonlyArray<string> = [];
  store.subscribe(() => {
    listed = store.list().map((change) => change.path);
  });
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/new.ts", content: "a\nb\nc" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureWrite(CWD, () => false),
    store,
    calls,
    at: 11,
  });
  const change = store.get("src/new.ts")!;
  assert.equal(change.isNew, true);
  assert.equal(change.added, 3);
  assert.equal(change.edits, 1);
  assert.deepEqual(store.totals(), { files: 1, added: 3, removed: 0 });
  // The subscriber fired with the row already in place, which is what drives
  // the status segment.
  assert.deepEqual(listed, ["src/new.ts"]);
});

test("a write over an existing file lands settled but with no hunks", async () => {
  // write reports no patch, so the store row is complete except for the diff;
  // the viewer's needsHunkResolution picks exactly this shape up and fills it
  // in from git HEAD.
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/old.ts", content: "a\nb" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureWrite(CWD, () => true),
    store,
    calls,
    at: 12,
  });
  const change = store.get("src/old.ts")!;
  assert.equal(change.isNew, false);
  assert.equal(change.added, 2);
  assert.deepEqual(change.hunks, []);
  assert.equal(change.hunksPending, false);
  store.resolveHunks("src/old.ts", { hunks: [], added: 6, removed: 4 });
  assert.equal(store.get("src/old.ts")!.added, 6);
});

test("an edit with no patch is still a listed file, not a dropped one", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await executeAndRecord({
    toolCallId: "call-1",
    params: { path: "src/a.ts" },
    run: async () => ({ content: [], details: {} }),
    measure: measureEdit(CWD),
    store,
    calls,
    at: 13,
  });
  const change = store.get("src/a.ts")!;
  assert.equal(change.edits, 1);
  assert.equal(change.added, 0);
  assert.equal(change.removed, 0);
  assert.deepEqual(change.hunks, []);
  assert.deepEqual(store.list().map((c) => c.path), ["src/a.ts"]);
});

test("a failure and its retry are one change, counted once", async () => {
  // Only a successful call is listed (cecec22), and the retry must not inherit
  // an edit count from the attempt that changed nothing.
  const store = createFileEditStore();
  const calls = createCallRecords();
  const params = { path: "src/a.ts" };
  await assert.rejects(
    executeAndRecord({
      toolCallId: "call-1",
      params,
      run: async () => {
        throw new Error("String to replace not found in file.");
      },
      measure: measureEdit(CWD),
      store,
      calls,
      at: 1,
    }),
  );
  assert.equal(store.size(), 0);
  await executeAndRecord({
    toolCallId: "call-2",
    params,
    run: async () => editResult(2, 1),
    measure: measureEdit(CWD),
    store,
    calls,
    at: 2,
  });
  const change = store.get("src/a.ts")!;
  assert.equal(change.edits, 1);
  assert.equal(change.added, 2);
  assert.equal(change.removed, 1);
  assert.equal(change.updatedAt, 2);
  assert.equal(calls.get("call-1"), undefined);
  assert.equal(calls.get("call-2")!.added, 2);
});

test("a failed write leaves no row behind either", async () => {
  const store = createFileEditStore();
  const calls = createCallRecords();
  await assert.rejects(
    executeAndRecord({
      toolCallId: "call-1",
      params: { path: "src/new.ts", content: "a\nb" },
      run: async () => {
        throw new Error("EACCES: permission denied");
      },
      measure: measureWrite(CWD, () => false),
      store,
      calls,
      at: 1,
    }),
  );
  assert.equal(store.size(), 0);
  await executeAndRecord({
    toolCallId: "call-2",
    params: { path: "src/new.ts", content: "a\nb" },
    run: async () => ({ content: [], details: undefined }),
    measure: measureWrite(CWD, () => false),
    store,
    calls,
    at: 2,
  });
  const change = store.get("src/new.ts")!;
  assert.equal(change.edits, 1);
  assert.equal(change.added, 2);
  assert.equal(change.isNew, true);
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
