# commands — shell history as a first-class surface

Date: 2026-08-18

## Problem

Shell work is the noisiest thing in a transcript. A single `bash` call can push
fifty lines of output between two sentences, and once it scrolls past there is
no way back to it: the output lives in the transcript or nowhere. `file-edits`
already solved the same problem for edits — collapse the row, keep the detail
behind `/files`. Shell commands deserve the same treatment.

## Solution

A `commands` extension that records every shell-ish tool call of the session,
collapses `bash` rows in the transcript to two lines, and opens the full
history with `/cmds` (or `alt+c`): a picker of every command, Enter to inspect
one, with its output in a scrollable viewer.

Bash semantics are untouched. The extension delegates execution to the SDK's
own bash tool and only observes: this is a recording and viewing surface, not
a new execution model.

### Scope

Recorded: `bash`, `fd`, `rg`, from this session and from subagents and
workflow children. Background terminals are deliberately excluded — `/ps`
already inspects them live, and duplicating them here would give two places to
kill the same process.

## Architecture

```
extensions/commands/
  index.ts              wrap bash, register /cmds + alt+c, status item, wiring
  src/domain.ts         CommandRecord, CommandOrigin, formatters
  src/store.ts          in-memory session log: append/subscribe/list/totals
  src/record.ts         bash execution recording: timing, exit parsing
  src/observe.ts        subscribe to the shared channel (fd/rg + children)
  src/output.ts         sanitize + wrap output into display lines
  src/full-output.ts    lazy, capped read of fullOutputPath
  src/render/row.ts     CollapsedRow (two lines), EmptyRow
  src/ui/rows.ts        picker row model: filter, selection, row rendering
  src/ui/picker.ts      list overlay
  src/ui/viewer.ts      detail overlay
extensions/shared/command-log.ts   COMMAND_CHANNEL, CommandLogEvent, guard
```

### Record

```ts
interface CommandRecord {
  id: string;            // toolCallId, or generated for child records
  tool: "bash" | "fd" | "rg";
  command: string;       // bash: params.command; fd/rg: reconstructed argv
  cwd: string;
  origin: { kind: "session" }
        | { kind: "subagent"; id: string; name: string }
        | { kind: "workflow"; label: string };
  startedAt: number;
  durationMs: number;
  status: "ok" | "failed" | "aborted" | "timeout";
  exitCode?: number;
  output: string;        // what the tool returned, already capped by the tool
  outputLines: number;
  outputBytes: number;
  fullOutputPath?: string;
}
```

The store is a bounded append log (cap 500, oldest evicted), keyed by `id`,
listed newest-first, with subscriptions — the same read-model shape
`file-edits` and `background-terminals` share.

### Capture

**bash.** `commands` re-registers `bash` around `createBashToolDefinition(cwd)`
and delegates execution, exactly as `file-edits` does for `edit`/`write`.

One wrinkle drives the design of `record.ts`: bash does not return an exit
code. A non-zero exit is *thrown* as an `Error` whose message is the output
plus a trailing status line — `Command exited with code N`, `Command aborted`,
or `Command timed out after Ns` (`core/tools/bash.js:330-350`). Truncation
details are also lost on that path, but the text still carries a
`Full output: <path>` marker. So `record.ts` catches, parses that trailing
line into `status`/`exitCode`, parses the marker into `fullOutputPath`, strips
the status line from the stored output, records, and re-throws the original
error untouched. Both parsers are pure functions with unit tests; the thrown
error the model sees is never modified.

**fd / rg.** Owned by the `file-search` extension, so they emit a
`CommandLogEvent` on `COMMAND_CHANNEL` after execution — success or failure —
carrying the reconstructed argv, output text, duration, and `fullOutputPath`.

**Children.** Subagents and workflows already report file edits to the parent
through `ParentContext.onFileTouched` → `CHILD_FILE_CHANNEL`. An
`onCommandRun` hook is added beside it, fed from the child's
`tool_execution_end` when the tool is `bash`/`fd`/`rg`, and forwarded to
`COMMAND_CHANNEL` tagged with the child's origin. Child records carry the
output preview the child event provides — no second capture, no file access
into another session's temp files.

## Transcript row

Two lines, mirroring `file-edits` density:

```
 $ git status --short                          ✓ 0.4s · 12 lines
   │ M src/ui/picker.ts
```

Line 1 is the command with a right-aligned outcome (status glyph, duration,
line count). A multi-line command shows its first line plus `+N more`. Line 2
peeks at the **last** non-empty output line — for a shell command the tail is
the result, unlike a diff where the head is.

Two cases never collapse, following `file-edits`: an error (that output is
exactly what the user needs) and an explicitly expanded row (`ctrl+o`). Both
delegate to the built-in renderer.

`fd`/`rg` rows keep the compact rendering `file-search` already gives them;
they appear in the history but their transcript rows are not touched.

## UI

`/cmds` and `alt+c` open the picker: every command this session, newest first,
type to filter, `↑/↓/jk` to move, Enter to inspect, Esc to close. A row shows a
status glyph, the command, and — right-aligned — origin (when a child ran it),
duration, output size, and age.

Enter opens the viewer: a header with the command, cwd, origin, status, exit
code and duration; then the output in a fixed-height scrollable viewport
(`jk` line, pgup/pgdn page, `g`/`G` top/bottom). `n`/`p` move to the next and
previous command without returning to the picker, over the filtered list.

When the command's output was truncated and `fullOutputPath` still exists, the
viewer loads the full output lazily on open (capped at 2 MB) and says so in the
header; `f` toggles between the full output and what the model actually saw.
If the temp file is gone, it falls back to the stored text and says that too.

A status-bar item shows `❯ N cmds` while the session has any.

## Error handling

- The wrapper never swallows or rewrites a tool failure; recording happens
  around execution and the original result or error propagates untouched.
- Every store write is defensive about missing fields on child events: the
  channel is validated by a type guard before use, as `CHILD_FILE_CHANNEL` is.
- `ui.setStatus` calls are wrapped: the UI is absent in print and RPC modes.
- Full-output reads are try/caught with a fallback to the stored text.
- Output is sanitized at render time, never at capture time — raw ANSI in a
  fixed-height overlay desyncs the renderer.

## Testing

`node --test --experimental-strip-types`, matching the neighbours:

- `record.test.ts` — exit code, abort and timeout parsing; `Full output:` path
  extraction; status-line stripping; success path; error re-thrown unchanged.
- `store.test.ts` — ordering, cap eviction, subscription notification, totals.
- `observe.test.ts` — channel events become records; malformed payloads ignored.
- `domain.test.ts` — duration, size and age formatting; command summarizing.
- `row.test.ts` — two-line shape, last-line peek, width fitting, no-output case.
- `rows.test.ts` — filtering, selection reconciliation, row width safety.
- `output.test.ts` — ANSI stripping, tab expansion, wrapping.
- `full-output.test.ts` — reads a real temp file, caps, falls back when absent.

Every overlay line is exactly `width` cells; the row tests assert that, since a
one-cell error shatters the panel.
