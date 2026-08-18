import assert from "node:assert/strict";
import { test } from "node:test";
import { createObserver } from "./src/observe.ts";
import { createTaskStore } from "./src/store.ts";

const partial = (text: string) => ({ content: [{ type: "text", text }] });

test("a bash tool call becomes a running foreground task", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "bash", args: { command: "npm test" } },
    "/repo",
  );
  const [task] = store.list();
  assert.equal(task.kind, "foreground");
  assert.equal(task.command, "npm test");
  assert.equal(task.cwd, "/repo");
  assert.equal(task.status, "running");
  assert.equal(task.merged, true);
});

test("non-bash tool calls are ignored", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "read", args: { path: "x" } },
    "/repo",
  );
  assert.equal(store.size(), 0);
});

test("cumulative updates replace rather than duplicate output", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "bash", args: { command: "x" } },
    "/repo",
  );
  observer.toolUpdate({ toolCallId: "call-1", partialResult: partial("line 1\n") });
  observer.toolUpdate({
    toolCallId: "call-1",
    partialResult: partial("line 1\nline 2\n"),
  });
  assert.equal(store.list()[0].stdout.text, "line 1\nline 2\n");
});

test("the end event settles with the final output", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "bash", args: { command: "x" } },
    "/repo",
  );
  observer.toolEnd({
    toolCallId: "call-1",
    result: partial("all done\n"),
    isError: false,
  });
  const [task] = store.list();
  assert.equal(task.status, "done");
  assert.equal(task.stdout.text, "all done\n");
});

test("an errored tool result settles as failed", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "bash", args: { command: "x" } },
    "/repo",
  );
  observer.toolEnd({
    toolCallId: "call-1",
    result: partial("boom"),
    isError: true,
  });
  assert.equal(store.list()[0].status, "failed");
});

test("updates and ends for unknown call ids are ignored", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolUpdate({ toolCallId: "ghost", partialResult: partial("x") });
  observer.toolEnd({ toolCallId: "ghost", result: partial("x"), isError: false });
  assert.equal(store.size(), 0);
});

test("a second end for the same call id does not resurrect the task", () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  observer.toolStart(
    { toolCallId: "call-1", toolName: "bash", args: { command: "x" } },
    "/repo",
  );
  observer.toolEnd({ toolCallId: "call-1", result: partial("a"), isError: false });
  observer.toolEnd({ toolCallId: "call-1", result: partial("b"), isError: true });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].status, "done");
  assert.equal(store.list()[0].stdout.text, "a");
});

test("user bash wraps the given operations and records output", async () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  const base = {
    async exec(
      _command: string,
      _cwd: string,
      options: { onData: (data: Buffer) => void },
    ) {
      options.onData(Buffer.from("from the shell"));
      return { exitCode: 0 };
    },
  };

  const wrapped = observer.userBash(
    { command: "git status", cwd: "/repo" },
    base,
  );
  const result = await wrapped.exec("git status", "/repo", { onData: () => {} });

  assert.equal(result.exitCode, 0);
  const [task] = store.list();
  assert.equal(task.kind, "user");
  assert.equal(task.command, "git status");
  assert.equal(task.stdout.text, "from the shell");
  assert.equal(task.status, "done");
});

test("user bash still forwards output to the original consumer", async () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  const base = {
    async exec(
      _command: string,
      _cwd: string,
      options: { onData: (data: Buffer) => void },
    ) {
      options.onData(Buffer.from("hi"));
      return { exitCode: 0 };
    },
  };
  const seen: string[] = [];
  const wrapped = observer.userBash({ command: "echo hi", cwd: "/repo" }, base);
  await wrapped.exec("echo hi", "/repo", {
    onData: (data) => seen.push(data.toString()),
  });
  assert.deepEqual(seen, ["hi"]);
});

test("a throwing user bash execution settles as failed and rethrows", async () => {
  const store = createTaskStore();
  const observer = createObserver(store);
  const base = {
    async exec() {
      throw new Error("shell exploded");
    },
  };
  const wrapped = observer.userBash({ command: "boom", cwd: "/repo" }, base);
  await assert.rejects(
    () => wrapped.exec("boom", "/repo", { onData: () => {} }),
    /shell exploded/,
  );
  const [task] = store.list();
  assert.equal(task.status, "failed");
  assert.equal(task.errorText, "shell exploded");
});
