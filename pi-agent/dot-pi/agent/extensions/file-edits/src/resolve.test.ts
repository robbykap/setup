/**
 * The resolution order, exercised with every source faked. The point of each
 * test is which source answered, so the fakes are deliberately distinguishable
 * — a baseline diff and a git diff never produce the same counts here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createBaselineStore, type BaselineIo } from "./baseline.ts";
import type { FileChange } from "./domain.ts";
import { resolveChange, resolutionNote, type ResolveDeps } from "./resolve.ts";

const CWD = "/repo";

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: "a.ts",
    hunks: [],
    patches: [],
    added: 0,
    removed: 0,
    edits: 1,
    isNew: false,
    updatedAt: 1,
    origin: { kind: "self" },
    hunksPending: true,
    ...overrides,
  };
}

const emptyIo: BaselineIo = { readFile: () => null, fileSize: () => null };

function deps(overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    cwd: CWD,
    baselines: createBaselineStore(emptyIo),
    headSha: null,
    readFile: () => null,
    blobAtRef: () => null,
    diffAgainstRef: () => null,
    ...overrides,
  };
}

const PATCH = "@@ -1,1 +1,1 @@\n-old\n+new\n";

test("a snapshot baseline is diffed against the file on disk", () => {
  const baselines = createBaselineStore(emptyIo);
  baselines.adopt("a.ts", { content: "one\ntwo\n", source: "snapshot" });

  const resolution = resolveChange(
    change(),
    deps({ baselines, readFile: () => "one\nTWO\nthree\n" }),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.source, "baseline");
  assert.equal(resolution.added, 2);
  assert.equal(resolution.removed, 1);
});

test("the baseline wins over the patches a call reported", () => {
  // The patches describe one call; the baseline describes the session. When
  // both are available the longer story is the true one.
  const baselines = createBaselineStore(emptyIo);
  baselines.adopt("a.ts", { content: "one\n", source: "snapshot" });

  const resolution = resolveChange(
    change({ patches: [PATCH] }),
    deps({ baselines, readFile: () => "one\ntwo\nthree\n" }),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.source, "baseline");
  assert.equal(resolution.added, 2);
});

test("a file created this session reads as all additions", () => {
  const baselines = createBaselineStore(emptyIo);
  baselines.captureAbsent("new.ts");

  const resolution = resolveChange(
    change({ path: "new.ts" }),
    deps({ baselines, readFile: () => "one\ntwo\n" }),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.added, 2);
  assert.equal(resolution.removed, 0);
});

test("a file deleted since the baseline reads as all removals", () => {
  const baselines = createBaselineStore(emptyIo);
  baselines.adopt("a.ts", { content: "one\ntwo\n", source: "snapshot" });

  const resolution = resolveChange(
    change(),
    deps({ baselines, readFile: () => null }),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.removed, 2);
  assert.equal(resolution.added, 0);
});

test("with no baseline held, the blob at the pinned commit becomes one", () => {
  const baselines = createBaselineStore(emptyIo);
  let asked = 0;

  const shared = deps({
    baselines,
    headSha: "c0ffee",
    readFile: () => "one\nTWO\n",
    blobAtRef: (cwd, ref, file) => {
      asked += 1;
      assert.equal(cwd, CWD);
      assert.equal(ref, "c0ffee");
      assert.equal(file, "a.ts");
      return "one\ntwo\n";
    },
  });

  const first = resolveChange(change(), shared);
  const second = resolveChange(change(), shared);

  assert.equal(first.kind, "resolved");
  assert.equal(first.source, "git");
  assert.equal(first.added, 1);
  assert.equal(second.kind, "resolved");
  // Adopted on the first pass: a blob is fetched once per file, not per open.
  assert.equal(asked, 1);
});

test("patches answer when nothing can supply a baseline", () => {
  const resolution = resolveChange(change({ patches: [PATCH] }), deps());

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.source, "patch");
  assert.equal(resolution.added, 1);
  assert.equal(resolution.removed, 1);
});

test("patches from separate calls are read as one diff", () => {
  const resolution = resolveChange(
    change({ patches: [PATCH, "@@ -9,1 +9,2 @@\n ctx\n+extra\n"] }),
    deps(),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.hunks.length, 2);
  assert.equal(resolution.added, 2);
});

test("git is asked only after the baseline and the patches fail", () => {
  const resolution = resolveChange(
    change(),
    deps({
      headSha: "c0ffee",
      diffAgainstRef: () => ({
        hunks: [{ oldStart: 1, newStart: 1, lines: [] }],
        added: 7,
        removed: 2,
      }),
    }),
  );

  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.source, "git");
  assert.equal(resolution.added, 7);
});

test("an untracked file gets no invented baseline", () => {
  // git says "absent at that commit" for a file it has never tracked, exactly
  // as it does for one created this session. Treating that as an empty
  // baseline would report a long-lived file as brand new, so the blob failing
  // has to fall through to git rather than stand in for it.
  let diffed = 0;
  const resolution = resolveChange(
    change(),
    deps({
      headSha: "c0ffee",
      blobAtRef: () => null,
      readFile: () => "one\n",
      diffAgainstRef: () => {
        diffed += 1;
        return { hunks: [{ oldStart: 1, newStart: 1, lines: [] }], added: 1, removed: 0 };
      },
    }),
  );

  assert.equal(diffed, 1);
  assert.equal(resolution.kind, "resolved");
  assert.equal(resolution.source, "git");
});

test("a file matching its baseline is unchanged, not unavailable", () => {
  const baselines = createBaselineStore(emptyIo);
  baselines.adopt("a.ts", { content: "one\n", source: "snapshot" });

  const resolution = resolveChange(
    change(),
    deps({ baselines, readFile: () => "one\n" }),
  );

  assert.equal(resolution.kind, "unchanged");
  assert.match(resolutionNote(resolution) ?? "", /session started/);
});

test("outside a repository, with nothing recorded, the reason says so", () => {
  const resolution = resolveChange(change(), deps());

  assert.equal(resolution.kind, "unavailable");
  assert.match(resolutionNote(resolution) ?? "", /not a git repository/);
});

test("a resolved diff needs no note", () => {
  const resolution = resolveChange(change({ patches: [PATCH] }), deps());
  assert.equal(resolutionNote(resolution), undefined);
});

test("an absolute path is read where it actually lives", () => {
  const baselines = createBaselineStore(emptyIo);
  baselines.adopt("/elsewhere/a.ts", { content: "one\n", source: "snapshot" });
  const read: string[] = [];

  resolveChange(
    change({ path: "/elsewhere/a.ts" }),
    deps({
      baselines,
      readFile: (file) => {
        read.push(file);
        return "two\n";
      },
    }),
  );

  assert.deepEqual(read, ["/elsewhere/a.ts"]);
});
