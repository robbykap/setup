/**
 * What a reload gets back. Records outlive the version that wrote them, so
 * the reader validates rather than trusts: a field that has changed shape
 * costs one command, never the whole history.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRecord } from "./domain.ts";
import { fromCommandRecord, toCommandRecord } from "./persist.ts";
import { createCommandStore } from "./store.ts";

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: "call-1",
    tool: "bash",
    command: "npm test",
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 1000,
    durationMs: 250,
    status: "ok",
    exitCode: 0,
    output: "ok\n",
    outputLines: 1,
    outputBytes: 3,
    ...overrides,
  };
}

test("a command round-trips", () => {
  const restored = fromCommandRecord(toCommandRecord(record()));

  assert.equal(restored?.id, "call-1");
  assert.equal(restored?.command, "npm test");
  assert.equal(restored?.status, "ok");
  assert.equal(restored?.exitCode, 0);
  assert.equal(restored?.durationMs, 250);
  assert.equal(restored?.startedAt, 1000);
  assert.equal(restored?.output, "ok\n");
});

test("a restored command says that it was restored", () => {
  assert.equal(fromCommandRecord(toCommandRecord(record()))?.restored, true);
});

test("a long output is logged as its tail, and counted as what came back", () => {
  // The end of a command's output is the part that says how it went.
  const long = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join("\n");
  const logged = toCommandRecord(record({ output: long }));

  assert.ok(logged.output.length <= 4000);
  assert.ok(long.endsWith(logged.output));

  const restored = fromCommandRecord(logged)!;
  assert.equal(restored.output, logged.output);
  assert.equal(restored.outputBytes, Buffer.byteLength(logged.output));
});

test("a short output is left exactly as it was", () => {
  const short = record({ output: "two\nlines\n" });
  assert.equal(toCommandRecord(short), short);
});

test("records that survive a version are read; the rest are skipped", () => {
  assert.equal(fromCommandRecord({ ...record(), id: "" }), undefined);
  assert.equal(fromCommandRecord({ ...record(), tool: "curl" }), undefined);
  assert.equal(fromCommandRecord({ ...record(), status: "maybe" }), undefined);
  assert.equal(fromCommandRecord({ ...record(), origin: { kind: "nope" } }), undefined);
  assert.equal(fromCommandRecord({ ...record(), command: 7 }), undefined);
  assert.equal(fromCommandRecord(null), undefined);
});

test("an optional field that was never set stays unset", () => {
  const restored = fromCommandRecord(
    toCommandRecord(record({ exitCode: undefined, fullOutputPath: undefined })),
  )!;

  assert.equal("exitCode" in restored, false);
  assert.equal("fullOutputPath" in restored, false);
});

test("the spill path survives, since that is where the full output lives", () => {
  const restored = fromCommandRecord(
    toCommandRecord(record({ fullOutputPath: "/tmp/out.txt" })),
  );
  assert.equal(restored?.fullOutputPath, "/tmp/out.txt");
});

test("a restore is not itself an event worth logging", () => {
  const logged: string[] = [];
  const store = createCommandStore({ sink: (entry) => logged.push(entry.id) });

  store.restore(record({ id: "old" }));
  assert.deepEqual(logged, []);

  store.record(record({ id: "new" }));
  assert.deepEqual(logged, ["new"]);
  assert.equal(store.size(), 2);
});

test("replaying keeps one entry per id, the last one winning", () => {
  const store = createCommandStore();
  store.restore(record({ id: "call-1", status: "ok" }));
  store.restore(record({ id: "call-1", status: "failed" }));

  assert.equal(store.size(), 1);
  assert.equal(store.get("call-1")?.status, "failed");
});
