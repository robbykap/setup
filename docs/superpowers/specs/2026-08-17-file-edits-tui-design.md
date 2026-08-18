# File-edit TUI — design

Date: 2026-08-17
Status: approved

## Summary

Two related changes to the Pi TUI in this repository:

1. A new `file-edits` extension. File-editing tool calls collapse to a
   two-line row in the transcript, dressed in Catppuccin Mocha with nerd-font
   file-type icons. A picker overlay lists every file changed in the session;
   opening one shows a diff viewer that toggles between a stacked (unified)
   and a split (old | new) layout.
2. A shared status bar. Statuses from `subagents`, `workflows`,
   `background-terminals` and `summaries` move out of the footer and onto a
   single line directly above the prompt, using the same `◆` separators and
   palette as the main footer.

## Goals

- See at a glance which files a turn touched, without diffs flooding the
  transcript.
- Open any file changed this session and read its diff, unified or
  side-by-side.
- One consistent piece of status furniture, in one place, in one style.
- Include files changed by subagents and workflows, not just this session.

## Non-goals

- No mouse interaction (see Constraints).
- No editing from the viewer. It is read-only.
- No cross-file or three-way diffs.
- No persistence across sessions.

## Constraints discovered

**Click-to-expand is not achievable.** Pi's `Component` interface exposes only
`render`, `handleInput` and `invalidate`
(`pi-tui/dist/tui.d.ts:16-35`) — there is no mouse hook. Mouse tracking is
enabled only by `TuiAltScreen` (fullscreen mode,
`pi-tui/dist/tui-alt-screen.js:14-16`) and its events are consumed internally
for scrollbar drag, text selection and OSC 8 link activation. Link activation
is hardcoded to `openBrowser` (`interactive-mode.js:177`), so OSC 8 cannot be
used as a callback either. All interaction is therefore keyboard-driven.

**Tool rendering is fully overridable.** Registering a tool whose name matches
a built-in replaces it (`agent-session.js:1940`), and renderer inheritance is
resolved per slot (`docs/extensions.md:2068`). `createEditToolDefinition` and
`createWriteToolDefinition` are exported from the SDK
(`dist/index.d.ts:24`), so the override delegates `execute` to the built-in
implementation verbatim and replaces only `renderCall` / `renderResult`. Edit
semantics are never reimplemented.

**Widgets render above the editor by default** (`docs/extensions.md:168`),
which is where the status bar belongs.

**Child-session tool calls are observable, but not their diffs.** Both
`subagents/src/backends/pi.ts:467` and `workflows/runner.ts:547` stream
`tool_execution_end` events carrying `toolName`, so child edits need no new
IPC. However `ToolExecutionEndEvent` carries only `result`, not `details`
(`types.d.ts:594-600`), and the subagents backend flattens `args` into a
single-line `argsPreview`. The path is therefore taken from the child's
`tool_execution_start` args, and the diff for a child-edited file is computed
lazily against `git show HEAD:<path>` when the viewer opens. The baseline is
HEAD rather than the pre-edit buffer.

## Part 1 — the collapsed edit row

Every `edit` / `write` call renders two lines, with no diff body:

```
 󰛦 src/router.ts                                    +12 −4
   │ const model = pickModel(ranked, effort)
```

- Line 1: nerd-font file-type glyph, path relative to cwd with dim leading
  directories and a bright basename (the treatment `ui-customization`'s
  `splitDirectory` already uses for the footer), then `+adds −dels` in
  `toolDiffAdded` / `toolDiffRemoved`.
- Line 2: up to three lines from the largest hunk, dim, prefixed `│`,
  truncated to width. For a `write` to a new file, the first lines of the file.
- Failures keep the full built-in output. Collapsing an error hides the thing
  the user needs.
