# TUI polish: shared visual language for the pi extensions

Date: 2026-08-18
Status: approved

## Goal

Make the pi TUI extensions (`pi-agent/dot-pi/agent/extensions/`) feel like a
polished, GUI-like interface. Four concrete improvements plus a shared style
system so every window looks and behaves the same:

1. Syntax highlighting in file-edits diffs; file-type icons everywhere.
2. Full-row selection highlight in every picker instead of the `> ` cursor.
3. Readable command/output blocks in the cmds and subagent viewers, with vim
   scroll motions.
4. Plain collapsed transcript rows (no green/blue filled boxes) and a /files
   completeness audit. Ask-user options restyled as cards.

## Architecture: `shared/tui-kit/`

A new module at `extensions/shared/tui-kit/`, consumed by file-edits,
commands, subagents, background-terminals, and ask-user. Each unit is
rendering-only or pure, testable without a terminal, one file per concern:

### `icons.ts`

The file-icon table moves here from `file-edits/src/icons.ts` (which is
deleted) and grows to roughly 50 entries: existing set plus c, cpp, h, java,
kt, swift, rb, php, sql, vue, svelte, graphql, proto, tf, env, license,
image formats, and similar. Also non-file glyphs the other surfaces need:
agent, terminal, clock, check, cross. Same proven scheme: numeric Nerd-font
codepoints painted with literal Catppuccin Mocha RGB.

### `highlight.ts`

Wraps pi-coding-agent's internal ANSI highlighter
(`dist/utils/syntax-highlight.js`, highlight.js-based). Maps token classes to
Mocha colors via the `theme` option. Exposes:

- `languageForPath(path)` — extension-to-language resolver sharing its table
  with `icons.ts`.
- `highlightCode(code, language)` — ANSI-colored string; plain text fallback
  for unknown languages or highlighter errors.

Risk: this is a deep import into pi-coding-agent's dist, not a public export.
The kit isolates it behind its own interface; if the path breaks on a pi
upgrade, only this file changes and the fallback is plain text. Verify the
import works as the first implementation task.

### `selection.ts`

`paintRow(text, width, { selected })`: pads a row to full width and, when
selected, applies a `surface1`-style background fill plus bold. Must be
ANSI-aware: rows carry their own foreground colors (diff counts, status
glyphs), and inner `\x1b[0m` resets would drop the fill, so the painter
re-applies the background after every reset. This is the fiddly unit; it gets
the most thorough tests (plain rows, colored rows, wide glyphs, truncated
rows).

### `frame.ts`

Shared overlay chrome: title bar, rounded bordered sections, footer hint
line, and a "block" primitive — a labeled region such as
`╭ $ npm test ─╮ … ╰──╯` for a command with an unframed region for its
output. Borders and labels only; never a filled background.

### `scroll.ts`

One vim-motion scroll model for every viewer: `j`/`k` line step,
`ctrl-d`/`ctrl-u` half page, `g`/`G` top/bottom, plus arrow and page keys via
the keybindings manager. Extracted from the commands viewer's existing
offset-clamping logic (bottom-anchored offset, clamped in render) so all
viewers behave identically.

### `copy.ts`

Keyboard copy affordance using the same clipboard mechanism as the copy-all
extension. Viewers bind `y` (and where useful `Y`) and show `y copy` in the
footer. Mouse-click "buttons" are an investigation-only stretch item
(pi-tui's alt-screen path has mouse handling); no commitment.

## Per-extension changes

### file-edits (item 1, part of 4)

- Diff viewer highlights code per language: each hunk line goes through
  `highlightCode`, then the add/remove background tint is applied on top —
  added lines green-tinted with highlighted foreground, removed lines
  red-tinted, context lines plain highlighted code. Intraline emphasis from
  `intraline.ts` is layered last.
- Highlight results are cached per (file, hunk) so scrolling never
  re-highlights, mirroring the commands line cache.
- Icons come from `tui-kit/icons` in the picker rows, collapsed rows, viewer
  header, and status-bar segment.
- Collapsed transcript rows stay text-only; the delegation paths in
  `render/row.ts` are audited so a built-in colored box never shows while
  collapsed.

### commands (items 2, 3, part of 4)

- Picker uses `paintRow` full-row selection.
- Viewer: the command becomes a framed `$`-labeled block, no longer clamped
  to 3 lines — long scripts scroll as content. Output follows in its own
  visually separate region; stderr lines get a dim red gutter mark and the
  exit-status line is rendered as a distinct footer row inside the block. Scrolling moves to `tui-kit/scroll` (adds
  `ctrl-d`/`ctrl-u`; keeps `j/k/g/G`, `n/p`, `f`). `y` copies the command,
  `Y` the output.
- Collapsed transcript rendering for bash is taken over the same way
  file-edits takes over edit/write: one plain summary line
  (`icon $ command · exit 0 · 1.2s · 42 lines`) plus an optional dim peek
  line. Text color only, no background fill.

### subagents (items 2, 3)

- The /subagents list uses `paintRow` selection.
- The takeover transcript renders each tool call as a framed block — bash
  calls show the command block followed by its result instead of
  undifferentiated wrapped text — and adopts `tui-kit/scroll` for full vim
  motions. `y` copies the focused/last block.

### background-terminals

- /ps dashboard rows use `paintRow` selection; the output view adopts
  `tui-kit/scroll` and `y` copy.

### ask-user

- Options render as framed, icon-carrying cards with full-row selection
  highlight, consistent with the kit.

### /files completeness audit (item 4)

The write and edit tools are already wired into the store
(`file-edits/index.ts:153,199`) and child sessions announce via
`CHILD_FILE_CHANNEL`, yet /files felt incomplete in practice. This is an
investigation task with tests, not an assumed fix: verify new-file writes,
edits, child-session announcements, and failed-then-retried calls all land in
the store, and fix whatever gap the audit finds. Bash-created files
(redirects, heredocs) are explicitly out of scope — detecting them reliably
means parsing arbitrary shell.

## Error handling

- Highlighter failure or unknown language: plain text, never a crash and
  never a missing line.
- Deep-import failure of the highlighter: `highlight.ts` degrades to identity
  formatting at load time and the rest of the kit is unaffected.
- Clipboard unavailable: `y` shows a dim "copy failed" footer note.
- Selection painting must never change a row's visible width (the overlay
  geometry bugs in the git history were exactly this class of failure).

## Testing

Follow the existing pattern: pure units tested with `node --test`, no
terminal. New suites: icon coverage, language resolution, token-to-Mocha
mapping, ANSI-aware row painting (the priority suite), block framing widths,
scroll clamping, copy fallbacks. Extension-level tests update alongside:
picker row rendering, viewer layout, collapsed bash row, /files audit cases.
Every rendered line asserts `visibleWidth` ≤ declared width.

## Implementation notes

- Rollout order: tui-kit first (icons, highlight, selection, frame, scroll,
  copy), then file-edits, commands, subagents, background-terminals,
  ask-user. Each extension conversion is independently shippable.
- Per the user's direction: planning by Fable 5; implementation tasks are
  dispatched to Opus 5 subagents.
