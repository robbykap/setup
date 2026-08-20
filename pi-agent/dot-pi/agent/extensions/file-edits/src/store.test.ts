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

test("a local edit on top of a child's edit stays pending: its hunks are half the story", () => {
  // The child's diff was never captured (tool_execution_end carries none), so
  // the hunks this edit brings describe one call out of two. Calling that
  // settled is what made /files show a one-line diff for a file a subagent had
  // rewritten; staying pending sends the viewer to git HEAD for the whole file.
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 0, isNew: false, origin: SELF, at: 2 });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.edits, 2);
  // Last writer wins the badge, and the local hunks stay as the fallback for
  // when git cannot answer.
  assert.equal(change.origin.kind, "self");
  assert.equal(change.hunks.length, 1);
});

test("every record starts pending: one call is never the file's whole diff", () => {
  // What a call reports is what that call did. The counts beside it are the
  // session's running total, and only the resolver can make the two agree.
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 0, isNew: false, origin: SELF, at: 1 });
  assert.equal(store.get("a.ts")?.hunksPending, true);
});

test("a child's file goes pending again after every later local edit", () => {
  // Resolving once is not enough: the next local edit lands after the diff git
  // gave us, so the viewer has to ask again.
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "workflow", label: "run" }, at: 1 });
  store.resolveHunks("a.ts", { hunks: [hunk(9)], added: 9, removed: 0 });
  assert.equal(store.get("a.ts")?.hunksPending, false);
  store.record({ path: "a.ts", hunks: [hunk(1)], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.equal(store.get("a.ts")?.hunksPending, true);
});

test("a child edit after a local one keeps the local counts until git answers", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [hunk(4)], added: 4, removed: 2, isNew: true, origin: SELF, at: 1 });
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "writer" }, at: 2 });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.added, 4);
  assert.equal(change.removed, 2);
  assert.equal(change.edits, 2);
  assert.equal(change.isNew, true);
  assert.equal(change.origin.kind, "subagent");
  store.resolveHunks("a.ts", { hunks: [hunk(11)], added: 11, removed: 3 });
  assert.deepEqual(store.totals(), { files: 1, added: 11, removed: 3 });
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

test("eviction drops a file's patches with its record", () => {
  // The patches are a fallback diff for one file. Once the file falls out of
  // the store, keeping them would attach one session's hunks to the next
  // record that happens to share the path.
  const store = createFileEditStore({ cap: 2 });
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1, patch: "@@ -1 +1 @@\n-a\n+b\n" });
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  store.record({ path: "c.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.equal(store.get("a.ts"), undefined);

  store.record({ path: "a.ts", hunks: [hunk(1)], added: 1, removed: 0, isNew: false, origin: SELF, at: 4 });
  assert.deepEqual(store.get("a.ts")?.patches, []);
});

test("patches accumulate in arrival order, across local and child calls", () => {
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1, patch: "first" });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2, patch: "second" });
  store.recordExternal({ path: "a.ts", origin: { kind: "workflow", label: "run" }, at: 3 });
  assert.deepEqual(store.get("a.ts")?.patches, ["first", "second"]);
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
