import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileEditStore } from "./store.ts";

const SELF = { kind: "self" } as const;

function hunk(added: number) {
  return {
    oldStart: 1,
    newStart: 1,
    lines: Array.from({ length: added }, (_, index) => ({
      kind: "add" as const,
      newLine: index + 1,
      text: "x",
    })),
  };
}

test("records a change and lists it", () => {
  const store = createFileEditStore();
  store.record({
    path: "src/a.ts",
    hunks: [hunk(2)],
    added: 2,
    removed: 1,
    isNew: false,
    origin: SELF,
    at: 1000,
  });
  const change = store.get("src/a.ts");
  assert.equal(change?.added, 2);
  assert.equal(change?.removed, 1);
  assert.equal(change?.edits, 1);
  assert.equal(store.size(), 1);
});

test("a second edit to the same file merges counts and bumps edits", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 1, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(3)], added: 3, removed: 0, isNew: false, origin: SELF, at: 2 });
  const change = store.get("a.ts")!;
  assert.equal(change.added, 5);
  assert.equal(change.removed, 1);
  assert.equal(change.edits, 2);
  assert.equal(change.updatedAt, 2);
  // Hunks come from the most recent edit, not the accumulated history.
  assert.equal(change.hunks[0]!.lines.length, 3);
});

test("isNew sticks once a file has been created this session", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 4, removed: 0, isNew: true, origin: SELF, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(1)], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(store.get("a.ts")?.isNew, true);
});

test("list is ordered most-recently-changed first", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.deepEqual(store.list().map((change) => change.path), ["a.ts", "b.ts"]);
});

test("external records mark hunks as pending", () => {
  const store = createFileEditStore();
  store.recordExternal({
    path: "a.ts",
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
    at: 5,
  });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.origin.kind, "subagent");
});

test("a real edit supersedes a pending external record", () => {
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(store.get("a.ts")?.hunksPending, false);
});

test("resolveHunks fills in a pending record", () => {
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1 });
  store.resolveHunks("a.ts", { hunks: [hunk(3)], added: 3, removed: 1 });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, false);
  assert.equal(change.added, 3);
  assert.equal(change.removed, 1);
});

test("the store is capped, dropping the oldest entries", () => {
  const store = createFileEditStore({ cap: 2 });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  store.record({ path: "c.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.equal(store.size(), 2);
  assert.equal(store.get("a.ts"), undefined);
});

test("totals sum across files", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 2, removed: 1, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 3, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.deepEqual(store.totals(), { files: 2, added: 5, removed: 1 });
});

test("subscribers are notified on every write and can unsubscribe", () => {
  const store = createFileEditStore();
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  stop();
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(calls, 1);
});
