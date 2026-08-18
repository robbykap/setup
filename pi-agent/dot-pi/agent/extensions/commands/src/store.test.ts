import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRecord } from "./domain.ts";
import { createCommandStore } from "./store.ts";

function record(id: string, overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id,
    tool: "bash",
    command: `echo ${id}`,
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 0,
    durationMs: 1,
    status: "ok",
    output: id,
    outputLines: 1,
    outputBytes: id.length,
    ...overrides,
  };
}

test("the newest command is listed first", () => {
  const store = createCommandStore();
  store.record(record("a"));
  store.record(record("b"));
  assert.deepEqual(
    store.list().map((entry) => entry.id),
    ["b", "a"],
  );
});

test("two runs of the same command are two entries", () => {
  const store = createCommandStore();
  store.record(record("a", { command: "git status" }));
  store.record(record("b", { command: "git status" }));
  assert.equal(store.size(), 2);
});

test("re-recording an id replaces it rather than duplicating", () => {
  const store = createCommandStore();
  store.record(record("a", { status: "ok" }));
  store.record(record("a", { status: "failed" }));
  assert.equal(store.size(), 1);
  assert.equal(store.get("a")?.status, "failed");
});

test("the log is bounded, oldest first out", () => {
  const store = createCommandStore({ cap: 2 });
  store.record(record("a"));
  store.record(record("b"));
  store.record(record("c"));
  assert.equal(store.size(), 2);
  assert.equal(store.get("a"), undefined);
  assert.deepEqual(
    store.list().map((entry) => entry.id),
    ["c", "b"],
  );
});

test("totals count failures of every kind", () => {
  const store = createCommandStore();
  store.record(record("a"));
  store.record(record("b", { status: "failed" }));
  store.record(record("c", { status: "timeout" }));
  assert.deepEqual(store.totals(), { commands: 3, failed: 2 });
});

test("subscribers are notified on write and can unsubscribe", () => {
  const store = createCommandStore();
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.record(record("a"));
  assert.equal(calls, 1);
  stop();
  store.record(record("b"));
  assert.equal(calls, 1);
});
