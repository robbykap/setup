# Pi `tasks` Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi extension that turns the terminal window into a task dashboard showing every shell command in the session — background processes the agent starts, the agent's own `bash` calls, and the user's `!` commands — with a two-stage overlay for browsing and inspecting their live output.

**Architecture:** A synchronous `TaskStore` read model sits at the center. Producers (`spawn.ts` for owned processes, `observe.ts` for mirrored Pi events) write into it; consumers (the widget and two overlay components) read and render from it. The UI never touches a process: pressing `x` calls `store.requestKill(id)` and the spawn layer reacts. Output lives in fixed-size ring buffers. All render logic is in pure functions so it can be tested without a TUI.

**Tech Stack:** TypeScript on Node 26 (native type stripping, no build step), `@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui` + `typebox` for the extension API, `node --test` for tests. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-pi-tasks-extension-design.md`

---

## File Structure

All paths relative to the repo root. `pi-agent/` mirrors `~/.pi/agent/`.

| File | Responsibility |
|---|---|
| `pi-agent/package.json` | Root deps for the whole agent dir (pi packages, typescript, @types/node) |
| `pi-agent/tsconfig.json` | Root TS config; `tsc --noEmit` type-checks every extension |
| `pi-agent/README.md` | How to install this dir as `~/.pi/agent` |
| `pi-agent/extensions/tasks/index.ts` | Wiring only: events, tools, `/tasks` command, `alt+t` shortcut, widget |
| `pi-agent/extensions/tasks/src/domain.ts` | `Task` type, status, filters, formatting helpers |
| `pi-agent/extensions/tasks/src/ring.ts` | Bounded byte buffer with dropped-byte accounting |
| `pi-agent/extensions/tasks/src/store.ts` | The task list: add/append/replace/settle, cap, subscriptions, kill requests |
| `pi-agent/extensions/tasks/src/spawn.ts` | Background process lifecycle: spawn, pipe, tree kill |
| `pi-agent/extensions/tasks/src/observe.ts` | Pi tool events and `user_bash` into foreground tasks |
| `pi-agent/extensions/tasks/src/prompt.ts` | Tool descriptions and model-facing result text |
| `pi-agent/extensions/tasks/src/ui/output-lines.ts` | ANSI/control sanitizing and width-aware line splitting |
| `pi-agent/extensions/tasks/src/ui/dashboard.ts` | Stage 1: list overlay (pure render + Component) |
| `pi-agent/extensions/tasks/src/ui/detail.ts` | Stage 2: inspector overlay (pure render + Component) |
| `pi-agent/extensions/tasks/*.test.ts` | One test file per src module |

`src/ui/output-lines.ts` is an addition to the spec's file table: sanitizing and line splitting are needed by both UI files, and duplicating them would violate DRY.

---

## Task 1: Scaffold the agent directory

**Files:**
- Create: `pi-agent/package.json`
- Create: `pi-agent/tsconfig.json`
- Create: `pi-agent/.gitignore`
- Create: `pi-agent/README.md`

- [ ] **Step 1: Create `pi-agent/package.json`**

```json
{
  "name": "pi-agent",
  "private": true,
  "type": "module",
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.2",
    "@earendil-works/pi-tui": "^0.84.2",
    "typebox": "^1.3.6"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "typescript": "^5.9.0"
  },
  "scripts": {
    "check": "tsc --noEmit",
    "test": "node --test extensions/*/*.test.ts"
  }
}
```

- [ ] **Step 2: Create `pi-agent/tsconfig.json`**

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["extensions/**/*.ts"]
}
```

- [ ] **Step 3: Create `pi-agent/.gitignore`**

```gitignore
node_modules/
```

- [ ] **Step 4: Create `pi-agent/README.md`**

````markdown
# pi-agent

Contents of `~/.pi/agent`. Install by symlinking this directory:

```sh
ln -s "$(pwd)/pi-agent" ~/.pi/agent
cd ~/.pi/agent && npm install
```

If `~/.pi/agent` already exists, move it aside first.

## Extensions

- `extensions/tasks` — task dashboard for background processes and shell
  commands. Open with `/tasks` or `alt+t`.
````

- [ ] **Step 5: Install dependencies and verify the toolchain**

```bash
cd pi-agent && npm install && npx tsc --version && node --version
```

Expected: npm installs without errors, tsc prints `Version 5.9.x` or later, node prints `v26.x` (type stripping is on by default; if `node --test` later rejects `.ts` files, add `--experimental-strip-types` to the test script).

- [ ] **Step 6: Commit**

```bash
git add pi-agent/package.json pi-agent/tsconfig.json pi-agent/.gitignore pi-agent/README.md pi-agent/package-lock.json
git commit -m "chore: scaffold pi-agent directory"
```

---

## Task 2: Domain types and formatting

**Files:**
- Create: `pi-agent/extensions/tasks/src/domain.ts`
- Test: `pi-agent/extensions/tasks/domain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/domain.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/domain.test.ts`
Expected: FAIL — cannot find module `./src/domain.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/domain.ts`:

```typescript
/**
 * Shared vocabulary for the tasks extension.
 *
 * A Task is one shell command the session knows about. Three kinds exist:
 * - background: this extension spawned it, owns the pid, and can kill it.
 * - foreground: Pi's own bash tool ran it; mirrored from events, merged output.
 * - user: the user ran it with `!`; same shape as foreground.
 */

export type TaskKind = "background" | "foreground" | "user";
export type TaskStatus = "running" | "done" | "failed" | "killed";
export type FilterMode = "all" | "background" | "failed";
export type StreamName = "stdout" | "stderr";

/** A bounded window onto one output stream. Backed by a ring buffer, so the
 * object identity is stable while the fields change underneath. */
export interface OutputView {
  readonly text: string;
  readonly totalBytes: number;
  readonly droppedBytes: number;
}

export interface Task {
  id: string;
  kind: TaskKind;
  /** Short label for the list row. Whitespace-collapsed, <= 80 chars. */
  title: string;
  command: string;
  cwd: string;
  status: TaskStatus;
  pid?: number;
  exitCode?: number;
  signal?: string;
  errorText?: string;
  startedAt: number;
  endedAt?: number;
  stdout: OutputView;
  stderr: OutputView;
  /** True when stdout holds combined output and stderr is unused. */
  merged: boolean;
}

export const FILTER_MODES: readonly FilterMode[] = ["all", "background", "failed"];

export function nextFilter(mode: FilterMode): FilterMode {
  const index = FILTER_MODES.indexOf(mode);
  return FILTER_MODES[(index + 1) % FILTER_MODES.length];
}

export function filterTasks(
  tasks: readonly Task[],
  mode: FilterMode,
): readonly Task[] {
  switch (mode) {
    case "all":
      return tasks;
    case "background":
      return tasks.filter((task) => task.kind === "background");
    case "failed":
      return tasks.filter((task) => task.status === "failed");
  }
}

/** m:ss, frozen at the settle time so finished rows stop ticking. */
export function formatElapsed(task: Task, now: number): string {
  const end = task.endedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatExit(task: Task): string {
  if (task.status === "running") return "running";
  if (task.errorText) return task.errorText;
  if (task.signal) return task.signal;
  return `exit ${task.exitCode ?? "?"}`;
}

/** Foreground and user tasks belong to Pi's bash tool: killing them out from
 * under the tool would corrupt its result, so the UI must not offer it. */
export function isKillable(task: Task): boolean {
  return task.kind === "background" && task.status === "running";
}

/** Collapse whitespace and bound the length: a newline inside a fixed-height
 * row desyncs the TUI renderer. */
export function toTitle(text: string, fallback = "task"): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/domain.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/domain.ts pi-agent/extensions/tasks/domain.test.ts
git commit -m "feat(tasks): add domain types and formatting helpers"
```

---

## Task 3: Bounded output ring buffer

