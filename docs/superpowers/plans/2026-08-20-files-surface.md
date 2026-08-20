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

- [ ] **Task A — `shared/tui-kit/ansi-spans.ts`**
      `overlayRanges(text, ranges, opener, closer)`: apply an SGR opener over
      half-open ranges of the *visible* characters of an already-ANSI string,
      re-opening after any inner `\x1b[0m` / `\x1b[49m`. Tests beside it.

- [ ] **Task B1 — `file-edits/src/baseline.ts` + git ref support**
      `createBaselineStore` (snapshot before first touch, 2 MB / NUL guards)
      and, in `src/git-diff.ts`, `resolveHeadSha`, `blobAtRef`, and
      `diffAgainstRef` (replacing the HEAD-pinned `diffAgainstHead`).
      `sessionDiff(path, baseline, current)` builds hunks through the SDK's
      `generateUnifiedPatch` + the existing `parseUnifiedPatch`.

- [ ] **Task C — child patches on the wire**
      `shared/dashboard-state.ts`: `ChildFileEvent.patch?`.
      `subagents/src/backends/pi.ts` and `workflows/runner.ts`: read
      `result.details.patch` at `tool_execution_end` and forward it.

- [ ] **Task F1 — `shared/session-log.ts`**
      Append-only JSONL sidecar under `~/.pi/agent/state/<sessionId>/`,
      with `appendRecord`, `readRecords` (skipping malformed lines),
      `pruneOlderThan`, and a session-id resolver for each `session_start`
      reason.

### Wave 2 — file-edits wiring

- [ ] **Task B2** — baseline capture in the `edit`/`write` wrappers,
      `patch` carried through `observe.ts` into the store, `hunksPending` no
      longer sticky, and the four-step resolution order in `openDiffViewer`
      with `emptyBodyMessage` naming the step that failed.

### Wave 3 — viewer paint, then the IDE key

- [ ] **Task D** — `codeBody` highlights every line; changed words get the
      stronger tint through `overlayRanges`; inverse video removed.
- [ ] **Task E** — `file-edits/src/ide.ts` (config read/write, PATH
      detection, detached launch), the chooser UI, `o` in picker and viewer,
      `/ide` command.

### Wave 4 — persistence wiring

- [ ] **Task F2** — `restore()` on the file-edits, commands and subagents
      stores; append on change; replay at `session_start`; restored entries
      marked as such.

### Verification

`npm run check && npm test` in `file-edits`, `commands`, `subagents`,
`workflows`, and the kit suite from the agent directory. Full output pasted
into the final report; no task is done until its own suite is green.
