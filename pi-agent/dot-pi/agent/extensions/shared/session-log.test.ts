/**
 * The sidecar, against a real filesystem. Mocking node:fs here would test the
 * mock: truncated tails, unwritable paths and stale directories are the whole
 * subject.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  historySessionId,
  openSessionLog,
  pruneState,
} from "./session-log.ts";

function root() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "session-log-"));
  return directory;
}

test("records round-trip, in order and intact", () => {
  const log = openSessionLog<{ path: string; hunks: number[] }>({
    sessionId: "s1",
    surface: "files",
    root: root(),
  });

  log.append({ path: "a.ts", hunks: [1, 2] });
  log.append({ path: "b.ts", hunks: [] });

  assert.deepEqual(log.readAll(), [
    { path: "a.ts", hunks: [1, 2] },
    { path: "b.ts", hunks: [] },
  ]);
});

test("a session with no history reads as none", () => {
  const log = openSessionLog({ sessionId: "fresh", surface: "files", root: root() });
  assert.deepEqual(log.readAll(), []);
});

test("a truncated tail costs one record, not the file", () => {
  const log = openSessionLog<{ a?: number }>({
    sessionId: "s1",
    surface: "files",
    root: root(),
  });
  log.append({ a: 1 });
  fs.appendFileSync(log.file, '{"b":');

  assert.deepEqual(log.readAll(), [{ a: 1 }]);
});

test("lines that are not objects are skipped", () => {
  const log = openSessionLog<{ a?: number }>({
    sessionId: "s1",
    surface: "files",
    root: root(),
  });
  fs.mkdirSync(path.dirname(log.file), { recursive: true });
  fs.writeFileSync(log.file, 'null\n42\n"text"\n{"a":1}\n');

  assert.deepEqual(log.readAll(), [{ a: 1 }]);
});

test("only the most recent records are replayed", () => {
  const log = openSessionLog<{ n: number }>({
    sessionId: "s1",
    surface: "files",
    root: root(),
    maxRecords: 3,
  });
  for (let n = 0; n < 10; n += 1) log.append({ n });

  assert.deepEqual(log.readAll(), [{ n: 7 }, { n: 8 }, { n: 9 }]);
});

test("a session id cannot climb out of the state root", () => {
  const base = root();
  const log = openSessionLog({
    sessionId: "../escape",
    surface: "../files",
    root: base,
  });

  assert.ok(log.file.startsWith(base + path.sep), log.file);
  log.append({ a: 1 });
  assert.deepEqual(log.readAll(), [{ a: 1 }]);
});

test("an impossible write is not an error anyone hears about", () => {
  const base = root();
  const log = openSessionLog({ sessionId: "s1", surface: "files", root: base });
  // A directory where the file belongs: the append cannot succeed.
  fs.mkdirSync(log.file, { recursive: true });

  assert.doesNotThrow(() => log.append({ a: 1 }));
  assert.deepEqual(log.readAll(), []);
});

test("which history a session start replays", () => {
  assert.equal(historySessionId("startup", "now", undefined), "now");
  assert.equal(historySessionId("reload", "now", "/s/old.jsonl"), "now");
  assert.equal(historySessionId("resume", "now", "/s/old.jsonl"), "now");
  // A fork continues what it forked from.
  assert.equal(historySessionId("fork", "now", "/some/dir/abc123.jsonl"), "abc123");
  assert.equal(historySessionId("fork", "now", undefined), undefined);
  // A new session inherits nothing, however recently the last one was up.
  assert.equal(historySessionId("new", "now", "/s/old.jsonl"), undefined);
});

test("stale state is pruned and fresh state is left alone", () => {
  const base = root();
  const stale = path.join(base, "old");
  const fresh = path.join(base, "new");
  fs.mkdirSync(stale);
  fs.mkdirSync(fresh);
  const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  fs.utimesSync(stale, longAgo, longAgo);

  pruneState(base, 30 * 24 * 60 * 60 * 1000);

  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true);
});

test("pruning a root that is not there is not an error", () => {
  assert.doesNotThrow(() => pruneState(path.join(root(), "missing"), 1));
});
