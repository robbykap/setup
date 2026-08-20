/**
 * What a reload gets back. The records outlive the version of the extension
 * that wrote them, so the reader validates rather than trusts — a field that
 * has changed shape costs one record, never the whole history.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange } from "./domain.ts";
import { fromFileRecord, pinnedShaFrom, toFileRecord } from "./persist.ts";
import { createFileEditStore } from "./store.ts";

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: "src/a.ts",
    hunks: [{ oldStart: 1, newStart: 1, lines: [] }],
    patches: ["@@ -1 +1 @@\n-a\n+b\n"],
    added: 3,
    removed: 1,
    edits: 2,
    isNew: false,
    updatedAt: 1234,
    origin: { kind: "subagent", id: "sa-2", name: "writer" },
    hunksPending: false,
    ...overrides,
  };
}

test("a change round-trips, minus the hunks", () => {
  // Hunks are the biggest field and the cheapest to recompute; the resolver
  // rebuilds them from the baseline on open.
  const restored = fromFileRecord(toFileRecord(change()));

  assert.equal(restored?.path, "src/a.ts");
  assert.equal(restored?.added, 3);
  assert.equal(restored?.removed, 1);
  assert.equal(restored?.edits, 2);
  assert.equal(restored?.updatedAt, 1234);
  assert.deepEqual(restored?.origin, { kind: "subagent", id: "sa-2", name: "writer" });
  assert.deepEqual(restored?.patches, ["@@ -1 +1 @@\n-a\n+b\n"]);
  assert.deepEqual(restored?.hunks, []);
  assert.equal(restored?.hunksPending, true);
});

test("a restored change says that it was restored", () => {
  assert.equal(fromFileRecord(toFileRecord(change()))?.restored, true);
});

test("only the last patches are kept", () => {
  const many = Array.from({ length: 30 }, (_, index) => `patch ${index}`);
  const record = toFileRecord(change({ patches: many }));

  assert.equal(record.patches.length, 20);
  assert.equal(record.patches[0], "patch 10");
});

test("records that survive a version are read; the rest are skipped", () => {
  assert.equal(fromFileRecord({ kind: "meta", headSha: "abc" }), undefined);
  assert.equal(fromFileRecord({ kind: "file" }), undefined);
  assert.equal(fromFileRecord({ kind: "file", path: "", origin: { kind: "self" } }), undefined);
  assert.equal(fromFileRecord({ kind: "file", path: "a.ts", origin: { kind: "nope" } }), undefined);
  assert.equal(fromFileRecord(null), undefined);
});

test("missing numbers read as zero rather than as NaN", () => {
  const restored = fromFileRecord({
    kind: "file",
    path: "a.ts",
    origin: { kind: "self" },
  });

  assert.equal(restored?.added, 0);
  assert.equal(restored?.removed, 0);
  assert.equal(restored?.edits, 1);
  assert.equal(restored?.isNew, false);
  assert.deepEqual(restored?.patches, []);
});

test("the pinned commit is recovered, and a repository-less session too", () => {
  assert.deepEqual(pinnedShaFrom([{ kind: "meta", headSha: "c0ffee" }]), {
    headSha: "c0ffee",
  });
  // null is an answer — "there was no repository" — and absence is not.
  assert.deepEqual(pinnedShaFrom([{ kind: "meta", headSha: null }]), {
    headSha: null,
  });
  assert.equal(pinnedShaFrom([{ kind: "file", path: "a.ts" }]), undefined);
  assert.equal(pinnedShaFrom([]), undefined);
});

test("replaying a log rebuilds the store, last record per path winning", () => {
  const store = createFileEditStore();
  const records = [
    toFileRecord(change({ path: "a.ts", added: 1, updatedAt: 1 })),
    toFileRecord(change({ path: "b.ts", added: 5, updatedAt: 2 })),
    toFileRecord(change({ path: "a.ts", added: 9, updatedAt: 3 })),
  ];

  for (const record of records) {
    const restored = fromFileRecord(record);
    if (restored) store.restore(restored);
  }

  assert.equal(store.size(), 2);
  assert.equal(store.get("a.ts")?.added, 9);
  assert.deepEqual(
    store.list().map((entry) => entry.path),
    ["a.ts", "b.ts"],
  );
});

test("a restore is not itself an event worth logging", () => {
  // Replaying a log back into the log is how one grows without bound.
  const logged: string[] = [];
  const store = createFileEditStore({ sink: (entry) => logged.push(entry.path) });

  store.restore(fromFileRecord(toFileRecord(change()))!);
  assert.deepEqual(logged, []);

  store.record({
    path: "b.ts",
    hunks: [],
    added: 1,
    removed: 0,
    isNew: false,
    origin: { kind: "self" },
    at: 1,
  });
  assert.deepEqual(logged, ["b.ts"]);
});
