import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byteLength,
  countLines,
  formatAge,
  formatBytes,
  formatDuration,
  formatStatus,
  lastOutputLine,
  originLabel,
  summarizeCommand,
} from "./domain.ts";

test("empty output is zero lines, not one", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("one"), 1);
  assert.equal(countLines("one\ntwo"), 2);
});

test("a trailing newline does not invent a line", () => {
  assert.equal(countLines("one\ntwo\n"), 2);
});

test("bytes are measured as utf8, not code units", () => {
  assert.equal(byteLength("é"), 2);
});

test("a multi-line command reports its first line and the rest as a count", () => {
  const summary = summarizeCommand("cd /tmp\nls -la\necho done");
  assert.equal(summary.text, "cd /tmp");
  assert.equal(summary.more, 2);
});

test("blank lines in a command are not counted as more", () => {
  const summary = summarizeCommand("ls\n\n\n");
  assert.equal(summary.text, "ls");
  assert.equal(summary.more, 0);
});

test("the peek is the last line with anything on it", () => {
  assert.equal(lastOutputLine("building...\nok\n\n  \n"), "ok");
  assert.equal(lastOutputLine("\n\n"), "");
});

test("durations read at the scale they happened", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(420), "420ms");
  assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(42_000), "42s");
  assert.equal(formatDuration(125_000), "2m05s");
});

test("sizes step up units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("ages are coarse and short", () => {
  const now = 1_000_000;
  assert.equal(formatAge(now, now), "0s ago");
  assert.equal(formatAge(now - 90_000, now), "1m ago");
  assert.equal(formatAge(now - 7_200_000, now), "2h ago");
});

test("a failure reads as its exit code when there is one", () => {
  assert.equal(formatStatus({ status: "failed", exitCode: 2 }), "exit 2");
  assert.equal(formatStatus({ status: "failed" }), "failed");
  assert.equal(formatStatus({ status: "timeout" }), "timed out");
  assert.equal(formatStatus({ status: "aborted" }), "aborted");
  assert.equal(formatStatus({ status: "ok" }), "ok");
});

test("our own commands carry no origin label", () => {
  assert.equal(originLabel({ kind: "session" }), "");
  assert.equal(
    originLabel({ kind: "subagent", id: "a", name: "auditor" }),
    "auditor",
  );
  assert.equal(originLabel({ kind: "workflow", label: "review" }), "review");
});
