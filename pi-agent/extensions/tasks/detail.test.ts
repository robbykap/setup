import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Task } from "./src/domain.ts";
import {
  handleDetailKey,
  newDetailState,
  renderDetailLines,
} from "./src/ui/detail.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function view(text: string, droppedBytes = 0) {
  return { text, totalBytes: Buffer.byteLength(text), droppedBytes };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "b1",
    kind: "background",
    title: "npm test",
    command: "npm test",
    cwd: "/repo",
    status: "running",
    startedAt: 0,
    merged: false,
    pid: 100,
    stdout: view(""),
    stderr: view(""),
    ...overrides,
  };
}

test("the header shows id, command, status and cwd", () => {
  const lines = renderDetailLines(makeTask(), newDetailState(), {
    width: 80,
    height: 20,
    theme,
    now: 5_000,
  });
  const text = lines.join("\n");
  assert.match(text, /b1/);
  assert.match(text, /npm test/);
  assert.match(text, /running/);
  assert.match(text, /\/repo/);
  assert.match(text, /0:05/);
});

test("output is shown pinned to the bottom", () => {
  const task = makeTask({ stdout: view("l1\nl2\nl3\nl4\nl5\nl6") });
  const lines = renderDetailLines(task, newDetailState(), {
    width: 40,
    height: 12,
    theme,
    now: 0,
  });
  const text = lines.join("\n");
  assert.match(text, /l6/, "the newest line is visible");
});

test("scrolling up reveals earlier lines and reports the offset", () => {
  const task = makeTask({
    stdout: view(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")),
  });
  const state = newDetailState();
  const opts = { width: 40, height: 14, theme, now: 0 };
  handleDetailKey("up", state, task, 10);
  const text = renderDetailLines(task, state, opts).join("\n");
  assert.match(text, /below/, "a scroll indicator appears");
});

test("the stdout/stderr tab line appears only for split streams", () => {
  const split = renderDetailLines(makeTask(), newDetailState(), {
    width: 60,
    height: 14,
    theme,
    now: 0,
  }).join("\n");
  assert.match(split, /stdout/);
  assert.match(split, /stderr/);

  const merged = renderDetailLines(
    makeTask({ kind: "foreground", merged: true }),
    newDetailState(),
    { width: 60, height: 14, theme, now: 0 },
  ).join("\n");
  assert.ok(!merged.includes("stderr"), "merged output has no stream tabs");
});

test("a dropped-bytes note appears when output was truncated", () => {
  const task = makeTask({ stdout: view("tail", 4096) });
  const text = renderDetailLines(task, newDetailState(), {
    width: 60,
    height: 14,
    theme,
    now: 0,
  }).join("\n");
  assert.match(text, /dropped/);
});

test("an empty stream says so", () => {
  const text = renderDetailLines(makeTask(), newDetailState(), {
    width: 60,
    height: 14,
    theme,
    now: 0,
  }).join("\n");
  assert.match(text, /no stdout yet/);
});

test("every rendered line fits the width", () => {
  const task = makeTask({
    command: "c".repeat(300),
    cwd: "/" + "d".repeat(300),
    stdout: view("x".repeat(500)),
  });
  for (const width of [40, 72, 120]) {
    const lines = renderDetailLines(task, newDetailState(), {
      width,
      height: 16,
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

test("the rendered height matches the requested height", () => {
  const lines = renderDetailLines(makeTask(), newDetailState(), {
    width: 60,
    height: 16,
    theme,
    now: 0,
  });
  assert.equal(lines.length, 16);
});

test("keys scroll, toggle stream, kill, send, yank and close", () => {
  const task = makeTask();
  const state = newDetailState();

  assert.deepEqual(handleDetailKey("up", state, task, 10), { type: "render" });
  assert.ok(state.scrollOffset > 0);
  assert.deepEqual(handleDetailKey("bottom", state, task, 10), { type: "render" });
  assert.equal(state.scrollOffset, 0);

  assert.deepEqual(handleDetailKey("toggle", state, task, 10), { type: "render" });
  assert.equal(state.stream, "stderr");

  assert.deepEqual(handleDetailKey("kill", state, task, 10), {
    type: "kill",
    id: "b1",
  });
  assert.deepEqual(handleDetailKey("send", state, task, 10), {
    type: "send",
    id: "b1",
  });
  assert.deepEqual(handleDetailKey("yank", state, task, 10), {
    type: "yank",
    id: "b1",
  });
  assert.deepEqual(handleDetailKey("cancel", state, task, 10), { type: "close" });
});

test("toggling the stream on merged output explains itself", () => {
  const task = makeTask({ kind: "foreground", merged: true });
  const action = handleDetailKey("toggle", newDetailState(), task, 10);
  assert.equal(action.type, "notify");
});

test("killing a task pi owns explains itself", () => {
  const task = makeTask({ kind: "foreground", merged: true });
  const action = handleDetailKey("kill", newDetailState(), task, 10);
  assert.equal(action.type, "notify");
});
