# Plain tool rows everywhere — design

Date: 2026-08-19
Status: approved

## Problem

pi's `ToolExecutionComponent` wraps a tool's rendered lines in a filled,
colored Box — green for success, red for failure — unless the tool declares
`renderShell: "self"` (tool-execution.js:50). The file-edits extension opts
out, which is why edit/write rows are the clean `icon + path + counts` lines
the user likes. Every other tool still renders inside the filled box: bash
(commands extension), ask_user, fd/rg, the bg_* terminals, the subagent_*
tools, and workflow.

The user wants no filled boxes anywhere in the transcript. Every tool row
should follow the file-edits style: a colored nerd-font icon, a bold title,
a right-aligned outcome, and an optional dim peek line underneath.

## Design

### 1. Shared row renderer in tui-kit

New module `extensions/shared/tui-kit/row.ts`:

- `renderToolRow(parts, width, theme): string[]` — draws
  `icon + bold title …gap… right-aligned outcome` on line one, then optional
  dim `   │ peek` lines. Handles truncation with a dim `…`, exactly the way
  the file-edits and commands rows do today. Parts:
  `{ icon: FileIcon; title: string; right?: string; peek?: string[] }`
  where `title` is already painted by the caller (so file-edits keeps its
  dim-directory/bold-basename split and bash keeps its bold command).
- `BoxedDelegate` and `boxedDelegation` move here from
  `file-edits/src/render/row.ts` (file-edits imports them from the kit
  afterward). They restore pi's shell by hand for expanded (ctrl+o) views
  whose built-in renderers depend on the Box for padding and background.

The existing `CollapsedRow`/`EmptyRow`/`NoteRow` component classes stay
per-extension (they cache extension-specific records), but their `render`
bodies call the kit function.

### 2. bash (commands extension)

Add `renderShell: "self"` to the re-registered bash tool. Three states:

- **Running:** our own live row instead of the built-in's boxed streaming
  view — terminal icon (`UI_ICONS.terminal`) + the command + elapsed time,
  with a dim peek of the last output line so far, taken from the streaming
  partial result in `renderResult` (`options.isPartial`). The built-in's
  final `renderResult` call is still invoked once at settle for its 1Hz
  timer cleanup, as today.
- **Settled:** icon + command on line one, right-aligned
  `✓/✗ status · duration · N lines`, dim tail peek underneath
  (1 line on success, 3 on failure) — today's collapsed row with the icon
  replacing ` $ ` and no box.
- **Expanded (ctrl+o):** delegate to the built-in wrapped in
  `boxedDelegation`, since the built-in bash output block expects the shell's
  padding/background.

### 3. ask_user

- Add a `question` glyph to `UI_ICONS` (nf-fa-question, 0xf128, blue).
- Add `renderShell: "self"`.
- `renderCall`: question icon + the question text (replacing the current
  bold `ask_user ` prefix), numbered options dim underneath.
- `renderResult`: unchanged content (✓ answer / ✗ dismissed), just unboxed.

### 4. Remaining boxed tools

Each gets `renderShell: "self"` and renders its call line through the kit
row helper:

- **fd / rg (file-search):** magnifier icon (nf-fa-search, 0xf002) + the
  pattern/summary the current renderCall builds; result summary line stays,
  dimmed, unboxed.
- **bg_start / bg_status / bg_list / bg_kill:** `UI_ICONS.terminal` + the
  title/command summary each already renders.
- **subagent_* tools:** `UI_ICONS.agent` + the existing summary text.
- **workflow:** `UI_ICONS.agent` (no dedicated glyph needed) + the existing
  summary.

These are render-only changes; no execute paths move.

### 5. Built-in read audit

The built-in `read` tool is not re-registered anywhere. At implementation
time, drive the real `ToolExecutionComponent` over it (the
`shell.test.ts` pattern). If it paints a box, re-register it delegating
execution to `createReadToolDefinition`, with `renderShell: "self"` and a
row of file icon + path + a brief right-aligned note (e.g. `N lines`).
If it is already plain, leave it alone.

## Error handling

- Failures collapse like successes with a deeper peek (bash) or the
  existing failure text (others); ctrl+o always expands to the built-in
  view for full output.
- Extensions with no record for a call (streaming, pre-record) keep
  delegating to built-ins exactly as today.

## Testing

- Kit: `row.test.ts` — layout, truncation, right-alignment, no background
  fill escape codes in output; `boxedDelegation` behavior tests move with
  the code.
- Per extension: a `shell.test.ts`-style test driving the real
  `ToolExecutionComponent` asserting a settled collapsed row has no filled
  box — the only place the shell decision is observable.
- All existing suites (`npm run check && npm test` per extension, kit
  suite, root check) stay green.
