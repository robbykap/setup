import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "./src/domain.ts";
import {
  buildSendToAgentMessage,
  buildSettledMessage,
  describeTask,
  tailLines,
} from "./src/prompt.ts";

function view(text: string) {
  return { text, totalBytes: Buffer.byteLength(text), droppedBytes: 0 };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "b1",
    kind: "background",
    title: "npm test",
    command: "npm test",
    cwd: "/repo",
    status: "done",
    exitCode: 0,
    startedAt: 0,
    endedAt: 2_000,
    merged: false,
    pid: 42,
    stdout: view("all good\n"),
    stderr: view(""),
    ...overrides,
  };
}

test("tailLines keeps the last N lines and notes what it dropped", () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
  const result = tailLines(text, 3);
  assert.match(result, /line 9$/);
  assert.ok(!result.includes("line 5"));
  assert.match(result, /7 earlier lines/);
});

test("tailLines leaves short output untouched", () => {
  assert.equal(tailLines("one\ntwo", 5), "one\ntwo");
});

test("describeTask is a single informative line", () => {
  const line = describeTask(makeTask());
  assert.ok(!line.includes("\n"));
  assert.match(line, /b1/);
  assert.match(line, /npm test/);
  assert.match(line, /exit 0/);
});

test("the settled message names the task and includes its output", () => {
  const message = buildSettledMessage(makeTask());
  assert.match(message, /b1/);
  assert.match(message, /finished/);
  assert.match(message, /all good/);
});

test("the settled message reports failures with the exit code", () => {
  const message = buildSettledMessage(
    makeTask({ status: "failed", exitCode: 2, stderr: view("boom") }),
  );
  assert.match(message, /failed/);
  assert.match(message, /exit 2/);
  assert.match(message, /boom/);
});

test("the send-to-agent message asks for attention", () => {
  const message = buildSendToAgentMessage(makeTask());
  assert.match(message, /npm test/);
  assert.match(message, /all good/);
});
