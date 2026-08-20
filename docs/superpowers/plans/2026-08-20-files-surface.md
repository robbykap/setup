# The /files surface grows up — implementation plan

> Spec: `docs/superpowers/specs/2026-08-20-files-surface-design.md`

**Goal:** subagent edits always produce a diff; syntax highlighting survives
the add/remove tint; `o` opens the file in a configured IDE; `/files`,
`/cmds` and `/subagents` survive `/reload` and `/resume`.

**Repo root for all paths below:** `pi-agent/dot-pi/agent/extensions/`.

**Conventions:** TypeScript with `.ts` import specifiers, type-stripped at
runtime. Each extension verifies with `npm run check && npm test` from its
own directory; the kit suite runs from `pi-agent/dot-pi/agent` as
`node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts`
(and new files must be added to the relevant `package.json` test script).
No new runtime dependencies. Comments explain *why*, in the voice of the
surrounding files.

---

### Wave 1 — independent modules

- [x] **Task A — `shared/tui-kit/ansi-spans.ts`**
      `overlayRanges(text, ranges, opener, closer)`: apply an SGR opener over
      half-open ranges of the *visible* characters of an already-ANSI string,
      re-opening after any inner `\x1b[0m` / `\x1b[49m`. Tests beside it.

- [x] **Task B1 — `file-edits/src/baseline.ts` + git ref support**
      `createBaselineStore` (snapshot before first touch, 2 MB / NUL guards)
      and, in `src/git-diff.ts`, `resolveHeadSha`, `blobAtRef`, and
      `diffAgainstRef` (replacing the HEAD-pinned `diffAgainstHead`).
      `sessionDiff(path, baseline, current)` builds hunks through the SDK's
      `generateUnifiedPatch` + the existing `parseUnifiedPatch`.

- [x] **Task C — child patches on the wire**
      `shared/dashboard-state.ts`: `ChildFileEvent.patch?`.
      `subagents/src/backends/pi.ts` and `workflows/runner.ts`: read
      `result.details.patch` at `tool_execution_end` and forward it.

- [x] **Task F1 — `shared/session-log.ts`**
      Append-only JSONL sidecar under `~/.pi/agent/state/<sessionId>/`,
      with `appendRecord`, `readRecords` (skipping malformed lines),
      `pruneOlderThan`, and a session-id resolver for each `session_start`
      reason.

### Wave 2 — file-edits wiring

- [x] **Task B2** — baseline capture in the `edit`/`write` wrappers,
      `patch` carried through `observe.ts` into the store, `hunksPending` no
      longer sticky, and the four-step resolution order in `openDiffViewer`
      with `emptyBodyMessage` naming the step that failed.

### Wave 3 — viewer paint, then the IDE key

- [x] **Task D** — `codeBody` highlights every line; changed words get the
      stronger tint through `overlayRanges`; inverse video removed.
- [x] **Task E** — `file-edits/src/ide.ts` (config read/write, PATH
      detection, detached launch), the chooser UI, `o` in picker and viewer,
      `/ide` command.

### Wave 4 — persistence wiring

- [x] **Task F2** — `restore()` on the file-edits, commands and subagents
      stores; append on change; replay at `session_start`; restored entries
      marked as such.

### Verification — done

`npm run check && npm test` green in every extension, and `npx tsc --noEmit`
clean from the agent directory: file-edits 246, commands 118, subagents 86,
shared 152, file-search 28.

A wiring smoke test (throwaway, not committed) drove the real extension
against a temporary git repository: two edits to one file, a commit, a child
file event with a patch, a `write`, then a `/reload` and one more edit. The
file reports `+3 −3` across all three of its edits, through two commits and a
reload — the case the old HEAD-relative diff lost entirely.

### Deviations from the plan

- The resolution order lives in its own module (`src/resolve.ts`) rather than
  inline in `openDiffViewer`, and runs on every record as well as on open, so
  the picker's counts are right before a file is opened.
- Restored records carry a `restored` flag but no visual marker; the original
  timestamps already keep the rows honest about when the work happened.
- `/subagents` history composes a read model beside the manager
  (`src/history.ts`) instead of restoring entries into it. Manager entries own
  a session, a scope and a pump fiber, none of which survive a reload, and
  teaching every send/abort/teardown path about entries that have none is a
  refactor of the concurrency-critical part of that extension.