**Files:**
- Create: `pi-agent/extensions/tasks/src/ring.ts`
- Test: `pi-agent/extensions/tasks/ring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/ring.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRingBuffer } from "./src/ring.ts";

test("keeps everything while under the limit", () => {
  const ring = createRingBuffer(100);
  ring.append(Buffer.from("hello "));
  ring.append(Buffer.from("world"));
  assert.equal(ring.view.text, "hello world");
  assert.equal(ring.view.totalBytes, 11);
  assert.equal(ring.view.droppedBytes, 0);
});

test("keeps everything at exactly the limit", () => {
  const ring = createRingBuffer(5);
  ring.append(Buffer.from("abcde"));
  assert.equal(ring.view.text, "abcde");
  assert.equal(ring.view.droppedBytes, 0);
});

test("drops the oldest bytes past the limit", () => {
  const ring = createRingBuffer(5);
  ring.append(Buffer.from("abcde"));
  ring.append(Buffer.from("fgh"));
  assert.equal(ring.view.text, "defgh");
  assert.equal(ring.view.totalBytes, 8);
  assert.equal(ring.view.droppedBytes, 3);
});

test("a single oversized chunk keeps only its tail", () => {
  const ring = createRingBuffer(4);
  ring.append(Buffer.from("abcdefghij"));
  assert.equal(ring.view.text, "ghij");
  assert.equal(ring.view.droppedBytes, 6);
});

test("never leaves a partial UTF-8 sequence at the front", () => {
  // "é" is 2 bytes; cutting between them would decode as U+FFFD.
  const ring = createRingBuffer(3);
  ring.append(Buffer.from("éé"));
  assert.equal(ring.view.text, "é");
  assert.equal(ring.view.droppedBytes, 2);
  assert.ok(!ring.view.text.includes("\uFFFD"));
});

test("decodes multi-byte characters split across appends", () => {
  const ring = createRingBuffer(100);
  const bytes = Buffer.from("é");
  ring.append(bytes.subarray(0, 1));
  ring.append(bytes.subarray(1));
  assert.equal(ring.view.text, "é");
});

test("replace swaps the contents and resets accounting", () => {
  const ring = createRingBuffer(100);
  ring.append(Buffer.from("old"));
  ring.replace("brand new");
  assert.equal(ring.view.text, "brand new");
  assert.equal(ring.view.totalBytes, 9);
  assert.equal(ring.view.droppedBytes, 0);
});

test("replace past the limit keeps the tail and records the drop", () => {
  const ring = createRingBuffer(4);
  ring.replace("abcdefgh");
  assert.equal(ring.view.text, "efgh");
  assert.equal(ring.view.totalBytes, 8);
  assert.equal(ring.view.droppedBytes, 4);
});

test("the view object identity is stable across mutations", () => {
  const ring = createRingBuffer(100);
  const view = ring.view;
  ring.append(Buffer.from("x"));
  assert.equal(view.text, "x");
  assert.equal(view, ring.view);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/ring.test.ts`
Expected: FAIL — cannot find module `./src/ring.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/ring.ts`:

```typescript
/**
 * Fixed-size tail of a byte stream.
 *
 * Bytes, not characters: process output arrives as Buffers that can split a
 * multi-byte character across chunks, so decoding happens once over the whole
 * retained tail rather than per chunk. Decoding is cached because the UI reads
 * `text` on every repaint.
 */

import type { OutputView } from "./domain.ts";

export const DEFAULT_LIMIT_BYTES = 256 * 1024;

export interface RingBuffer {
  /** Stable view object; fields update in place as the buffer mutates. */
  readonly view: OutputView;
  /** Append raw stream bytes. */
  append(chunk: Buffer | string): void;
  /** Replace the whole contents (Pi's tool updates are cumulative snapshots). */
  replace(text: string): void;
}

export function createRingBuffer(
  limitBytes: number = DEFAULT_LIMIT_BYTES,
): RingBuffer {
  let bytes = Buffer.alloc(0);
  let totalBytes = 0;
  let droppedBytes = 0;
  let decoded: string | undefined;

  const view: OutputView = {
    get text() {
      return (decoded ??= bytes.toString("utf8"));
    },
    get totalBytes() {
      return totalBytes;
    },
    get droppedBytes() {
      return droppedBytes;
    },
  };

  /** Trim from the front, then skip forward past any UTF-8 continuation bytes
   * so the retained tail always starts on a character boundary. */
  const trim = () => {
    if (bytes.length <= limitBytes) return;
    let start = bytes.length - limitBytes;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    droppedBytes += start;
    bytes = bytes.subarray(start);
  };

  return {
    view,
    append(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      if (buf.length === 0) return;
      totalBytes += buf.length;
      bytes = Buffer.concat([bytes, buf]);
      trim();
      decoded = undefined;
    },
    replace(text) {
      bytes = Buffer.from(text, "utf8");
      totalBytes = bytes.length;
      droppedBytes = 0;
      trim();
      decoded = undefined;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/ring.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/ring.ts pi-agent/extensions/tasks/ring.test.ts
git commit -m "feat(tasks): add bounded output ring buffer"
```

---

## Task 4: The task store

**Files:**
- Create: `pi-agent/extensions/tasks/src/store.ts`
- Test: `pi-agent/extensions/tasks/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/store.test.ts`
Expected: FAIL — cannot find module `./src/store.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/store.ts`:

```typescript
/**
 * The task list. Synchronous read model: producers (spawn, observe) write,
 * consumers (widget, overlays) read and subscribe. Nothing here knows about
 * processes or the TUI, which is what makes both sides testable in isolation.
 */

import {
  isKillable,
  toTitle,
  type StreamName,
  type Task,
  type TaskKind,
  type TaskStatus,
} from "./domain.ts";
import { createRingBuffer, type RingBuffer } from "./ring.ts";

/** Newest-first list cap. Running tasks are never evicted. */
export const MAX_TASKS = 50;

export interface NewTask {
  kind: TaskKind;
  command: string;
  cwd: string;
  title?: string;
  pid?: number;
}

export interface SettlePatch {
  status: Exclude<TaskStatus, "running">;
  exitCode?: number;
  signal?: string;
  errorText?: string;
}

export interface TaskStore {
  /** Newest first. */
  list(): readonly Task[];
  get(id: string): Task | undefined;
  size(): number;
  /** How many tasks the cap has evicted this session. */
  droppedCount(): number;
  runningBackgroundCount(): number;
  add(task: NewTask): Task;
  setPid(id: string, pid: number): void;
  appendOutput(id: string, stream: StreamName, chunk: Buffer | string): void;
  replaceOutput(id: string, text: string): void;
  settle(id: string, patch: SettlePatch): void;
  subscribe(listener: () => void): () => void;
  onSettled(listener: (task: Task) => void): () => void;
  onKillRequest(listener: (id: string) => void): () => void;
  requestKill(id: string): void;
  clear(): void;
}

interface Entry {
  task: Task;
  stdout: RingBuffer;
  stderr: RingBuffer;
}

const ID_PREFIX: Record<TaskKind, string> = {
  background: "b",
  foreground: "f",
  user: "u",
};

export function createTaskStore(
  options: { now?: () => number; limitBytes?: number } = {},
): TaskStore {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const order: string[] = []; // oldest first
  const counters: Record<TaskKind, number> = {
    background: 0,
    foreground: 0,
    user: 0,
  };
  const listeners = new Set<() => void>();
  const settledListeners = new Set<(task: Task) => void>();
  const killListeners = new Set<(id: string) => void>();
  let dropped = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Evict oldest settled entries until back under the cap. A list full of
   * running tasks simply grows: hiding live work would defeat the point. */
  const enforceCap = () => {
    while (order.length > MAX_TASKS) {
      const index = order.findIndex(
        (id) => entries.get(id)?.task.status !== "running",
      );
      if (index === -1) return;
      const [id] = order.splice(index, 1);
      entries.delete(id);
      dropped++;
    }
  };

  return {
    list() {
      const tasks: Task[] = [];
      for (let i = order.length - 1; i >= 0; i--) {
        const entry = entries.get(order[i]);
        if (entry) tasks.push(entry.task);
      }
      return tasks;
    },
    get(id) {
      return entries.get(id)?.task;
    },
    size() {
      return entries.size;
    },
    droppedCount() {
      return dropped;
    },
    runningBackgroundCount() {
      let count = 0;
      for (const entry of entries.values()) {
        if (entry.task.kind === "background" && entry.task.status === "running") {
          count++;
        }
      }
      return count;
    },
    add(input) {
      const id = `${ID_PREFIX[input.kind]}${++counters[input.kind]}`;
      const stdout = createRingBuffer(options.limitBytes);
      const stderr = createRingBuffer(options.limitBytes);
      const task: Task = {
        id,
        kind: input.kind,
        title: toTitle(input.title ?? input.command),
        command: input.command,
        cwd: input.cwd,
        status: "running",
        pid: input.pid,
        startedAt: now(),
        merged: input.kind !== "background",
        stdout: stdout.view,
        stderr: stderr.view,
      };
      entries.set(id, { task, stdout, stderr });
      order.push(id);
      enforceCap();
      notify();
      return task;
    },
    setPid(id, pid) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.task.pid = pid;
      notify();
    },
    appendOutput(id, stream, chunk) {
      const entry = entries.get(id);
      if (!entry) return;
      const target = stream === "stderr" && !entry.task.merged ? entry.stderr : entry.stdout;
      target.append(chunk);
      notify();
    },
    replaceOutput(id, text) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stdout.replace(text);
      notify();
    },
    settle(id, patch) {
      const entry = entries.get(id);
      if (!entry || entry.task.status !== "running") return;
      Object.assign(entry.task, patch, { endedAt: now() });
      enforceCap();
      for (const listener of settledListeners) listener(entry.task);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSettled(listener) {
      settledListeners.add(listener);
      return () => settledListeners.delete(listener);
    },
    onKillRequest(listener) {
      killListeners.add(listener);
      return () => killListeners.delete(listener);
    },
    requestKill(id) {
      const task = entries.get(id)?.task;
      if (!task || !isKillable(task)) return;
      for (const listener of killListeners) listener(id);
    },
    clear() {
      entries.clear();
      order.length = 0;
      notify();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/store.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/store.ts pi-agent/extensions/tasks/store.test.ts
git commit -m "feat(tasks): add the task store"
```

