/**
 * Subagent history: what gets written down, what comes back, and what a
 * restored subagent is allowed to do. The last part is the point — a subagent
 * with no session behind it must refuse to be steered rather than pretend.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubagentSnapshot } from "./src/domain.ts";
import type { SubagentReadModel } from "./src/manager.ts";
import {
  fromHistoryRecord,
  toHistoryRecord,
  withHistory,
} from "./src/history.ts";

function snapshot(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
  return {
    id: "sa-1",
    origin: "model",
    backend: "pi",
    title: "writer",
    prompt: "write it",
    cwd: "/repo",
    status: "done",
    createdAt: 1000,
    settledAt: 2000,
    meta: { backend: "pi", modelLabel: "claude-bridge/claude-opus-5" },
    usage: { tokens: 42 },
    transcript: [{ kind: "user", text: "hello" }],
    liveTools: [],
    queued: [],
    finalText: "done",
    turns: 1,
    ...overrides,
  };
}

function fakeView(live: ReadonlyArray<SubagentSnapshot>) {
  const sent: Array<{ id: string; text: string }> = [];
  const aborted: string[] = [];
  const view: SubagentReadModel = {
    list: () => live,
    get: (id) => live.find((entry) => entry.id === id),
    size: () => live.length,
    subscribe: () => () => {},
    subscribeTo: () => () => {},
    requestSend: (id, text) => sent.push({ id, text }),
    requestAbort: (id) => aborted.push(id),
    setOnSettled: () => {},
  };
  return { view, sent, aborted };
}

test("a settled subagent round-trips", () => {
  const record = toHistoryRecord(snapshot())!;
  const restored = fromHistoryRecord(record)!;

  assert.equal(restored.id, "sa-1");
  assert.equal(restored.title, "writer");
  assert.equal(restored.status, "done");
  assert.equal(restored.finalText, "done");
  assert.equal(restored.createdAt, 1000);
  assert.equal(restored.settledAt, 2000);
  assert.deepEqual(restored.transcript, [{ kind: "user", text: "hello" }]);
  assert.equal(restored.meta.modelLabel, "claude-bridge/claude-opus-5");
});

test("a running subagent is not written down", () => {
  // It will not be running after the reload, and a ghost is worse than a gap.
  assert.equal(toHistoryRecord(snapshot({ status: "running" })), undefined);
});

test("a subagent recorded as running reads back as one that did not survive", () => {
  const restored = fromHistoryRecord({
    snapshot: snapshot({ status: "running" }),
  })!;

  assert.equal(restored.status, "error");
  assert.match(restored.errorText ?? "", /did not survive/);
});

test("live scaffolding is dropped, since none of it survives", () => {
  const record = toHistoryRecord(
    snapshot({
      liveTools: [{ toolId: "t1", name: "bash" }],
      queued: [{ text: "later", kind: "steer" }],
      liveAssistant: { text: "half a sen", thinking: "" },
    }),
  )!;

  assert.deepEqual(record.snapshot.liveTools, []);
  assert.deepEqual(record.snapshot.queued, []);
  assert.equal(record.snapshot.liveAssistant, undefined);
});

test("only the tail of a long transcript is kept", () => {
  const long = Array.from({ length: 500 }, (_, index) => ({
    kind: "user" as const,
    text: `turn ${index}`,
  }));
  const record = toHistoryRecord(snapshot({ transcript: long }))!;

  assert.equal(record.snapshot.transcript.length, 200);
  assert.deepEqual(record.snapshot.transcript[0], { kind: "user", text: "turn 300" });
});

test("a very long message is truncated, not dropped", () => {
  const record = toHistoryRecord(
    snapshot({ transcript: [{ kind: "user", text: "x".repeat(9000) }] }),
  )!;
  const item = record.snapshot.transcript[0]!;

  assert.equal(item.kind, "user");
  assert.ok(item.kind === "user" && item.text.length < 9000);
  assert.ok(item.kind === "user" && item.text.endsWith("…"));
});

test("records that survive a version are read; the rest are skipped", () => {
  assert.equal(fromHistoryRecord({ snapshot: { ...snapshot(), id: "" } }), undefined);
  assert.equal(
    fromHistoryRecord({ snapshot: { ...snapshot(), status: "thinking" } }),
    undefined,
  );
  assert.equal(fromHistoryRecord({ snapshot: null }), undefined);
  assert.equal(fromHistoryRecord(null), undefined);
});

test("restored subagents are listed after the live ones", () => {
  const live = snapshot({ id: "sa-live", status: "running" });
  const { view } = fakeView([live]);

  const composed = withHistory(view, [snapshot({ id: "sa-old" })]);

  assert.deepEqual(
    composed.list().map((entry) => entry.id),
    ["sa-live", "sa-old"],
  );
  assert.equal(composed.size(), 2);
  assert.equal(composed.get("sa-old")?.title, "writer");
});

test("a live subagent wins an id collision", () => {
  // The one that exists now is the one that can be steered.
  const live = snapshot({ id: "sa-1", title: "live" });
  const { view } = fakeView([live]);

  const composed = withHistory(view, [snapshot({ id: "sa-1", title: "old" })]);

  assert.equal(composed.size(), 1);
  assert.equal(composed.get("sa-1")?.title, "live");
});

test("a restored subagent refuses to be steered or aborted", () => {
  const { view, sent, aborted } = fakeView([]);
  const composed = withHistory(view, [snapshot({ id: "sa-old" })]);

  composed.requestSend("sa-old", "carry on");
  composed.requestAbort("sa-old");

  assert.deepEqual(sent, []);
  assert.deepEqual(aborted, []);
});

test("a live subagent still takes both", () => {
  const { view, sent, aborted } = fakeView([snapshot({ id: "sa-1" })]);
  const composed = withHistory(view, []);

  composed.requestSend("sa-1", "carry on");
  composed.requestAbort("sa-1");

  assert.deepEqual(sent, [{ id: "sa-1", text: "carry on" }]);
  assert.deepEqual(aborted, ["sa-1"]);
});

test("subscribing to a restored subagent is a no-op that unsubscribes cleanly", () => {
  const { view } = fakeView([]);
  const composed = withHistory(view, [snapshot({ id: "sa-old" })]);

  const unsubscribe = composed.subscribeTo("sa-old", () => {
    assert.fail("a settled subagent changed");
  });

  assert.doesNotThrow(unsubscribe);
});
