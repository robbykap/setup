import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diffAgainstHead } from "./git-diff.ts";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "file-edits-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  git("add", "a.txt");
  git("commit", "-qm", "init");
  return { dir, git };
}

test("returns hunks for a file modified since HEAD", () => {
  const { dir } = repo();
  writeFileSync(join(dir, "a.txt"), "one\nTWO\n");
  const result = diffAgainstHead(dir, "a.txt");
  assert.ok(result);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
});

test("returns null for an unchanged file", () => {
  const { dir } = repo();
  assert.equal(diffAgainstHead(dir, "a.txt"), null);
});

test("returns null outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "file-edits-nogit-"));
  writeFileSync(join(dir, "a.txt"), "x\n");
  assert.equal(diffAgainstHead(dir, "a.txt"), null);
});

test("an untracked file reports every line as added", () => {
  const { dir } = repo();
  writeFileSync(join(dir, "b.txt"), "x\ny\n");
  const result = diffAgainstHead(dir, "b.txt");
  assert.equal(result?.added, 2);
});
