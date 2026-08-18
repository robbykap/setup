import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMAND_CHANNEL } from "../../shared/command-log.ts";
import { observeCommandChannel } from "./observe.ts";
import { createCommandStore } from "./store.ts";

/** The slice of the events API this observer uses. */
function fakeEvents() {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const events = {
    on(channel: string, listener: (value: unknown) => void) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    },
    emit(channel: string, value: unknown) {
      for (const listener of listeners.get(channel) ?? []) listener(value);
    },
  };
  return events as unknown as ExtensionAPI["events"] & typeof events;
}

const valid = {
  tool: "rg",
  command: "rg needle src",
  cwd: "/repo",
  origin: { kind: "subagent", id: "a", name: "auditor" },
  status: "ok",
  durationMs: 120,
  output: "src/a.ts:1:needle\nsrc/b.ts:9:needle",
};

test("a valid event becomes a record with counts filled in", () => {
  const events = fakeEvents();
  const store = createCommandStore();
  observeCommandChannel(events, store, { now: () => 5_000 });

  events.emit(COMMAND_CHANNEL, valid);

  const [recorded] = store.list();
  assert.equal(recorded?.tool, "rg");
  assert.equal(recorded?.command, "rg needle src");
  assert.equal(recorded?.outputLines, 2);
  assert.equal(recorded?.durationMs, 120);
  // startedAt is inferred backwards from arrival, since the emitter reports
  // how long it took, not when it began.
  assert.equal(recorded?.startedAt, 4_880);
  assert.deepEqual(recorded?.origin, {
    kind: "subagent",
    id: "a",
    name: "auditor",
  });
});

test("malformed payloads are ignored, not stored", () => {
  const events = fakeEvents();
  const store = createCommandStore();
  observeCommandChannel(events, store);

  events.emit(COMMAND_CHANNEL, null);
  events.emit(COMMAND_CHANNEL, { ...valid, tool: "python" });
  events.emit(COMMAND_CHANNEL, { ...valid, status: "exploded" });
  events.emit(COMMAND_CHANNEL, { ...valid, origin: { kind: "subagent" } });
  events.emit(COMMAND_CHANNEL, { ...valid, output: 12 });

  assert.equal(store.size(), 0);
});

test("two identical events are two records", () => {
  const events = fakeEvents();
  const store = createCommandStore();
  observeCommandChannel(events, store, { now: () => 1 });

  events.emit(COMMAND_CHANNEL, valid);
  events.emit(COMMAND_CHANNEL, valid);

  assert.equal(store.size(), 2);
});

test("unsubscribing stops recording", () => {
  const events = fakeEvents();
  const store = createCommandStore();
  const stop = observeCommandChannel(events, store);

  stop();
  events.emit(COMMAND_CHANNEL, valid);

  assert.equal(store.size(), 0);
});
