import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskStore, MAX_TASKS } from "./src/store.ts";

test("add assigns kind-prefixed ids and lists newest first", () => {
  const store = createTaskStore();
  const first = store.add({ kind: "background", command: "sleep 1", cwd: "/repo" });
  const second = store.add({ kind: "foreground", command: "ls", cwd: "/repo" });
  const third = store.add({ kind: "user", command: "git status", cwd: "/repo" });
  assert.equal(first.id, "b1");
  assert.equal(second.id, "f1");
  assert.equal(third.id, "u1");
  assert.deepEqual(store.list().map((t) => t.id), ["u1", "f1", "b1"]);
});

test("add derives a one-line title from the command", () => {
  const store = createTaskStore();
  const task = store.add({ kind: "background", command: "npm run\n  build", cwd: "/" });
  assert.equal(task.title, "npm run build");
});

test("add honours an explicit title", () => {
  const store = createTaskStore();
  const task = store.add({
    kind: "background",
    command: "npm test",
    cwd: "/",
    title: "unit tests",
  });
  assert.equal(task.title, "unit tests");
});

test("background tasks get split streams, others merged", () => {
  const store = createTaskStore();
  assert.equal(store.add({ kind: "background", command: "x", cwd: "/" }).merged, false);
  assert.equal(store.add({ kind: "foreground", command: "x", cwd: "/" }).merged, true);
  assert.equal(store.add({ kind: "user", command: "x", cwd: "/" }).merged, true);
});

test("appendOutput accumulates per stream", () => {
  const store = createTaskStore();
  const task = store.add({ kind: "background", command: "x", cwd: "/" });
  store.appendOutput(task.id, "stdout", Buffer.from("out"));
  store.appendOutput(task.id, "stderr", Buffer.from("err"));
  store.appendOutput(task.id, "stdout", Buffer.from("put"));
  assert.equal(store.get(task.id)?.stdout.text, "output");
  assert.equal(store.get(task.id)?.stderr.text, "err");
});

test("replaceOutput overwrites stdout", () => {
  const store = createTaskStore();
  const task = store.add({ kind: "foreground", command: "x", cwd: "/" });
  store.replaceOutput(task.id, "one");
  store.replaceOutput(task.id, "one two");
  assert.equal(store.get(task.id)?.stdout.text, "one two");
});

test("output for an unknown id is ignored", () => {
  const store = createTaskStore();
  store.appendOutput("nope", "stdout", Buffer.from("x"));
  store.replaceOutput("nope", "x");
  assert.equal(store.size(), 0);
});

test("settle records the outcome and stamps endedAt once", () => {
  const store = createTaskStore({ now: () => 5_000 });
  const task = store.add({ kind: "background", command: "x", cwd: "/" });
  store.settle(task.id, { status: "failed", exitCode: 2 });
  store.settle(task.id, { status: "done", exitCode: 0 });
  const settled = store.get(task.id);
  assert.equal(settled?.status, "failed");
  assert.equal(settled?.exitCode, 2);
  assert.equal(settled?.endedAt, 5_000);
});

test("settle notifies onSettled listeners exactly once", () => {
  const store = createTaskStore();
  const seen: string[] = [];
  store.onSettled((task) => seen.push(task.id));
  const task = store.add({ kind: "background", command: "x", cwd: "/" });
  store.settle(task.id, { status: "done", exitCode: 0 });
  store.settle(task.id, { status: "done", exitCode: 0 });
  assert.deepEqual(seen, [task.id]);
});

test("subscribers are notified on add, output and settle", () => {
  const store = createTaskStore();
  let count = 0;
  const unsubscribe = store.subscribe(() => count++);
  const task = store.add({ kind: "background", command: "x", cwd: "/" });
  store.appendOutput(task.id, "stdout", Buffer.from("x"));
  store.settle(task.id, { status: "done", exitCode: 0 });
  assert.equal(count, 3);
  unsubscribe();
  store.add({ kind: "background", command: "y", cwd: "/" });
  assert.equal(count, 3);
});

test("requestKill reaches the kill handler", () => {
  const store = createTaskStore();
  const killed: string[] = [];
  store.onKillRequest((id) => killed.push(id));
  const task = store.add({ kind: "background", command: "x", cwd: "/" });
  store.requestKill(task.id);
  assert.deepEqual(killed, [task.id]);
});

test("requestKill is ignored for tasks the UI cannot kill", () => {
  const store = createTaskStore();
  const killed: string[] = [];
  store.onKillRequest((id) => killed.push(id));
  const foreground = store.add({ kind: "foreground", command: "x", cwd: "/" });
  const settled = store.add({ kind: "background", command: "y", cwd: "/" });
  store.settle(settled.id, { status: "done", exitCode: 0 });
  store.requestKill(foreground.id);
  store.requestKill(settled.id);
  assert.deepEqual(killed, []);
});

test("the cap evicts the oldest settled task and never a running one", () => {
  const store = createTaskStore();
  const running = store.add({ kind: "background", command: "long", cwd: "/" });
  for (let i = 0; i < MAX_TASKS; i++) {
    const task = store.add({ kind: "foreground", command: `cmd ${i}`, cwd: "/" });
    store.settle(task.id, { status: "done", exitCode: 0 });
  }
  assert.equal(store.size(), MAX_TASKS);
  assert.ok(store.get(running.id), "the running task must survive eviction");
  assert.equal(store.get("f1"), undefined, "the oldest settled task is evicted");
  assert.equal(store.droppedCount(), 1);
});

test("the cap keeps running tasks even when every entry is running", () => {
  const store = createTaskStore();
  for (let i = 0; i < MAX_TASKS + 3; i++) {
    store.add({ kind: "foreground", command: `cmd ${i}`, cwd: "/" });
  }
  assert.equal(store.size(), MAX_TASKS + 3);
});

test("runningBackgroundCount counts only live background tasks", () => {
  const store = createTaskStore();
  const first = store.add({ kind: "background", command: "a", cwd: "/" });
  store.add({ kind: "background", command: "b", cwd: "/" });
  store.add({ kind: "foreground", command: "c", cwd: "/" });
  assert.equal(store.runningBackgroundCount(), 2);
  store.settle(first.id, { status: "done", exitCode: 0 });
  assert.equal(store.runningBackgroundCount(), 1);
});

test("clear removes everything", () => {
  const store = createTaskStore();
  store.add({ kind: "background", command: "x", cwd: "/" });
  store.clear();
  assert.equal(store.size(), 0);
  assert.deepEqual(store.list(), []);
});
