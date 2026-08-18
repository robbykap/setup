import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FULL_OUTPUT_CAP_BYTES,
  readFullOutput,
  type FullOutputReader,
} from "./full-output.ts";

function tempFile(contents: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cmds-test-"));
  const file = path.join(dir, "output.txt");
  fs.writeFileSync(file, contents, "utf8");
  return file;
}

test("a spill file is read back whole", () => {
  const result = readFullOutput(tempFile("line one\nline two\n"));
  assert.equal(result.kind, "loaded");
  assert.equal(result.kind === "loaded" && result.text, "line one\nline two\n");
  assert.equal(result.kind === "loaded" && result.capped, false);
});

test("an empty spill file loads as empty, not as an error", () => {
  const result = readFullOutput(tempFile(""));
  assert.equal(result.kind, "loaded");
  assert.equal(result.kind === "loaded" && result.text, "");
});

test("a file that is gone reports missing, so the viewer can say so", () => {
  const result = readFullOutput(path.join(os.tmpdir(), "pi-cmds-not-here.txt"));
  assert.equal(result.kind, "missing");
});

test("any other failure is reported rather than thrown", () => {
  const reader: FullOutputReader = {
    statSync: () => {
      throw new Error("permission denied");
    },
    openSync: () => 0,
    readSync: () => 0,
    closeSync: () => {},
  };
  const result = readFullOutput("/root/secret.log", reader);
  assert.equal(result.kind, "error");
  assert.equal(result.kind === "error" && result.message, "permission denied");
});

test("an enormous file is capped to its tail", () => {
  const size = FULL_OUTPUT_CAP_BYTES + 4096;
  let closed = false;
  const reader: FullOutputReader = {
    statSync: () => ({ size }),
    openSync: () => 7,
    readSync: (_fd, buffer, _offset, length, position) => {
      assert.equal(length, FULL_OUTPUT_CAP_BYTES);
      // Reading from the end: the tail is what the truncated view was
      // already showing more of.
      assert.equal(position, size - FULL_OUTPUT_CAP_BYTES);
      buffer.fill(0x61, 0, length);
      return length;
    },
    closeSync: (fd) => {
      assert.equal(fd, 7);
      closed = true;
    },
  };

  const result = readFullOutput("/tmp/huge.log", reader);
  assert.equal(result.kind, "loaded");
  assert.equal(result.kind === "loaded" && result.capped, true);
  assert.equal(result.kind === "loaded" && result.text.length, FULL_OUTPUT_CAP_BYTES);
  assert.ok(closed, "the descriptor is closed even on the capped path");
});
