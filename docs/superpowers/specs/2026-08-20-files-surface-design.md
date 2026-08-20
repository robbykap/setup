# The /files surface grows up — design

Date: 2026-08-20
Status: approved

## Problem

Four complaints, one surface.

1. **Diffs go missing.** A file a subagent edited often shows
   "no diff against HEAD" or an empty panel. Child sessions report only the
   *path* they touched (`CHILD_FILE_CHANNEL`), and the viewer asks
   `git diff HEAD -- path` on demand (`src/git-diff.ts`). That returns nothing
   whenever the work has been committed since (HEAD moved out from under the
   diff), the child ran outside the repository, or the directory is not a
   repository at all. A `write` has the same shape of problem for a different
   reason: it reports no patch, so its record lands with zero hunks.

2. **The tint eats the syntax highlighting.** `codeBody` (`src/ui/viewer.ts`)
   highlights a changed line only when it has no counterpart. A paired
   add/remove line — the common case — is painted flat so the words that
   differ can be inverted, because `wordSpans` returns offsets into raw text
   and there is no way to lay those onto an already-ANSI-coloured string.

3. **No way out to an editor.** Reading a diff in the viewer and then opening
   the file in an IDE means retyping the path.

4. **Collapsed rows lose their history.** `/files`, `/cmds` and `/subagents`
   are backed by in-memory stores built as the session runs. `/reload` and
   `/resume` start those stores empty, and since the rows themselves are
   collapsed, the detail is simply gone.

## Design

### 1. Diffs that don't go missing

**A session baseline.** A new `BaselineStore`
(`file-edits/src/baseline.ts`) answers one question per file: *what did this
look like before the session touched it?*

- The re-registered `edit` and `write` tools snapshot the file's bytes
  **before** delegating to the built-in, on first touch only. This is the
  exact, git-free answer, and it is the common path.
- A file we only learn about afterwards — a subagent's or workflow's edit —
  takes its baseline from `git show <sessionStartSha>:<path>`.
  `sessionStartSha` is resolved once at `session_start` and pinned, so a
  mid-session commit no longer erases the diff.
- A file with neither is treated as created this session: the baseline is
  the empty string and the whole file reads as an addition.
- Snapshots are skipped for files over 2 MB or containing a NUL byte; those
  fall through to git, then to a stated reason.

**The viewer shows the full session diff.** On open, the change is recomputed
as `baseline → the file on disk now`, via the SDK's own
`generateUnifiedPatch(path, baseline, current, 3)` parsed by the existing
`parseUnifiedPatch`. Hunks and the `+/−` counts then come from one
computation, so a file edited four times no longer shows the last patch above
cumulative counts, and re-opening after a later edit is current.

**Children ship their patch.** `ChildFileEvent` gains an optional `patch`
field. `subagents/src/backends/pi.ts` and `workflows/runner.ts` already watch
`tool_execution_end`; they read `result.details.patch` (the built-in edit
tool's `EditToolDetails.patch`) and forward it. These exact hunks are used
when no baseline can be established — a child running outside the repository,
a non-git directory, a file untracked at baseline.

**Resolution order**, per file, on viewer open:

1. baseline (snapshot or pinned-sha blob) vs. the file on disk;
2. patches forwarded by a child, concatenated in arrival order;
3. `git diff <sessionStartSha> -- path`, then `--no-index` for untracked;
4. an explicit reason string.

`hunksPending` stops being sticky. It means "not computed yet", and
`emptyBodyMessage` names which step failed instead of always blaming HEAD.

### 2. Syntax highlighting under the tint

New shared primitive `shared/tui-kit/ansi-spans.ts`:

```ts
overlayRanges(text, ranges, opener, closer): string
```

`ranges` are half-open offsets into the *visible* characters of `text`, which
may already carry SGR codes. The walker copies escapes verbatim, opens at a
range start, closes at its end, and re-opens after any `\x1b[0m` or
`\x1b[49m` that appears inside a range — the same discipline `fillLine` uses
for a row background. This is the primitive that was missing: it is what lets
`wordSpans`' raw-text offsets be laid over highlighted code.

With it, `codeBody` stops branching. Every line is syntax-highlighted. A
changed line sits on its soft tint (`DIFF_ADDED_BG` / `DIFF_REMOVED_BG`) and
the words that differ sit on a stronger tint — two new constants,
`DIFF_ADDED_EMPHASIS_BG` and `DIFF_REMOVED_EMPHASIS_BG` — with the syntax
foreground intact underneath. Inverse video is gone.

### 3. Open in your IDE

- Config: `~/.pi/agent/editor.json`,
  `{ "command": "cursor", "args": ["--goto", "{path}:{line}"] }`. A file owned
  by this extension, so writing it cannot race pi's own `settings.json`
  writes. `{path}` and `{line}` are substituted per launch; a command with no
  `{path}` gets the path appended.
- `o` opens the file under the cursor, from both the picker and the diff
  viewer. Not `ctrl+o`: pi binds that to expand-output.
- **No fallback to `$EDITOR`.** With nothing configured, `o` opens a chooser
  listing the editors actually found on `PATH` (Cursor, VS Code, Zed,
  IntelliJ, Sublime, Helix, Neovim, Vim), plus "enter a command". The choice
  is written to the config and the file then opens. `/ide` re-opens that
  chooser at any time.
- The viewer passes the first changed line so the editor lands on the hunk.
  Launch is detached with stdio ignored; a failure is a notice, never a throw
  inside an overlay.

### 4. History that survives /reload and /resume

New `shared/session-log.ts`: an append-only JSONL sidecar at
`~/.pi/agent/state/<sessionId>/<surface>.jsonl`, one JSON record per line,
appended as each store changes. On `session_start` the file is read back and
replayed into the store before the first render.

- `reason` picks the source: `startup`, `reload` and `resume` read the current
  session id; `fork` and `new` seed from `previousSessionFile`'s id.
- A malformed line is skipped, not fatal — a truncated tail is the expected
  failure mode of an append-only file.
- Each store gains `restore(records)`, distinct from `record()`: restored
  entries carry `restored: true` so a row can say where they came from rather
  than pretend they just happened.
- Restored file changes have no live baseline, so they resolve through the
  pinned sha or their stored patch.
- State directories older than 30 days are pruned at startup.

Nothing here reaches the model. It is local state, and replay reads one small
file per surface instead of walking the transcript.

## Testing

Every module lands with a `node --test --experimental-strip-types` suite
beside it, run from its own extension directory together with `npm run check`.
The new pure modules — `ansi-spans`, `baseline`, `session-log` — are testable
without a TUI; the wiring is covered by the existing store/observe/viewer
suites extended with the new cases.
