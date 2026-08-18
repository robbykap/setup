import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCallRecords,
  executeBashAndRecord,
  parseFailureMessage,
  parseFullOutputPath,
  resultText,
} from "./record.ts";
import { createCommandStore } from "./store.ts";

test("an exit code is read off the trailing status line", () => {
  const parsed = parseFailureMessage("boom\nmore\n\nCommand exited with code 2");
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.exitCode, 2);
  assert.equal(parsed.output, "boom\nmore");
});

test("an abort and a timeout are not the same failure", () => {
  assert.equal(parseFailureMessage("x\n\nCommand aborted").status, "aborted");
  assert.equal(
    parseFailureMessage("x\n\nCommand timed out after 30 seconds").status,
    "timeout",
  );
});

test("a message with no status line keeps all of its text as output", () => {
  const parsed = parseFailureMessage("spawn ENOENT");
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.exitCode, undefined);
  assert.equal(parsed.output, "spawn ENOENT");
});

test("the spill path is taken from the truncation banner", () => {
  const path = parseFullOutputPath(
    "lines\n\n[Showing lines 1-5 of 900. Full output: /tmp/pi-bash-1/output.txt]",
  );
  assert.equal(path, "/tmp/pi-bash-1/output.txt");
});

test("no banner means no spill path", () => {
  assert.equal(parseFullOutputPath("all of it"), undefined);
});

test("result text joins the text parts and ignores the rest", () => {
  assert.equal(
    resultText({
      content: [
        { type: "text", text: "one" },
        { type: "image" },
        { type: "text", text: "two" },
      ],
    }),
    "one\ntwo",
  );
});

function fixture() {
  const store = createCommandStore();
  const calls = createCallRecords();
  let clock = 1000;
  const now = () => {
    const value = clock;
    clock += 250;
    return value;
  };
  return { store, calls, now };
}

test("a successful call is recorded with its output and duration", async () => {
  const { store, calls, now } = fixture();
  const result = await executeBashAndRecord({
    toolCallId: "call-1",
    command: "git status",
    cwd: "/repo",
    store,
    calls,
    now,
    run: async () => ({ content: [{ type: "text", text: "clean" }] }),
  });

  assert.deepEqual(result.content, [{ type: "text", text: "clean" }]);
  const recorded = store.get("call-1");
  assert.equal(recorded?.status, "ok");
  assert.equal(recorded?.command, "git status");
  assert.equal(recorded?.output, "clean");
  assert.equal(recorded?.outputLines, 1);
  assert.equal(recorded?.durationMs, 250);
  assert.equal(calls.get("call-1")?.status, "ok");
});

test("the details' spill path wins over the one in the text", async () => {
  const { store, calls, now } = fixture();
  await executeBashAndRecord({
    toolCallId: "call-2",
    command: "yes",
    cwd: "/repo",
    store,
    calls,
    now,
    run: async () => ({
      content: [{ type: "text", text: "y\n\n[Full output: /tmp/stale]" }],
      details: { fullOutputPath: "/tmp/fresh" },
    }),
  });
  assert.equal(store.get("call-2")?.fullOutputPath, "/tmp/fresh");
});

test("a failure is recorded and the error re-thrown untouched", async () => {
  const { store, calls, now } = fixture();
  const error = new Error(
    "fatal: not a git repository\n\n[Showing lines 1-1 of 9. Full output: /tmp/spill.txt]\n\nCommand exited with code 128",
  );

  await assert.rejects(
    executeBashAndRecord({
      toolCallId: "call-3",
      command: "git log",
      cwd: "/repo",
      store,
      calls,
      now,
      run: async () => {
        throw error;
      },
    }),
    (thrown: unknown) => thrown === error,
  );

  const recorded = store.get("call-3");
  assert.equal(recorded?.status, "failed");
  assert.equal(recorded?.exitCode, 128);
  assert.equal(recorded?.fullOutputPath, "/tmp/spill.txt");
  assert.match(recorded?.output ?? "", /not a git repository/);
  assert.doesNotMatch(recorded?.output ?? "", /Command exited with code/);
});
