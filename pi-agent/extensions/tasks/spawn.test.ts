import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskStore } from "./src/store.ts";
import { createSpawner, MAX_BACKGROUND } from "./src/spawn.ts";

/** Resolve once the given task leaves the running state. */
function settled(store: ReturnType<typeof createTaskStore>, id: string) {
  return waitFor(store, () => store.get(id)?.status !== "running");
}

/** Resolve once a store change makes the condition true. */
function waitFor(
  store: ReturnType<typeof createTaskStore>,
  condition: () => boolean,
) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (!condition()) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = store.subscribe(check);
    check();
  });
}

test("captures stdout and a zero exit code", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  const task = spawner.start({ command: "printf hello", cwd: process.cwd() });
  await settled(store, task.id);
  const done = store.get(task.id);
  assert.equal(done?.status, "done");
  assert.equal(done?.exitCode, 0);
  assert.equal(done?.stdout.text, "hello");
  assert.ok(typeof done?.pid === "number");
  await spawner.killAll();
});

test("separates stderr and marks a non-zero exit as failed", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  const task = spawner.start({
    command: "printf oops 1>&2; exit 3",
    cwd: process.cwd(),
  });
  await settled(store, task.id);
  const done = store.get(task.id);
  assert.equal(done?.status, "failed");
  assert.equal(done?.exitCode, 3);
  assert.equal(done?.stdout.text, "");
  assert.equal(done?.stderr.text, "oops");
  await spawner.killAll();
});

test("kills the whole process tree, including a child that ignores SIGTERM", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store, { killGraceMs: 300 });
  // The child traps SIGTERM and keeps sleeping; only a group SIGKILL ends it.
  const task = spawner.start({
    command: "sh -c 'trap \"\" TERM; sleep 30' & sleep 30",
    cwd: process.cwd(),
  });
  const pid = store.get(task.id)?.pid;
  assert.ok(pid, "expected a pid");
  await spawner.kill(task.id);
  await settled(store, task.id);
  assert.equal(store.get(task.id)?.status, "killed");
  // The process group is gone: signalling it must throw ESRCH.
  assert.throws(() => process.kill(-pid, 0));
});

test("escalates to SIGKILL when the process refuses to die", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store, { killGraceMs: 300 });
  // Traps TERM and loops forever, so its sleeps dying changes nothing: only
  // SIGKILL can end this one. It announces itself once the trap is installed,
  // because a SIGTERM sent before that line runs would kill it outright and
  // never exercise the escalation path.
  const task = spawner.start({
    command: 'trap "" TERM; echo trapped; while :; do sleep 0.2; done',
    cwd: process.cwd(),
  });
  const pid = store.get(task.id)?.pid;
  assert.ok(pid, "expected a pid");
  await waitFor(store, () => store.get(task.id)!.stdout.text.includes("trapped"));

  const startedAt = Date.now();
  await spawner.kill(task.id);
  const elapsed = Date.now() - startedAt;

  assert.ok(
    elapsed >= 300,
    `expected the kill to wait out the grace period, took ${elapsed}ms`,
  );
  assert.equal(store.get(task.id)?.status, "killed");
  assert.throws(() => process.kill(-pid, 0));
});

test("a kill requested through the store reaches the spawner", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store, { killGraceMs: 300 });
  const task = spawner.start({ command: "sleep 30", cwd: process.cwd() });
  store.requestKill(task.id);
  await settled(store, task.id);
  assert.equal(store.get(task.id)?.status, "killed");
});

test("a failed spawn settles the task instead of throwing", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store, { shell: "/definitely/not/a/shell" });
  const task = spawner.start({ command: "true", cwd: process.cwd() });
  await settled(store, task.id);
  const done = store.get(task.id);
  assert.equal(done?.status, "failed");
  assert.match(done?.errorText ?? "", /ENOENT/);
});

test("rejects a non-existent working directory", () => {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  assert.throws(
    () => spawner.start({ command: "true", cwd: "/no/such/dir" }),
    /not a directory/,
  );
});

test("enforces the concurrency cap", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  for (let i = 0; i < MAX_BACKGROUND; i++) {
    spawner.start({ command: "sleep 30", cwd: process.cwd() });
  }
  assert.throws(
    () => spawner.start({ command: "sleep 30", cwd: process.cwd() }),
    /at most 8/,
  );
  await spawner.killAll();
});

test("killAll settles every running task", async () => {
  const store = createTaskStore();
  const spawner = createSpawner(store, { killGraceMs: 300 });
  const first = spawner.start({ command: "sleep 30", cwd: process.cwd() });
  const second = spawner.start({ command: "sleep 30", cwd: process.cwd() });
  await spawner.killAll();
  assert.equal(store.get(first.id)?.status, "killed");
  assert.equal(store.get(second.id)?.status, "killed");
});
