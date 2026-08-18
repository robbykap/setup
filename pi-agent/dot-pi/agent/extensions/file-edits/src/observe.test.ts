import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileEditStore } from "./store.ts";
import { observeChildFiles } from "./observe.ts";

function bus() {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    on(channel: string, handler: (value: unknown) => void) {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
    emit(channel: string, value: unknown) {
      handlers.get(channel)?.(value);
    },
  };
}

test("a child file event lands in the store as pending", () => {
  const store = createFileEditStore();
  const events = bus();
  observeChildFiles(events as never, store, "/repo");
  events.emit("dashboard:child-file", {
    path: "/repo/src/a.ts",
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
  });
  const change = store.get("src/a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.origin.kind, "subagent");
});

test("malformed events are ignored", () => {
  const store = createFileEditStore();
  const events = bus();
  observeChildFiles(events as never, store, "/repo");
  events.emit("dashboard:child-file", { nope: true });
  assert.equal(store.size(), 0);
});

test("unsubscribing stops recording", () => {
  const store = createFileEditStore();
  const events = bus();
  const stop = observeChildFiles(events as never, store, "/repo");
  stop();
  events.emit("dashboard:child-file", {
    path: "/repo/a.ts",
    origin: { kind: "workflow", label: "run" },
  });
  assert.equal(store.size(), 0);
});

test("a relative path resolves against the child's cwd, not the parent's", () => {
  const store = createFileEditStore();
  const events = bus();
  observeChildFiles(events as never, store, "/repo");
  events.emit("dashboard:child-file", {
    path: "b.ts",
    cwd: "/repo/sub",
    origin: { kind: "workflow", label: "run" },
  });
  assert.ok(store.get("sub/b.ts"), `expected sub/b.ts, got ${store.list().map((c) => c.path).join(",")}`);
});
