# file-edits — handoff

Date: 2026-08-18
Branch: `feature/file-edits-tui` (worktree at `.worktrees/file-edits-tui`)
State: feature complete, 109 tests green, **installed and ready to try**.

## What to do first

`~/.pi/agent` already has this branch installed and verified (type-check clean,
109/109 tests, all extensions load). Just start pi and press `alt+e`.

Backup of the pre-work config: `~/.pi/agent.bak-2026-08-18-0135`.
To back out: `rm -rf ~/.pi/agent && mv ~/.pi/agent.bak-2026-08-18-0135 ~/.pi/agent`.

## The rendering bug, fixed

The overlays were drawing ragged because their lines were not all the same
width, and the panels resized with their content. Measured before the fix, at
width 100: picker header 102 cells, picker rows 99, viewer header 44.

Causes: the picker header added `╭─` + `─╮` on top of a fill already sized to
the full inner width; the picker rows budgeted for a 2-cell cursor marker but
subtracted 3; the viewer header used `truncateToWidth`, which shortens but
never pads, so a short title left a stub instead of a full-width rule.

The fix follows `/ps` and `/subagents` exactly, via a new shared
`src/ui/frame.ts`:

- `pad(text, width)` — fit styled text to exactly `width` visible cells.
- `borderSegment` / `topBorder` / `bottomBorder` / `bodyRow` — every piece is
  exactly `width` cells by construction.
- `bodyHeight(rows, chrome)` — a fixed body so the panel is a stable rectangle
  of `terminal rows - 1` lines, the same invariant `/ps` and `/subagents` use
  (covers header, chat and editor; leaves pi's footer row visible).

Both overlays now put the title and the key legend *outside* the box, as `/ps`
does, and the picker shows the active filter in the top border while the viewer
shows `n/m` position and a scroll percentage in its borders.

`src/ui/frame.test.ts` locks this down: every line exactly `width` cells at
widths 100/90/72/60, for both overlays, in both stacked and split mode, with
0/1/3/40 files, with a filter matching nothing, and scrolled to the end. It
uses a **real** `Theme` that emits real ANSI, because the entire bug class is
escape bytes being miscounted as visible cells.

## Two traps that bit this branch — keep them in mind

**1. No TypeScript parameter properties, `enum`, or `namespace`.** Pi loads
extensions with type stripping only. `constructor(private tui: TUI)` type-checks
and then fails at load with "parameter property is not supported in strip-only
mode". This silently broke the whole extension once. Always finish with:

```sh
node --experimental-strip-types -e 'import("./index.ts").then(()=>console.log("LOAD OK"))'
```

**2. `npm run check` behaves differently in the repo and under `~/.pi/agent`.**
Module resolution differs, so pi-tui's `KeybindingsManager` and the agent's can
resolve to two different declarations of the same runtime class. Check from both
places before believing it is clean.

## Unrelated breakage seen tonight: claude-bridge subagents

Subagent spawning fails with:

```
prompt-capture: no capture for this 11710-char system prompt
```

**This is not caused by file-edits.** It was verified by removing the extension
entirely, restoring the pristine config, and reproducing the failure anyway. The
prompt length also varies between runs (11736 vs 11710), which points at the
capture matcher rather than at any one extension. Worth investigating separately
in `pi-claude-bridge`.

Already ruled out: the `edit`/`write` overrides do not strip prompt metadata —
the `{...baseEdit}` spread carries `promptSnippet` and `promptGuidelines`
through, verified by inspecting both constructed tool definitions.

## Still unverified — needs a human at a real terminal

Nothing here has been seen in a live TUI; it is verified by unit tests and by
rendering the components headlessly and reading the output.

1. Startup is quiet apart from one expected warning about overriding the
   built-in `edit`/`write` tools. A *keybinding* conflict warning would mean
   `alt+e` collides after all.
2. An edit collapses to two lines; `ctrl+o` expands to the built-in diff and
   shows what was *applied*, not what was predicted.
3. A deliberately failing edit (bad `oldText`) still shows its error in full.
4. `alt+e` → picker; type to filter; Enter → viewer; `s` split/stacked; `n`/`p`
   between files; `j`/`k` scroll; `q` back. Filter and cursor survive the round
   trip.
5. Below 90 columns the viewer says "(too narrow to split)" and stays unified.
6. The status line sits above the prompt and disappears when nothing is active.

## Keys

`alt+e` or `/files` opens the picker. `ctrl+f` was rejected: it is pi's built-in
forward-char and is not on the reserved list, so registering it would silently
steal the key; `ctrl+shift+f` is also bound.
