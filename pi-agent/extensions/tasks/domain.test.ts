import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterTasks,
  formatElapsed,
  formatExit,
  isKillable,
  nextFilter,
  type Task,
} from "./src/domain.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  const empty = { text: "", totalBytes: 0, droppedBytes: 0 };
  return {
    id: "b1",
    kind: "background",
    title: "npm test",
    command: "npm test",
    cwd: "/repo",
    status: "running",
    startedAt: 1000,
    merged: false,
    stdout: empty,
    stderr: empty,
    ...overrides,
  };
}

test("formatElapsed counts from start while running", () => {
  const task = makeTask({ startedAt: 0 });
  assert.equal(formatElapsed(task, 12_000), "0:12");
  assert.equal(formatElapsed(task, 605_000), "10:05");
});

test("formatElapsed freezes at the end time once settled", () => {
  const task = makeTask({ startedAt: 0, status: "done", endedAt: 3_000 });
  assert.equal(formatElapsed(task, 999_000), "0:03");
});

test("formatExit describes each terminal status", () => {
  assert.equal(formatExit(makeTask({ status: "done", exitCode: 0 })), "exit 0");
  assert.equal(formatExit(makeTask({ status: "failed", exitCode: 2 })), "exit 2");
  assert.equal(formatExit(makeTask({ status: "killed", signal: "SIGKILL" })), "SIGKILL");
  assert.equal(formatExit(makeTask({ status: "running" })), "running");
  assert.equal(
    formatExit(makeTask({ status: "failed", errorText: "spawn ENOENT" })),
    "spawn ENOENT",
  );
});

test("only running background tasks are killable", () => {
  assert.equal(isKillable(makeTask()), true);
  assert.equal(isKillable(makeTask({ status: "done" })), false);
  assert.equal(isKillable(makeTask({ kind: "foreground" })), false);
  assert.equal(isKillable(makeTask({ kind: "user" })), false);
});

test("filterTasks selects by mode", () => {
  const tasks = [
    makeTask({ id: "b1", kind: "background", status: "running" }),
    makeTask({ id: "f1", kind: "foreground", status: "failed" }),
    makeTask({ id: "u1", kind: "user", status: "done" }),
  ];
  assert.deepEqual(filterTasks(tasks, "all").map((t) => t.id), ["b1", "f1", "u1"]);
  assert.deepEqual(filterTasks(tasks, "background").map((t) => t.id), ["b1"]);
  assert.deepEqual(filterTasks(tasks, "failed").map((t) => t.id), ["f1"]);
});

test("nextFilter cycles all -> background -> failed -> all", () => {
  assert.equal(nextFilter("all"), "background");
  assert.equal(nextFilter("background"), "failed");
  assert.equal(nextFilter("failed"), "all");
});
