import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Task } from "./src/domain.ts";
import {
  handleDashboardKey,
  newDashboardState,
  reconcileSelection,
  renderDashboardLines,
} from "./src/ui/dashboard.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function makeTask(overrides: Partial<Task> = {}): Task {
  const empty = { text: "", totalBytes: 0, droppedBytes: 0 };
  return {
    id: "b1",
    kind: "background",
    title: "npm test",
    command: "npm test",
    cwd: "/repo",
    status: "running",
    startedAt: 0,
    merged: false,
    stdout: empty,
    stderr: empty,
    pid: 100,
    ...overrides,
  };
}

test("selection follows the task id when the list shifts", () => {
  const state = newDashboardState();
  const before = [makeTask({ id: "b1" }), makeTask({ id: "b2" })];
  state.index = 1;
  reconcileSelection(state, before);
  assert.equal(state.id, "b2");

  // A newer task arrives at the front; the cursor must stay on b2.
  const after = [makeTask({ id: "b3" }), makeTask({ id: "b1" }), makeTask({ id: "b2" })];
  reconcileSelection(state, after);
  assert.equal(state.index, 2);
  assert.equal(state.id, "b2");
});

test("selection clamps when the selected task disappears", () => {
  const state = newDashboardState();
  state.index = 2;
  state.id = "gone";
  reconcileSelection(state, [makeTask({ id: "b1" })]);
  assert.equal(state.index, 0);
  assert.equal(state.id, "b1");
});

test("selection of an empty list is index zero with no id", () => {
  const state = newDashboardState();
  reconcileSelection(state, []);
  assert.equal(state.index, 0);
  assert.equal(state.id, undefined);
});

test("rows show title, id, pid, elapsed and status", () => {
  const state = newDashboardState();
  const tasks = [makeTask({ id: "b1", title: "npm test", pid: 421 })];
  const lines = renderDashboardLines(tasks, state, {
    width: 80,
    height: 10,
    theme,
    now: 12_000,
  });
  const row = lines.find((line) => line.includes("npm test"));
  assert.ok(row, "expected a row for the task");
  assert.match(row, /b1/);
  assert.match(row, /pid 421/);
  assert.match(row, /0:12/);
  assert.match(row, /running/);
});

test("every rendered line fits the width", () => {
  const state = newDashboardState();
  const tasks = [
    makeTask({ id: "b1", title: "a".repeat(200), command: "b".repeat(200) }),
  ];
  for (const width of [40, 60, 100]) {
    const lines = renderDashboardLines(tasks, state, {
      width,
      height: 8,
      theme,
      now: 0,
    });
    for (const line of lines) {
      // Visible width, not string length: truncation inserts ANSI resets.
      const shown = visibleWidth(line);
      assert.ok(shown <= width, `line of visible width ${shown} exceeds ${width}`);
    }
  }
});

test("the header reports the running count and active filter", () => {
  const state = newDashboardState();
  state.filter = "failed";
  const tasks = [makeTask({ id: "b1", status: "failed" })];
  const lines = renderDashboardLines(tasks, state, {
    width: 80,
    height: 8,
    theme,
    now: 0,
  });
  assert.ok(lines.some((line) => line.includes("failed")));
});

test("an empty filtered list explains itself", () => {
  const state = newDashboardState();
  state.filter = "background";
  const lines = renderDashboardLines([makeTask({ kind: "foreground" })], state, {
    width: 80,
    height: 8,
    theme,
    now: 0,
  });
  assert.ok(lines.some((line) => line.includes("No tasks match")));
});

test("the rendered height matches the requested height", () => {
  const state = newDashboardState();
  const lines = renderDashboardLines([makeTask()], state, {
    width: 80,
    height: 12,
    theme,
    now: 0,
  });
  assert.equal(lines.length, 12);
});

test("more tasks than rows show an overflow marker", () => {
  const state = newDashboardState();
  const tasks = Array.from({ length: 20 }, (_, i) => makeTask({ id: `b${i}` }));
  const lines = renderDashboardLines(tasks, state, {
    width: 80,
    height: 8,
    theme,
    now: 0,
  });
  assert.ok(lines.some((line) => line.includes("more")));
});

test("keys move the cursor, cycle the filter, inspect, kill and close", () => {
  const tasks = [makeTask({ id: "b1" }), makeTask({ id: "b2" })];
  const state = newDashboardState();

  assert.deepEqual(handleDashboardKey("down", state, tasks), { type: "render" });
  assert.equal(state.index, 1);
  assert.deepEqual(handleDashboardKey("down", state, tasks), { type: "render" });
  assert.equal(state.index, 0, "wraps around");
  assert.deepEqual(handleDashboardKey("up", state, tasks), { type: "render" });
  assert.equal(state.index, 1);

  assert.deepEqual(handleDashboardKey("filter", state, tasks), { type: "render" });
  assert.equal(state.filter, "background");

  assert.deepEqual(handleDashboardKey("confirm", state, tasks), {
    type: "inspect",
    id: "b2",
  });
  assert.deepEqual(handleDashboardKey("kill", state, tasks), {
    type: "kill",
    id: "b2",
  });
  assert.deepEqual(handleDashboardKey("cancel", state, tasks), { type: "close" });
});

test("killing an unkillable task reports why", () => {
  const tasks = [makeTask({ id: "f1", kind: "foreground" })];
  const state = newDashboardState();
  const action = handleDashboardKey("kill", state, tasks);
  assert.equal(action.type, "notify");
});