---

## Task 5: Background process spawning and tree kill

**Files:**
- Create: `pi-agent/extensions/tasks/src/spawn.ts`
- Test: `pi-agent/extensions/tasks/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/spawn.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskStore } from "./src/store.ts";
import { createSpawner, MAX_BACKGROUND } from "./src/spawn.ts";

/** Resolve once the given task leaves the running state. */
function settled(store: ReturnType<typeof createTaskStore>, id: string) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (store.get(id)?.status !== "running") {
        unsubscribe();
        resolve();
      }
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/spawn.test.ts`
Expected: FAIL — cannot find module `./src/spawn.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/spawn.ts`:

```typescript
/**
 * Background process lifecycle.
 *
 * Each task runs in its own process group (detached) so a kill reaches the
 * whole tree, not just the shell. stdin is ignored at the OS level: these
 * tasks are read-only by design, and a process blocking on a tty read that
 * never comes would hang forever.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import type { Task } from "./domain.ts";
import type { TaskStore } from "./store.ts";

export const MAX_BACKGROUND = 8;
const DEFAULT_KILL_GRACE_MS = 3_000;

export interface StartOptions {
  command: string;
  cwd: string;
  title?: string;
}

export interface Spawner {
  start(options: StartOptions): Task;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
}

interface Running {
  child: ChildProcess;
  exited: Promise<void>;
  killing?: Promise<void>;
}

export function createSpawner(
  store: TaskStore,
  options: { shell?: string; killGraceMs?: number } = {},
): Spawner {
  const shell = options.shell ?? "/bin/sh";
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const running = new Map<string, Running>();

  /** Signal the whole group; ESRCH just means it is already gone. */
  const signalGroup = (pid: number, signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already reaped.
      }
    }
  };

  const kill = async (id: string) => {
    const entry = running.get(id);
    if (!entry) return;
    if (entry.killing) return entry.killing;

    entry.killing = (async () => {
      const pid = entry.child.pid;
      if (pid !== undefined) {
        signalGroup(pid, "SIGTERM");
        const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), killGraceMs);
        // Bounded either way: SIGKILL cannot be trapped, so this resolves.
        await entry.exited;
        clearTimeout(timer);
      }
      const task = store.get(id);
      if (task?.status === "running") store.settle(id, { status: "killed" });
    })();

    return entry.killing;
  };

  store.onKillRequest((id) => {
    void kill(id);
  });

  return {
    start({ command, cwd, title }) {
      if (running.size >= MAX_BACKGROUND) {
        throw new Error(
          `Too many background tasks: at most ${MAX_BACKGROUND} may run at once. Kill one first.`,
        );
      }
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working directory is not a directory: ${cwd}`);
      }

      const task = store.add({ kind: "background", command, cwd, title });

      const child = spawn(shell, ["-c", command], {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let resolveExited!: () => void;
      const exited = new Promise<void>((resolve) => {
        resolveExited = resolve;
      });
      running.set(task.id, { child, exited });

      if (child.pid !== undefined) store.setPid(task.id, child.pid);
      child.stdout?.on("data", (chunk: Buffer) =>
        store.appendOutput(task.id, "stdout", chunk),
      );
      child.stderr?.on("data", (chunk: Buffer) =>
        store.appendOutput(task.id, "stderr", chunk),
      );

      child.on("error", (error: Error) => {
        running.delete(task.id);
        resolveExited();
        store.settle(task.id, { status: "failed", errorText: error.message });
      });

      child.on("close", (code, signal) => {
        running.delete(task.id);
        resolveExited();
        if (signal) {
          store.settle(task.id, { status: "killed", signal });
          return;
        }
        store.settle(task.id, {
          status: code === 0 ? "done" : "failed",
          exitCode: code ?? undefined,
        });
      });

      return task;
    },
    kill,
    async killAll() {
      await Promise.all([...running.keys()].map((id) => kill(id)));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/spawn.test.ts`
Expected: PASS, 8 tests. These spawn real processes; the run takes a few seconds.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/spawn.ts pi-agent/extensions/tasks/spawn.test.ts
git commit -m "feat(tasks): add background process spawning and tree kill"
```

---

## Task 6: Mirroring Pi's own shell commands

**Files:**
- Create: `pi-agent/extensions/tasks/src/observe.ts`
- Test: `pi-agent/extensions/tasks/observe.test.ts`

Background: Pi's `bash` tool emits `tool_execution_update` with the **full
accumulated output** each time (throttled), so the buffer is replaced, not
appended. `user_bash` fires once before execution and lets an extension supply
the `BashOperations` used to run the command, which is how user `!` commands get
their output captured.

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/observe.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/observe.test.ts`
Expected: FAIL — cannot find module `./src/observe.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/observe.ts`:

```typescript
/**
 * Mirrors shell work that Pi runs itself into the task store.
 *
 * Two sources:
 * - The agent's `bash` tool, observed through tool_execution_* events. Updates
 *   carry the full accumulated output, so they replace the buffer; appending
 *   would duplicate everything seen so far.
 * - The user's `!command`, captured by wrapping the BashOperations Pi uses to
 *   execute it. There is no "user bash finished" event, so the wrapper is the
 *   only place the outcome is observable.
 *
 * Neither kind is killable here: Pi owns those processes.
 */

import type { TaskStore } from "./store.ts";

export interface ToolStartLike {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolUpdateLike {
  toolCallId: string;
  partialResult: unknown;
}

export interface ToolEndLike {
  toolCallId: string;
  result: unknown;
  isError: boolean;
}

/** Structural subset of Pi's BashOperations. */
export interface BashOperationsLike {
  exec(
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ): Promise<{ exitCode: number | null }>;
}

export interface Observer {
  toolStart(event: ToolStartLike, cwd: string): void;
  toolUpdate(event: ToolUpdateLike): void;
  toolEnd(event: ToolEndLike): void;
  userBash(
    event: { command: string; cwd: string },
    operations: BashOperationsLike,
  ): BashOperationsLike;
  reset(): void;
}

/** Pull the text out of a tool result shaped { content: [{ type, text }] }. */
function resultText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function commandOf(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

export function createObserver(store: TaskStore): Observer {
  /** Pi's toolCallId to our task id. Entries are removed on settle so a
   * duplicate or late end event cannot touch a finished task. */
  const active = new Map<string, string>();

  return {
    toolStart(event, cwd) {
      if (event.toolName !== "bash") return;
      const command = commandOf(event.args);
      if (!command) return;
      const task = store.add({ kind: "foreground", command, cwd });
      active.set(event.toolCallId, task.id);
    },
    toolUpdate(event) {
      const id = active.get(event.toolCallId);
      if (!id) return;
      const text = resultText(event.partialResult);
      if (text !== undefined) store.replaceOutput(id, text);
    },
    toolEnd(event) {
      const id = active.get(event.toolCallId);
      if (!id) return;
      active.delete(event.toolCallId);
      const text = resultText(event.result);
      if (text !== undefined) store.replaceOutput(id, text);
      store.settle(id, {
        status: event.isError ? "failed" : "done",
        exitCode: event.isError ? undefined : 0,
      });
    },
    userBash(event, operations) {
      const task = store.add({
        kind: "user",
        command: event.command,
        cwd: event.cwd,
      });
      return {
        async exec(command, cwd, options) {
          try {
            const result = await operations.exec(command, cwd, {
              ...options,
              onData: (data) => {
                store.appendOutput(task.id, "stdout", data);
                options.onData(data);
              },
            });
            store.settle(task.id, {
              status: result.exitCode === 0 ? "done" : "failed",
              exitCode: result.exitCode ?? undefined,
            });
            return result;
          } catch (error) {
            store.settle(task.id, {
              status: "failed",
              errorText: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      };
    },
    reset() {
      active.clear();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/observe.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/observe.ts pi-agent/extensions/tasks/observe.test.ts
git commit -m "feat(tasks): mirror pi bash calls and user bash into the store"
```

---

## Task 7: Output sanitizing and line splitting

**Files:**
- Create: `pi-agent/extensions/tasks/src/ui/output-lines.ts`
- Test: `pi-agent/extensions/tasks/output-lines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/output-lines.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLineCache,
  oneLine,
  sanitizeText,
  toLines,
} from "./src/ui/output-lines.ts";

test("sanitizeText strips ANSI escapes and carriage returns", () => {
  assert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
  assert.equal(sanitizeText("a\rb"), "ab");
  assert.equal(sanitizeText("keep\ttabs and\nnewlines"), "keep    tabs and\nnewlines");
});

test("sanitizeText drops other control characters", () => {
  assert.equal(sanitizeText("bel\u0007end"), "belend");
});

test("oneLine collapses everything onto a single row", () => {
  assert.equal(oneLine("two\nlines  here"), "two lines here");
});

test("toLines splits on newlines and wraps at the width", () => {
  assert.deepEqual(toLines("abcdef\ngh", 3), ["abc", "def", "gh"]);
});

test("toLines preserves empty lines", () => {
  assert.deepEqual(toLines("a\n\nb", 10), ["a", "", "b"]);
});

test("toLines of empty text is empty", () => {
  assert.deepEqual(toLines("", 10), []);
});

test("the line cache recomputes only when text or width changes", () => {
  const cache = createLineCache();
  const first = cache.get("a\nb", 10);
  assert.equal(cache.get("a\nb", 10), first, "same inputs reuse the array");
  assert.notEqual(cache.get("a\nb", 4), first, "a new width recomputes");
  assert.deepEqual(cache.get("a\nc", 10), ["a", "c"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/output-lines.test.ts`
Expected: FAIL — cannot find module `./src/ui/output-lines.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/ui/output-lines.ts`:

```typescript
/**
 * Turning raw process output into renderable rows.
 *
 * Process output contains ANSI colour, cursor movement and carriage returns.
 * Inside a fixed-height overlay those sequences smear the screen, so
 * everything is stripped down to plain text before it is displayed.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function sanitizeText(text: string): string {
  return text
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    // A lone carriage return means "redraw this line" (progress bars). There
    // is nothing to redraw in a scrollback view, so drop it.
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .replace(CONTROL, "");
}

/** Safe rendering of arbitrary text inside a single row. */
export function oneLine(text: string): string {
  return sanitizeText(text).replace(/\s+/g, " ").trim();
}

/** Sanitize, split on newlines, and hard-wrap at the given width. */
export function toLines(text: string, width: number): string[] {
  const clean = sanitizeText(text);
  if (clean === "") return [];
  const columns = Math.max(1, width);
  const out: string[] = [];
  for (const line of clean.split("\n")) {
    if (line.length <= columns) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += columns) {
      out.push(line.slice(i, i + columns));
    }
  }
  return out;
}

export interface LineCache {
  get(text: string, width: number): string[];
}

/** Wrapping runs on every repaint of a live task; memoize the last result so a
 * chatty process does not re-split its whole tail dozens of times a second. */
export function createLineCache(): LineCache {
  let cachedText: string | undefined;
  let cachedWidth = -1;
  let cachedLines: string[] = [];
  return {
    get(text, width) {
      if (text === cachedText && width === cachedWidth) return cachedLines;
      cachedText = text;
      cachedWidth = width;
      cachedLines = toLines(text, width);
      return cachedLines;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/output-lines.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/ui/output-lines.ts pi-agent/extensions/tasks/output-lines.test.ts
git commit -m "feat(tasks): add output sanitizing and line splitting"
```

---

## Task 8: Dashboard overlay (stage 1)

**Files:**
- Create: `pi-agent/extensions/tasks/src/ui/dashboard.ts`
- Test: `pi-agent/extensions/tasks/dashboard.test.ts`

The Component class is a thin shell around two pure functions —
`reconcileSelection` and `renderDashboardLines` — which are what the tests
exercise. `TaskDashboard` itself only wires TUI callbacks to them.

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/dashboard.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
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
      assert.ok(line.length <= width, `line of ${line.length} exceeds ${width}`);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/dashboard.test.ts`
Expected: FAIL — cannot find module `./src/ui/dashboard.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/ui/dashboard.ts`:

```typescript
/**
 * Stage 1 of the tasks UI: the list.
 *
 * State and rendering are pure functions over a task array so they can be
 * tested without a terminal; TaskDashboard is only the TUI shell that feeds
 * them keyboard input and a store subscription.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  filterTasks,
  formatElapsed,
  formatExit,
  isKillable,
  nextFilter,
  type FilterMode,
  type Task,
} from "../domain.ts";
import type { TaskStore } from "../store.ts";
import { oneLine } from "./output-lines.ts";

/** Minimal shape of Pi's Theme, so tests can pass a plain object. */
export interface ThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface DashboardState {
  index: number;
  id?: string;
  filter: FilterMode;
}

export function newDashboardState(): DashboardState {
  return { index: 0, filter: "all" };
}

export type DashboardKey = "up" | "down" | "confirm" | "cancel" | "kill" | "filter";

export type DashboardAction =
  | { type: "render" }
  | { type: "close" }
  | { type: "inspect"; id: string }
  | { type: "kill"; id: string }
  | { type: "notify"; message: string }
  | { type: "ignore" };

/** Keep the cursor on the same task as the list changes underneath it. */
export function reconcileSelection(
  state: DashboardState,
  tasks: readonly Task[],
): void {
  const byId = state.id ? tasks.findIndex((task) => task.id === state.id) : -1;
  state.index =
    byId >= 0
      ? byId
      : Math.min(Math.max(0, state.index), Math.max(0, tasks.length - 1));
  state.id = tasks[state.index]?.id;
}

export function handleDashboardKey(
  key: DashboardKey,
  state: DashboardState,
  allTasks: readonly Task[],
): DashboardAction {
  const tasks = filterTasks(allTasks, state.filter);
  reconcileSelection(state, tasks);
  const selected = tasks[state.index];

  switch (key) {
    case "cancel":
      return { type: "close" };
    case "up":
    case "down": {
      if (tasks.length === 0) return { type: "ignore" };
      const delta = key === "up" ? -1 : 1;
      state.index = (state.index + delta + tasks.length) % tasks.length;
      state.id = tasks[state.index]?.id;
      return { type: "render" };
    }
    case "filter":
      state.filter = nextFilter(state.filter);
      reconcileSelection(state, filterTasks(allTasks, state.filter));
      return { type: "render" };
    case "confirm":
      return selected ? { type: "inspect", id: selected.id } : { type: "ignore" };
    case "kill":
      if (!selected) return { type: "ignore" };
      if (!isKillable(selected)) {
        return {
          type: "notify",
          message:
            selected.status !== "running"
              ? "That task already finished."
              : "Pi owns that command; only background tasks can be killed here.",
        };
      }
      return { type: "kill", id: selected.id };
  }
}

function statusGlyph(task: Task, theme: ThemeLike) {
  switch (task.status) {
    case "running":
      return theme.fg("warning", "■");
    case "done":
      return theme.fg("success", "■");
    case "failed":
      return theme.fg("error", "■");
    case "killed":
      return theme.fg("muted", "■");
  }
}

function kindGlyph(task: Task, theme: ThemeLike) {
  switch (task.kind) {
    case "background":
      return theme.fg("accent", "&");
    case "foreground":
      return theme.fg("dim", "$");
    case "user":
      return theme.fg("dim", "!");
  }
}

function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export interface RenderOptions {
  width: number;
  height: number;
  theme: ThemeLike;
  now: number;
}

export function renderDashboardLines(
  allTasks: readonly Task[],
  state: DashboardState,
  { width, height, theme, now }: RenderOptions,
): string[] {
  const tasks = filterTasks(allTasks, state.filter);
  reconcileSelection(state, tasks);

  const running = allTasks.filter((task) => task.status === "running").length;
  const lines: string[] = [];

  const left = theme.fg("accent", theme.bold("Tasks"));
  const right = theme.fg(
    "muted",
    `${running} running · ${tasks.length} shown · filter: ${state.filter}`,
  );
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 2);
  lines.push(truncateToWidth(` ${left}${" ".repeat(gap)}${right} `, width));
  lines.push(theme.fg("border", "─".repeat(width)));

  // Two header rows and two footer rows are added around the body, so the
  // rendered block is exactly `height` rows tall.
  const bodyHeight = Math.max(3, height - 4);
  for (const row of renderRows(tasks, state, { width, height: bodyHeight, theme, now })) {
    lines.push(pad(row, width));
  }

  lines.push(theme.fg("border", "─".repeat(width)));
  lines.push(
    truncateToWidth(
      theme.fg(
        "dim",
        " j/k select · enter inspect · x kill · f filter · esc close",
      ),
      width,
    ),
  );
  return lines;
}

function renderRows(
  tasks: readonly Task[],
  state: DashboardState,
  { width, height, theme, now }: RenderOptions,
): string[] {
  if (tasks.length === 0) {
    const rows = [theme.fg("dim", "  No tasks match this filter (f to change)")];
    while (rows.length < height) rows.push("");
    return rows;
  }

  let start = 0;
  if (tasks.length > height) {
    start = Math.min(
      Math.max(0, state.index - Math.floor(height / 2)),
      tasks.length - height,
    );
  }
  const visible = tasks.slice(start, start + height);
  const rows: string[] = [];

  for (let i = 0; i < visible.length; i++) {
    const task = visible[i];
    const selected = start + i === state.index;
    const marker = selected ? theme.fg("accent", "❯") : " ";
    const title = selected
      ? theme.fg("accent", oneLine(task.title))
      : theme.fg("text", oneLine(task.title));
    const left = ` ${marker} ${statusGlyph(task, theme)} ${kindGlyph(task, theme)} ${title} ${theme.fg("dim", task.id)}`;

    const dot = theme.fg("dim", " · ");
    const right =
      [
        theme.fg("muted", task.pid ? `pid ${task.pid}` : "no pid"),
        theme.fg("muted", formatElapsed(task, now)),
        task.status === "running"
          ? theme.fg("warning", "running")
          : theme.fg("muted", formatExit(task)),
      ].join(dot) + " ";

    const rightWidth = visibleWidth(right);
    const leftText = truncateToWidth(left, Math.max(0, width - rightWidth - 2));
    const spacer = Math.max(2, width - visibleWidth(leftText) - rightWidth);
    rows.push(truncateToWidth(leftText + " ".repeat(spacer) + right, width));
  }

  if (start > 0) {
    rows[0] = truncateToWidth(theme.fg("dim", `   ... ${start} more above`), width);
  }
  if (start + height < tasks.length) {
    rows[rows.length - 1] = truncateToWidth(
      theme.fg("dim", `   ... ${tasks.length - start - height} more below`),
      width,
    );
  }
  while (rows.length < height) rows.push("");
  return rows;
}

/** Result of the dashboard overlay: the task to inspect, or null to close. */
export type DashboardResult = string | null;

export class TaskDashboard implements Component {
  private ticker: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private closed = false;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private store: TaskStore,
    private state: DashboardState,
    private notify: (message: string) => void,
    private done: (result: DashboardResult) => void,
  ) {
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private toKey(data: string): DashboardKey | undefined {
    if (this.keybindings.matches(data, "tui.select.cancel")) return "cancel";
    if (this.keybindings.matches(data, "tui.select.confirm")) return "confirm";
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") return "up";
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") return "down";
    if (data === "x") return "kill";
    if (data === "f") return "filter";
    return undefined;
  }

  handleInput(data: string): void {
    const key = this.toKey(data);
    if (!key) return;
    const action = handleDashboardKey(key, this.state, this.store.list());
    switch (action.type) {
      case "close":
        this.close(null);
        return;
      case "inspect":
        this.close(action.id);
        return;
      case "kill":
        this.store.requestKill(action.id);
        return;
      case "notify":
        this.notify(action.message);
        return;
      case "render":
        this.tui.requestRender();
        return;
      case "ignore":
        return;
    }
  }

  render(width: number): string[] {
    const rows = this.tui.terminal.rows || 30;
    return renderDashboardLines(this.store.list(), this.state, {
      width,
      // Leave Pi's own footer row visible beneath the overlay.
      height: Math.max(8, rows - 4),
      theme: this.theme,
      now: Date.now(),
    });
  }

  private close(result: DashboardResult) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubscribe();
    this.done(result);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubscribe();
  }

  invalidate(): void {}
}

/** Open the dashboard overlay and resolve with the task to inspect. */
export function openDashboard(
  ctx: ExtensionCommandContext,
  store: TaskStore,
  state: DashboardState,
): Promise<DashboardResult> {
  return ctx.ui.custom<DashboardResult>(
    (tui, theme, keybindings, done) =>
      new TaskDashboard(
        tui,
        theme,
        keybindings,
        store,
        state,
        (message) => ctx.ui.notify(message, "info"),
        done,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/dashboard.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Type-check**

Run: `cd pi-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pi-agent/extensions/tasks/src/ui/dashboard.ts pi-agent/extensions/tasks/dashboard.test.ts
git commit -m "feat(tasks): add the dashboard overlay"
```

---

## Task 9: Detail overlay (stage 2)

**Files:**
- Create: `pi-agent/extensions/tasks/src/ui/detail.ts`
- Test: `pi-agent/extensions/tasks/detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/detail.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
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
      assert.ok(line.length <= width, `line of ${line.length} exceeds ${width}`);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/detail.test.ts`
Expected: FAIL — cannot find module `./src/ui/detail.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/ui/detail.ts`:

```typescript
/**
 * Stage 2 of the tasks UI: the read-only inspector.
 *
 * Fixed height: notes and scroll indicators consume rows inside the viewport so
 * streaming output never changes the overlay's size. Pinned to the bottom
 * (offset 0) until the user scrolls.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  formatElapsed,
  formatExit,
  isKillable,
  type StreamName,
  type Task,
} from "../domain.ts";
import type { TaskStore } from "../store.ts";
import { createLineCache, oneLine, type LineCache } from "./output-lines.ts";
import type { ThemeLike } from "./dashboard.ts";

const SCROLL_STEP = 6;
/** Repaint ceiling for streaming output, so a chatty process cannot starve input. */
const RENDER_THROTTLE_MS = 50;

export interface DetailState {
  stream: StreamName;
  /** Lines from the bottom. 0 pins to the newest output. */
  scrollOffset: number;
}

export function newDetailState(): DetailState {
  return { stream: "stdout", scrollOffset: 0 };
}

export type DetailKey =
  | "up"
  | "down"
  | "pageUp"
  | "pageDown"
  | "top"
  | "bottom"
  | "toggle"
  | "kill"
  | "send"
  | "yank"
  | "cancel";

export type DetailAction =
  | { type: "render" }
  | { type: "close" }
  | { type: "kill"; id: string }
  | { type: "send"; id: string }
  | { type: "yank"; id: string }
  | { type: "notify"; message: string }
  | { type: "ignore" };

export function handleDetailKey(
  key: DetailKey,
  state: DetailState,
  task: Task,
  viewportHeight: number,
): DetailAction {
  switch (key) {
    case "cancel":
      return { type: "close" };
    case "up":
      state.scrollOffset += SCROLL_STEP;
      return { type: "render" };
    case "down":
      state.scrollOffset = Math.max(0, state.scrollOffset - SCROLL_STEP);
      return { type: "render" };
    case "pageUp":
      state.scrollOffset += viewportHeight;
      return { type: "render" };
    case "pageDown":
      state.scrollOffset = Math.max(0, state.scrollOffset - viewportHeight);
      return { type: "render" };
    case "top":
      // Clamped against the real line count during render.
      state.scrollOffset = Number.MAX_SAFE_INTEGER;
      return { type: "render" };
    case "bottom":
      state.scrollOffset = 0;
      return { type: "render" };
    case "toggle":
      if (task.merged) {
        return {
          type: "notify",
          message: "This task has a single merged output stream.",
        };
      }
      state.stream = state.stream === "stdout" ? "stderr" : "stdout";
      state.scrollOffset = 0;
      return { type: "render" };
    case "kill":
      if (!isKillable(task)) {
        return {
          type: "notify",
          message:
            task.status !== "running"
              ? "That task already finished."
              : "Pi owns that command; only background tasks can be killed here.",
        };
      }
      return { type: "kill", id: task.id };
    case "send":
      return { type: "send", id: task.id };
    case "yank":
      return { type: "yank", id: task.id };
  }
}

export interface DetailRenderOptions {
  width: number;
  height: number;
  theme: ThemeLike;
  now: number;
  lineCache?: LineCache;
}

export function renderDetailLines(
  task: Task,
  state: DetailState,
  { width, height, theme, now, lineCache }: DetailRenderOptions,
): string[] {
  const border = theme.fg("border", "─".repeat(Math.max(1, width)));
  const lines: string[] = [];
  const stream = task.merged ? task.stdout : task[state.stream];

  lines.push(border);
  lines.push(
    truncateToWidth(
      theme.fg("accent", theme.bold(`${task.id} · ${oneLine(task.title)}`)) +
        theme.fg(
          "muted",
          ` · ${task.status} · ${formatElapsed(task, now)} · pid ${task.pid ?? "?"}` +
            (task.status === "running" ? "" : ` · ${formatExit(task)}`),
        ),
      width,
    ),
  );
  lines.push(
    truncateToWidth(theme.fg("dim", "$ ") + theme.fg("text", oneLine(task.command)), width),
  );
  lines.push(truncateToWidth(theme.fg("dim", task.cwd), width));

  if (!task.merged) {
    const tab = (name: StreamName, bytes: number) =>
      name === state.stream
        ? theme.fg("accent", theme.bold(`${name} (${formatSize(bytes)})`))
        : theme.fg("dim", `${name} (${formatSize(bytes)})`);
    lines.push(
      truncateToWidth(
        ` ${tab("stdout", task.stdout.totalBytes)}${theme.fg("dim", " | ")}${tab("stderr", task.stderr.totalBytes)}${theme.fg("dim", "  — t to switch")}`,
        width,
      ),
    );
  }
  lines.push(border);

  const chrome = lines.length + 2; // borders and header rows already pushed, plus footer rows
  const viewport = Math.max(3, height - chrome);
  const body: string[] = [];

  if (task.errorText) {
    body.push(truncateToWidth(theme.fg("error", `error: ${oneLine(task.errorText)}`), width));
  }
  if (stream.droppedBytes > 0) {
    body.push(
      truncateToWidth(
        theme.fg("dim", `first ${formatSize(stream.droppedBytes)} dropped from view`),
        width,
      ),
    );
  }

  const cache = lineCache ?? createLineCache();
  const output = cache.get(stream.text, Math.max(1, width - 2));
  const scrollRows = state.scrollOffset > 0 ? 1 : 0;
  const capacity = Math.max(1, viewport - body.length - scrollRows);
  const maxOffset = Math.max(0, output.length - capacity);
  if (state.scrollOffset > maxOffset) state.scrollOffset = maxOffset;

  const end = output.length - state.scrollOffset;
  const visible = output.slice(Math.max(0, end - capacity), end);
  if (visible.length === 0) {
    body.push(
      theme.fg("dim", `(no ${task.merged ? "output" : state.stream} yet)`),
    );
  } else {
    for (const line of visible) body.push(truncateToWidth(`  ${line}`, width));
  }

  if (state.scrollOffset > 0) {
    body.push(
      truncateToWidth(
        theme.fg("dim", `... ${state.scrollOffset} lines below · ↓/pgdn`),
        width,
      ),
    );
  }
  while (body.length < viewport) body.push("");
  lines.push(...body.slice(0, viewport));

  lines.push(border);
  lines.push(
    truncateToWidth(
      theme.fg(
        "dim",
        " esc back · j/k scroll · g/G top/bottom · t stream · x kill · s send to agent · y yank",
      ),
      width,
    ),
  );
  return lines;
}

export class TaskDetail implements Component {
  private state = newDetailState();
  private lineCache = createLineCache();
  private ticker: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private id: string,
    private store: TaskStore,
    private actions: {
      notify: (message: string) => void;
      send: (task: Task) => void;
      yank: (task: Task) => void;
    },
    private done: (result: null) => void,
  ) {
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubscribe = store.subscribe(() => this.scheduleRender());
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, RENDER_THROTTLE_MS);
  }

  private viewportHeight(): number {
    return Math.max(3, (this.tui.terminal.rows || 30) - 12);
  }

  private toKey(data: string): DetailKey | undefined {
    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      this.keybindings.matches(data, "app.interrupt")
    ) {
      return "cancel";
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") return "up";
    if (this.keybindings.matches(data, "tui.editor.cursorDown") || data === "j") return "down";
    if (this.keybindings.matches(data, "tui.editor.pageUp")) return "pageUp";
    if (this.keybindings.matches(data, "tui.editor.pageDown")) return "pageDown";
    if (data === "g") return "top";
    if (data === "G") return "bottom";
    if (data === "t") return "toggle";
    if (data === "x") return "kill";
    if (data === "s") return "send";
    if (data === "y") return "yank";
    return undefined;
  }

  handleInput(data: string): void {
    const task = this.store.get(this.id);
    const key = this.toKey(data);
    if (!key || !task) {
      if (key === "cancel") this.close();
      return;
    }
    const action = handleDetailKey(key, this.state, task, this.viewportHeight());
    switch (action.type) {
      case "close":
        this.close();
        return;
      case "kill":
        this.store.requestKill(action.id);
        return;
      case "send":
        this.actions.send(task);
        this.close();
        return;
      case "yank":
        this.actions.yank(task);
        return;
      case "notify":
        this.actions.notify(action.message);
        return;
      case "render":
        this.tui.requestRender();
        return;
      case "ignore":
        return;
    }
  }

  render(width: number): string[] {
    const task = this.store.get(this.id);
    const height = Math.max(8, (this.tui.terminal.rows || 30) - 4);
    if (!task) {
      return [
        this.theme.fg("border", "─".repeat(width)),
        this.theme.fg("dim", `${this.id} is no longer tracked — esc to go back`),
        this.theme.fg("border", "─".repeat(width)),
      ];
    }
    return renderDetailLines(task, this.state, {
      width,
      height,
      theme: this.theme,
      now: Date.now(),
      lineCache: this.lineCache,
    });
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.done(null);
  }

  private cleanup() {
    clearInterval(this.ticker);
    this.unsubscribe();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
  }

  invalidate(): void {}
}

export function openDetail(
  ctx: ExtensionCommandContext,
  store: TaskStore,
  id: string,
  actions: {
    send: (task: Task) => void;
    yank: (task: Task) => void;
  },
): Promise<null> {
  return ctx.ui.custom<null>(
    (tui, theme, keybindings, done) =>
      new TaskDetail(
        tui,
        theme,
        keybindings,
        id,
        store,
        {
          notify: (message) => ctx.ui.notify(message, "info"),
          send: actions.send,
          yank: actions.yank,
        },
        done,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/detail.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Type-check**

Run: `cd pi-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pi-agent/extensions/tasks/src/ui/detail.ts pi-agent/extensions/tasks/detail.test.ts
git commit -m "feat(tasks): add the detail overlay"
```

---

## Task 10: Model-facing text

**Files:**
- Create: `pi-agent/extensions/tasks/src/prompt.ts`
- Test: `pi-agent/extensions/tasks/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/extensions/tasks/prompt.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd pi-agent && node --test extensions/tasks/prompt.test.ts`
Expected: FAIL — cannot find module `./src/prompt.ts`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/extensions/tasks/src/prompt.ts`:

```typescript
/**
 * Everything the model reads: tool descriptions and the text of results and
 * notifications. Kept apart from the tool wiring so the wording can change
 * without touching behaviour.
 */

import { formatExit, type Task } from "./domain.ts";
import { sanitizeText } from "./ui/output-lines.ts";

export const BG_START_TOOL_DESCRIPTION =
  "Start a long-running shell command in the background and return immediately. " +
  "Use this for dev servers, watchers, builds and test runs that would otherwise " +
  "block. The command has no stdin. You are notified once when it exits; until " +
  "then check on it with bg_status.";

export const BG_START_PROMPT_SNIPPET =
  "Run long-lived commands with bg_start instead of bash.";

export const BG_START_PARAMETER_DESCRIPTIONS = {
  command: "Shell command to run, exactly as it would be typed.",
  title: "Short label shown in the task list, e.g. 'dev server'.",
  workingDir: "Directory to run in, relative to the session cwd. Defaults to the cwd.",
};

export const BG_STATUS_TOOL_DESCRIPTION =
  "Check one background task: its status and the tail of its output.";

export const BG_LIST_TOOL_DESCRIPTION =
  "List every background task in this session, running and finished.";

export const BG_KILL_TOOL_DESCRIPTION =
  "Terminate background tasks by id and report their final state.";

export const BG_ID_PARAMETER_DESCRIPTION = "Task id, e.g. 'b1'.";

const OUTPUT_TAIL_LINES = 100;

/** Last `limit` lines, with a note about what was left out. */
export function tailLines(text: string, limit = OUTPUT_TAIL_LINES): string {
  const lines = sanitizeText(text).split("\n");
  if (lines.length <= limit) return lines.join("\n");
  const kept = lines.slice(-limit);
  return `... ${lines.length - limit} earlier lines omitted\n${kept.join("\n")}`;
}

export function describeTask(task: Task): string {
  const kind =
    task.kind === "background" ? "background" : task.kind === "user" ? "user" : "foreground";
  return `${task.id} [${kind}] ${task.title} — ${task.status === "running" ? "running" : formatExit(task)} (${task.command})`;
}

function outputSection(task: Task): string {
  if (task.merged) {
    const text = tailLines(task.stdout.text).trim();
    return text ? `output:\n${text}` : "output: (none)";
  }
  const parts: string[] = [];
  const out = tailLines(task.stdout.text).trim();
  const err = tailLines(task.stderr.text).trim();
  parts.push(out ? `stdout:\n${out}` : "stdout: (none)");
  if (err) parts.push(`stderr:\n${err}`);
  return parts.join("\n\n");
}

/** Delivered automatically, once, when a background task exits. */
export function buildSettledMessage(task: Task): string {
  const verb = task.status === "failed" ? "failed" : task.status === "killed" ? "was killed" : "finished";
  return `Background task ${task.id} (${task.title}) ${verb}: ${formatExit(task)}\n\n$ ${task.command}\n\n${outputSection(task)}`;
}

/** Delivered when the user presses `s` in the detail view. */
export function buildSendToAgentMessage(task: Task): string {
  return `Take a look at this task from the dashboard.\n\n$ ${task.command}\nstatus: ${task.status === "running" ? "running" : formatExit(task)}\n\n${outputSection(task)}`;
}

export function buildStatusResult(task: Task): string {
  return `${describeTask(task)}\n\n${outputSection(task)}`;
}

export function buildStartResult(task: Task): string {
  return `Started ${task.id} (pid ${task.pid ?? "?"}): ${task.command}\nCheck it with bg_status("${task.id}"). You will be notified when it exits.`;
}

export function buildKillReport(tasks: readonly Task[]): string {
  return tasks.map((task) => `${task.id}: ${formatExit(task)}`).join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd pi-agent && node --test extensions/tasks/prompt.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/extensions/tasks/src/prompt.ts pi-agent/extensions/tasks/prompt.test.ts
git commit -m "feat(tasks): add model-facing tool text"
```

---

## Task 11: Extension wiring

**Files:**
- Create: `pi-agent/extensions/tasks/index.ts`

No unit test: this file is pure wiring against Pi's runtime, verified by the
type-check and the manual smoke run in Task 12.

- [ ] **Step 1: Write `pi-agent/extensions/tasks/index.ts`**

```typescript
/**
 * tasks — a dashboard for every shell command in the session.
 *
 * Background tasks (bg_start) are spawned and owned here. The agent's own bash
 * calls and the user's `!` commands are mirrored in read-only. `/tasks` or
 * alt+t opens a two-stage overlay: the list, then a read-only inspector.
 *
 * This file is wiring only. Behaviour lives in src/.
 */

import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { copyToClipboard, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toTitle, type Task } from "./src/domain.ts";
import { createObserver } from "./src/observe.ts";
import {
  BG_ID_PARAMETER_DESCRIPTION,
  BG_KILL_TOOL_DESCRIPTION,
  BG_LIST_TOOL_DESCRIPTION,
  BG_START_PARAMETER_DESCRIPTIONS,
  BG_START_PROMPT_SNIPPET,
  BG_START_TOOL_DESCRIPTION,
  BG_STATUS_TOOL_DESCRIPTION,
  buildKillReport,
  buildSendToAgentMessage,
  buildSettledMessage,
  buildStartResult,
  buildStatusResult,
  describeTask,
} from "./src/prompt.ts";
import { createSpawner } from "./src/spawn.ts";
import { createTaskStore } from "./src/store.ts";
import { newDashboardState, openDashboard } from "./src/ui/dashboard.ts";
import { openDetail } from "./src/ui/detail.ts";

const WIDGET_KEY = "tasks";

export default function (pi: ExtensionAPI) {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  const observer = createObserver(store);
  const dashboardState = newDashboardState();

  let ui: ExtensionUIContext | undefined;
  let sessionContext: ExtensionContext | undefined;
  /** Settled background tasks waiting to be reported to the agent. */
  const pending = new Map<string, Task>();

  // --- Agent notifications ------------------------------------------------

  const deliver = (task: Task) => {
    try {
      pi.sendMessage(
        {
          customType: "task-result",
          content: buildSettledMessage(task),
          display: true,
          details: { id: task.id, title: task.title, status: task.status },
        },
        // followUp waits for the current tool batch; triggerTurn wakes the
        // agent only if it is idle. Either way, exactly one delivery.
        { deliverAs: "followUp", triggerTurn: true },
      );
      return true;
    } catch (error) {
      console.error("tasks: failed to deliver result", error);
      return false;
    }
  };

  const flush = () => {
    for (const [id, task] of [...pending]) {
      pending.delete(id);
      if (!deliver(task)) pending.set(id, task);
    }
  };

  store.onSettled((task) => {
    // Only tasks this extension owns are news to the agent: it already sees
    // its own bash results, and user commands are the user's business.
    if (task.kind !== "background") return;
    pending.set(task.id, task);
    if (sessionContext?.isIdle()) flush();
  });

  // --- Widget -------------------------------------------------------------

  let widgetCount = -1;
  const updateWidget = () => {
    if (!ui) return;
    const running = store.runningBackgroundCount();
    if (running === widgetCount) return;
    widgetCount = running;
    try {
      if (running === 0) {
        ui.setWidget(WIDGET_KEY, undefined);
        return;
      }
      ui.setWidget(WIDGET_KEY, (_tui, theme) => {
        const line =
          theme.fg("warning", "■ ") +
          theme.fg("text", `${running} background task${running === 1 ? "" : "s"} running`) +
          theme.fg("dim", " · ") +
          theme.fg("accent", "/tasks") +
          theme.fg("dim", " or alt+t to view");
        return { render: () => [line], invalidate: () => {} };
      });
    } catch {
      // UI may be unavailable (print/RPC modes or teardown).
    }
  };
  store.subscribe(updateWidget);

  // --- Session lifecycle --------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    sessionContext = ctx;
    if (ctx.hasUI) ui = ctx.ui;
  });

  pi.on("agent_settled", flush);

  pi.on("session_shutdown", async () => {
    sessionContext = undefined;
    pending.clear();
    observer.reset();
    try {
      ui?.setWidget(WIDGET_KEY, undefined);
    } catch {
      // Already gone.
    }
    ui = undefined;
    widgetCount = -1;
    await spawner.killAll();
    store.clear();
  });

  // --- Mirroring pi's own shell work --------------------------------------

  pi.on("tool_execution_start", (event, ctx) => {
    observer.toolStart(event, ctx.cwd);
  });
  pi.on("tool_execution_update", (event) => {
    observer.toolUpdate(event);
  });
  pi.on("tool_execution_end", (event) => {
    observer.toolEnd(event);
  });
  pi.on("user_bash", (event) => ({
    operations: observer.userBash(event, createLocalBashOperations()),
  }));

  // --- Tools --------------------------------------------------------------

  pi.registerTool({
    name: "bg_start",
    label: "Start Background Task",
    description: BG_START_TOOL_DESCRIPTION,
    promptSnippet: BG_START_PROMPT_SNIPPET,
    parameters: Type.Object({
      command: Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.command }),
      title: Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.title }),
      working_dir: Type.Optional(
        Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.workingDir }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const command = params.command.trim();
      if (!command) throw new Error("command must not be empty.");
      const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
      const task = spawner.start({ command, cwd, title: toTitle(params.title) });
      return {
        content: [{ type: "text", text: buildStartResult(task) }],
        details: { id: task.id, title: task.title, cwd, pid: task.pid },
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Check Background Task",
    description: BG_STATUS_TOOL_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: BG_ID_PARAMETER_DESCRIPTION }),
    }),
    async execute(_toolCallId, params) {
      const task = store.get(params.id);
      if (!task) {
        const known = store.list().map((entry) => entry.id).join(", ") || "none";
        throw new Error(`Unknown task id "${params.id}". Known: ${known}.`);
      }
      // This result carries the settlement, so the queued follow-up would be a
      // duplicate.
      if (task.status !== "running") pending.delete(task.id);
      return {
        content: [{ type: "text", text: buildStatusResult(task) }],
        details: { id: task.id, status: task.status, exitCode: task.exitCode },
      };
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "List Background Tasks",
    description: BG_LIST_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const tasks = store.list().filter((task) => task.kind === "background");
      const text =
        tasks.length === 0
          ? "No background tasks."
          : tasks.map((task) => describeTask(task)).join("\n");
      return { content: [{ type: "text", text }], details: { count: tasks.length } };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Kill Background Tasks",
    description: BG_KILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: BG_ID_PARAMETER_DESCRIPTION }),
    }),
    async execute(_toolCallId, params) {
      const ids = [...new Set(params.ids)];
      if (ids.length === 0) throw new Error("Provide at least one task id.");
      const unknown = ids.filter((id) => !store.get(id));
      if (unknown.length > 0) {
        throw new Error(`Unknown task id(s): ${unknown.join(", ")}.`);
      }
      await Promise.all(ids.map((id) => spawner.kill(id)));
      const tasks = ids.map((id) => store.get(id)).filter((task): task is Task => !!task);
      for (const id of ids) pending.delete(id);
      return {
        content: [{ type: "text", text: buildKillReport(tasks) }],
        details: { ids },
      };
    },
  });

  // --- Command and shortcut ----------------------------------------------

  const openDashboardLoop = async (ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1]) => {
    if (ctx.mode !== "tui") {
      const tasks = store.list();
      ctx.ui?.notify(
        tasks.length === 0 ? "No tasks yet." : tasks.map((t) => describeTask(t)).join("\n"),
        "info",
      );
      return;
    }
    if (store.size() === 0) {
      ctx.ui.notify("No tasks yet. Shell commands appear here as they run.", "info");
      return;
    }

    while (true) {
      const picked = await openDashboard(ctx, store, dashboardState);
      if (!picked) return;
      if (!store.get(picked)) continue;
      await openDetail(ctx, store, picked, {
        send: (task) => {
          pi.sendMessage(
            {
              customType: "task-attention",
              content: buildSendToAgentMessage(task),
              display: true,
              details: { id: task.id, status: task.status },
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
          ctx.ui.notify(`Sent ${task.id} to the agent.`, "info");
        },
        yank: (task) => {
          const text = task.merged ? task.stdout.text : task.stdout.text + task.stderr.text;
          void copyToClipboard(text);
          ctx.ui.notify(`Copied ${task.id} output.`, "info");
        },
      });
    }
  };

  pi.registerCommand("tasks", {
    description: "Browse background tasks and shell commands",
    handler: async (_args, ctx) => openDashboardLoop(ctx),
  });

  pi.registerShortcut("alt+t", {
    description: "Open the task dashboard",
    handler: async (ctx) => openDashboardLoop(ctx as never),
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd pi-agent && npx tsc --noEmit`
Expected: no errors. If `registerShortcut`'s context type does not satisfy the
command context (it lacks `mode`), change `openDashboardLoop` to accept
`ExtensionCommandContext` and, in the shortcut handler, guard with
`if (!("mode" in ctx)) return;` rather than casting.

- [ ] **Step 3: Run the whole suite**

Run: `cd pi-agent && npm test`
Expected: all test files pass.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/extensions/tasks/index.ts
git commit -m "feat(tasks): wire tools, command, shortcut and widget"
```

---

## Task 12: Install and smoke-test in real Pi

**Files:**
- Modify: `pi-agent/README.md`

- [ ] **Step 1: Install the extension for testing**

If `~/.pi/agent` already exists with content, install just this extension:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$(git rev-parse --show-toplevel)/pi-agent/extensions/tasks" ~/.pi/agent/extensions/tasks
```

Verify Pi discovers it:

```bash
pi -p "say ok" --no-session 2>&1 | tail -5
```

Expected: no extension load errors.

- [ ] **Step 2: Smoke-test the background path**

Start `pi` interactively and ask it to run a long background task, for example:
"start `sh -c 'for i in $(seq 1 60); do echo tick $i; sleep 1; done'` in the background".

Confirm, in order:
1. The widget appears above the editor showing `1 background task running`.
2. `alt+t` opens the dashboard and the task is listed as running with a pid.
3. `enter` opens the detail view and output appends live.
4. `j`/`k` scroll; `G` returns to the live tail.
5. `y` copies output (check with `pbpaste`).
6. `x` kills the task; status becomes `killed` within ~3s.
7. The agent receives exactly one exit notification.

- [ ] **Step 3: Smoke-test the foreground path**

Ask the agent to run a normal command (`bash` tool), then open `/tasks`.

Confirm:
1. The command appears as a foreground task with streaming output.
2. `t` reports that the stream is merged rather than doing nothing.
3. `x` explains that Pi owns the command.
4. `f` cycles the filter and the list changes accordingly.
5. Run `!git status` and confirm it appears as a user task with its output.

- [ ] **Step 4: Smoke-test `s` (send to agent)**

With a finished failing task selected, press `s`. Confirm a message appears in
the transcript containing the command and its output, and the agent responds to
it.

- [ ] **Step 5: Smoke-test shutdown**

With a background task running, run `/new`. Confirm the process is gone:

```bash
pgrep -fl "seq 1 60" || echo "no survivors"
```

Expected: `no survivors`.

- [ ] **Step 6: Record the results and fix anything broken**

If any step fails, fix it with a focused commit before continuing. Do not mark
the feature complete with a failing step.

- [ ] **Step 7: Update the README with the verified key list**

Append to `pi-agent/README.md`:

````markdown
### tasks

Open with `/tasks` or `alt+t`.

Dashboard: `j`/`k` select · `enter` inspect · `x` kill · `f` filter · `esc` close
Detail: `j`/`k` scroll · `g`/`G` top/bottom · `t` stdout/stderr · `x` kill ·
`s` send to agent · `y` copy · `esc` back

Agent tools: `bg_start`, `bg_status`, `bg_list`, `bg_kill`. At most 8 background
tasks run at once; all of them are killed when the session ends.
````

- [ ] **Step 8: Commit**

```bash
git add pi-agent/README.md
git commit -m "docs(tasks): document keys and tools"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-17-pi-tasks-extension-design.md`:

- Every spec section maps to a task: placement (1), domain (2), ring (3), store
  (4), background lifecycle (5), foreground and user mirroring (6), UI (7-9),
  model-facing text (10), wiring including widget, tools, command, shortcut,
  notifications and shutdown (11), verification (12).
- One deviation from the spec, deliberate: `src/ui/output-lines.ts` is a new
  shared helper, noted in the File Structure section above.
- One clarification: the spec says user `!` commands follow the same lifecycle
  as foreground tasks. There is no "user bash finished" event, so Task 6
  captures them by wrapping the `BashOperations` Pi uses to execute them.

---

## Implementation Corrections

Recorded after executing this plan. The code blocks above contain three
mistakes; the committed implementation differs as follows.

**1. No TypeScript parameter properties (Tasks 8 and 9).**
`constructor(private tui: TUI, ...)` fails at load time with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`: Node strips types without transforming, and
Pi loads extensions the same way. Both `TaskDashboard` and `TaskDetail` declare
their fields explicitly and assign them in the constructor body.

**2. Width assertions must measure visible width (Tasks 8 and 9).**
`truncateToWidth` inserts ANSI reset sequences when it truncates, so a correctly
truncated 40-column line has a `String.length` of 48. The tests use
`visibleWidth(line)` from `@earendil-works/pi-tui`.

**3. The tree-kill test did not reach the escalation path (Task 5).**
`sh -c 'trap "" TERM; sleep 30'` dies on SIGTERM anyway, because the trapping
shell's `sleep` child does not ignore the signal. The suite adds a separate test
using `trap "" TERM; echo trapped; while :; do sleep 0.2; done`, which waits for
the `trapped` marker before killing — a SIGTERM sent before the trap is
installed would kill the process outright and never exercise SIGKILL.

## Verification Record

Automated: 85 tests pass across 8 files; `tsc --noEmit` clean.

Verified against real Pi 0.84.2 in print mode (`pi -e ./extensions/tasks/index.ts`):

- The extension loads with no errors.
- `bg_start`, `bg_list`, `bg_status` work end to end, including output capture
  and exit codes.
- `bg_kill` terminates the process group and leaves no orphans.
- `bash` tool event payloads match `observe.ts`'s assumptions: `toolName` is
  `"bash"`, `args.command` is the command string, and `tool_execution_update`
  carries the **full accumulated output** each time, confirming that updates
  must replace rather than append. The first update carries an empty `content`
  array and is correctly ignored.
- The settle notification path runs to completion (`settled → flush → deliver`,
  `sendMessage` returns without throwing). Print mode exits before a queued
  follow-up is surfaced, so the agent-visible half of this path is confirmed
  only up to the `sendMessage` call.

Not yet verified — requires an interactive TUI session:

- The widget above the editor, both overlays, and every key binding.
- `s` (send to agent) and `y` (yank) end to end.
- `user_bash` capture: whether Pi honours the returned `operations` wrapper for
  `!commands`.
- Killing background tasks on `/new` and session shutdown.
