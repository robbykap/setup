/**
 * The `o` key's half of the handshake: where the editor should land, and what
 * an unconfigured editor does to the overlay that asked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange } from "../domain.ts";
import {
  firstChangedLine,
  requestOpen,
  type FileOpener,
  type OpenOutcome,
} from "./opener.ts";

function change(hunks: FileChange["hunks"]): FileChange {
  return {
    path: "src/a.ts",
    hunks,
    patches: [],
    added: 0,
    removed: 0,
    edits: 1,
    isNew: false,
    updatedAt: 0,
    origin: { kind: "self" },
    hunksPending: false,
  };
}

function opener(outcome: OpenOutcome) {
  const calls: Array<{ path: string; line: number }> = [];
  const value: FileOpener = {
    configureRequested: false,
    open(path, line) {
      calls.push({ path, line });
      return outcome;
    },
  };
  return { opener: value, calls };
}

test("the editor lands on the first line the diff changed", () => {
  const target = change([
    {
      oldStart: 10,
      newStart: 10,
      lines: [
        { kind: "context", text: "a", oldLine: 10, newLine: 10 },
        { kind: "context", text: "b", oldLine: 11, newLine: 11 },
        { kind: "add", text: "c", newLine: 12 },
      ],
    },
  ]);
  assert.equal(firstChangedLine(target), 12);
});

test("a removal is a change too, and gives up its old line number", () => {
  const target = change([
    {
      oldStart: 4,
      newStart: 4,
      lines: [{ kind: "remove", text: "gone", oldLine: 7 }],
    },
  ]);
  assert.equal(firstChangedLine(target), 7);
});

test("nothing to point at is line one", () => {
  assert.equal(firstChangedLine(change([])), 1);
  assert.equal(firstChangedLine(undefined), 1);
});

test("a launched editor leaves the overlay open", () => {
  const { opener: value, calls } = opener("opened");
  assert.equal(requestOpen(value, "src/a.ts", 12), false);
  assert.deepEqual(calls, [{ path: "src/a.ts", line: 12 }]);
  assert.equal(value.configureRequested, false);
});

test("an unconfigured editor closes the overlay and asks to be configured", () => {
  // The overlay owns the screen; the chooser cannot open on top of it.
  const { opener: value } = opener("unconfigured");
  assert.equal(requestOpen(value, "src/a.ts", 1), true);
  assert.equal(value.configureRequested, true);
});

test("a failed launch is reported by the opener, not by closing", () => {
  const { opener: value } = opener("failed");
  assert.equal(requestOpen(value, "src/a.ts", 1), false);
  assert.equal(value.configureRequested, false);
});

test("with no opener at all, `o` does nothing", () => {
  assert.equal(requestOpen(undefined, "src/a.ts", 1), false);
});
