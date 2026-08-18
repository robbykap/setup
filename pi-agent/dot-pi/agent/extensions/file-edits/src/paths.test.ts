import assert from "node:assert/strict";
import { test } from "node:test";
import { storeKeyFor } from "./paths.ts";

const CWD = "/repo";

test("a file inside the cwd keys relative", () => {
  assert.equal(storeKeyFor(CWD, "src/a.ts"), "src/a.ts");
});

test("a file outside the cwd keys absolute", () => {
  assert.equal(storeKeyFor(CWD, "/etc/hosts"), "/etc/hosts");
});

test("..config.ts inside the cwd keys relative, not absolute", () => {
  assert.equal(storeKeyFor(CWD, "..config.ts"), "..config.ts");
  assert.equal(storeKeyFor(CWD, "/repo/..config.ts"), "..config.ts");
});

test("an already-absolute path inside the cwd keys relative", () => {
  assert.equal(storeKeyFor(CWD, "/repo/src/a.ts"), "src/a.ts");
});

test("a path that actually walks out of the cwd stays absolute", () => {
  assert.equal(storeKeyFor(CWD, "../outside.ts"), "/outside.ts");
  assert.equal(storeKeyFor(CWD, "../../etc/hosts"), "/etc/hosts");
});