- `ctrl+o` (Pi's existing `app.tools.expand`) still reveals the full inline
  diff. The built-in escape hatch is untouched.

Icons live in `src/icons.ts` as an extension → (glyph, RGB) table. The colors
must be literal RGB: `ThemeColor` is a fixed 43-name union
(`theme/theme.d.ts:4`) with no per-language entries, and `ui-customization`
already sets the precedent of literal Mocha values. Every value is taken from
`themes/catppuccin-mocha.json` so the two cannot drift.

The override sets `renderShell: "self"`, matching the built-in `edit` tool.

## Part 2 — picker and viewer

### Picker (`ctrl+f`, `/files`)

A centered overlay listing every file changed this session, most recent first.

```
╭─ files changed ─────────────────────────────── 7 files  +184 −52 ─╮
│ ›  󰛦 src/router.ts                    +12 −4    2 edits   0:31 ago │
│    󰛦 src/ui/viewer.ts                 +96 −0    new file  1:12 ago │
│    󰌛 themes/catppuccin-mocha.json      +4 −4    1 edit    3:40 ago │
│    󰗀 docs/specs/design.md             +72 −44   1 edit   ⌘ sa-2    │
╰ type to filter · enter open · esc close ──────────────────────────╯
```

Hand-rolled as a `Component` in the style of `background-terminals/src/ui/ps.ts`,
reusing `fuzzyFilter` from pi-tui for filtering. `SelectList` was considered and
rejected: its item model is a fixed two-column `label` / `description` pair
(`select-list.d.ts:2-6`), which cannot express the icon, counts, edit-count,
age and origin columns this list needs.

The `⌘ sa-2` tag marks a file changed by a subagent; workflows are tagged with
their run label.

### Viewer (Enter from the picker)

A full-window overlay. Stacked (unified) by default:

```
╭─ 󰛦 src/router.ts ── +12 −4 ── [stacked] split ── 2 edits ──────────╮
│  38   const ranked = rank(candidates)                              │
│  39 − return ranked[0]                                             │
│  39 + const model = pickModel(ranked, effort)                      │
│  40 + if (!model) throw new NoModelError(effort)                   │
╰ s split · n/p file · j/k scroll · ctrl+f picker · q close ─────────╯
```

`s` switches to split, old on the left and new on the right, with paired rows
on the same screen row:

```
│  39 │ return ranked[0]        │  39 │ const model = pickModel(…)  │
│     │                         │  40 │ if (!model) throw new No…   │
```

The panes are hand-composed per row rather than built from `HStack`, because
`HStack` renders its children independently and cannot keep paired hunk rows
aligned. Below 90 columns, split falls back to stacked with a dim note in the
header — two 40-column panes of code are unreadable.

Word-level intra-line highlighting reuses the `diffWords` approach of the
built-in renderer (`components/diff.js`) so colors match `toolDiffAdded`,
`toolDiffRemoved` and `toolDiffContext`.

Keys: `j`/`k` and arrows scroll, `PgUp`/`PgDn` page, `n`/`p` move between
files, `s` toggles layout, `ctrl+f` returns to the picker, `q` or `esc`
closes. The layout choice persists for the session.

## Part 3 — the status bar

One line, directly above the editor:

```
 󰈔 7 files  ◆  ⌘ 2 running · 1 done  ◆  ▶ 1 terminal  ◆  ⚙ workflow 2/4
```

The main footer keeps directory · git · model · gauge · cost, and stops
rendering extension statuses.

**Transport stays `setStatus`.** The footer factory receives a live
`ReadonlyFooterDataProvider`; `ui-customization` captures that reference when
it installs the footer, and the widget calls `getExtensionStatuses()` at render
time. No extension has to change how it publishes, and any third-party
extension using `setStatus` appears in the bar rather than silently
disappearing. If the provider proves to be a snapshot rather than a live view,
the fallback is a new `dashboard:status` channel on the existing
`shared/dashboard-state.ts` event bus.

Changes required:

- `shared/activity-status.ts` is rewritten to emit compact segments
  (`⌘ 2 running · 1 done`) instead of today's
  `subagents: … /subagents to view` sentence. The "how to open it" hint leaves
  the bar; it is noise once the command is known.
- `background-terminals` drops its private `setWidget` call and publishes via
  `setStatus`, so it joins the shared line instead of owning a competing row.
- `file-edits` publishes the `󰈔 7 files` segment, which doubles as the
  discoverability hint for `ctrl+f`.

**Overflow.** Strictly one line. Each segment carries a priority; when the line
does not fit, the lowest-priority segments are dropped whole rather than every
segment truncating into mush, and the remainder truncates with a dim `…`.
Segment order is fixed — files, subagents, terminals, workflows, summaries — so
a segment never moves under the reader. When nothing is active the widget is
cleared and the row disappears.

## Architecture

New extension at `pi-agent/dot-pi/agent/extensions/file-edits/`.

| File | Responsibility | ~LOC |
|---|---|---|
| `index.ts` | Wiring: tool overrides, `ctrl+f`, `/files`, status segment | 180 |
| `src/domain.ts` | `FileChange`, `Hunk`, origin (`self` \| subagent id \| workflow label) | 90 |
| `src/store.ts` | Per-path change list, merged totals, ordering, subscriptions | 160 |
| `src/icons.ts` | extension → (glyph, Mocha RGB) table | 110 |
| `src/diff.ts` | Parse unified patch into hunks; pair rows for split | 200 |
| `src/render/row.ts` | The two-line collapsed transcript row | 120 |
| `src/ui/picker.ts` | `SelectList`-based picker overlay | 170 |
| `src/ui/viewer.ts` | Stacked / split diff overlay | 280 |
| `src/observe.ts` | Child-session `tool_execution_end` → store, tagged | 120 |

Shared: `shared/status-bar.ts` (segment model, priority ordering, overflow),
and a rewritten `shared/activity-status.ts`.

**Boundary.** `store.ts` is a synchronous read model with subscriptions, the
same shape `background-terminals` uses. Producers are the tool overrides and
`observe.ts`; consumers are the transcript row, picker, viewer and status
segment. The UI never parses a patch: `diff.ts` owns parsing and is pure, so
split-pane row pairing is testable without a terminal.

## Data flow

`edit` / `write` → built-in `execute` (unchanged) → `details.diff` →
`diff.ts` parse → `store.record()` → subscribers re-render.

Child sessions: `tool_execution_start` with `toolName` of `edit` or `write` →
path extracted from args → `store.recordExternal()` with an origin tag and no
hunks. The viewer fills in hunks on demand from `git show HEAD:<path>` diffed
against the file on disk.

## Error handling

- A patch that fails to parse falls back to the built-in renderer output, and
  the file still appears in the picker with unknown counts. A rendering bug
  must never hide that a file was edited.
- The store is capped at 200 files; oldest entries drop first.
- Overlays and widgets guard on `ctx.mode !== "tui"` and tolerate teardown, as
  the existing extensions do.
- Unknown file extensions fall back to a generic document glyph.

## Testing

Pure modules get `*.test.ts` beside them, per repository convention:

- `diff.test.ts` — hunk parsing, split row pairing, word-level highlight ranges
- `store.test.ts` — merge, ordering, cap, origin tagging
- `icons.test.ts` — extension mapping and unknown-extension fallback
- `render/row.test.ts` — widths, truncation, error passthrough
- `shared/status-bar.test.ts` — priority dropping and overflow

## Sequencing

1. Status bar (small, independent, immediately visible)
2. Store, diff parsing, collapsed row
3. Picker
4. Viewer, including split layout
5. Child-session observation

## As built — corrections to this design

Implemented on `feature/file-edits-tui`. Three things in the design above turned
out to be wrong once the code met pi's actual behavior. They are recorded here
rather than silently edited, because the reasoning matters.

**Collapsing happens in `renderCall`, not `renderResult`.** This document
assumed the built-in `edit` tool draws its diff from `renderResult`. It does
not: `renderCall` builds the diff component (`dist/core/tools/edit.js:229`),
while `renderResult` only appends a summary line on success. Overriding
`renderResult` alone therefore made the transcript *longer*, not shorter. The
extension now owns both slots: `renderCall` draws the collapsed row,
`renderResult` returns an empty component, and both delegate to the built-ins
when the row is expanded or the call failed. The base `renderResult` is still
invoked on the success path purely for its side effect — it writes the applied
diff back into the call component, so an expanded row shows what was applied
rather than what was predicted from the arguments.

**The shortcut is `alt+e`, not `ctrl+f`.** `ctrl+f` is a default binding for
`tui.editor.cursorRight` (`pi-tui/dist/keybindings.js:18`) and is not on pi's
reserved list, so registering it would have silently taken forward-char away
from the editor. The documented fallback `ctrl+shift+f` is also bound. `alt+e`
is unbound in both pi-tui and the agent core.

**Child edits are reported on `tool_execution_end`, not `_start`.** The path is
only available on `_start` and the success flag only on `_end`, so the two are
correlated by `toolCallId`. Reporting on `_start` alone listed failed edits as
changes.

Two known limits, accepted rather than fixed: per-call rows exist only in
memory, so a resumed session renders historical edits with pi's built-in view;
and when a subagent touches a file this session already edited, the viewer's
counts switch from session-relative to HEAD-relative once the git diff resolves.
