# file-edits — handoff

Date: 2026-08-18
Branch: `feature/file-edits-tui` (worktree at `.worktrees/file-edits-tui`)
State: all 18 planned tasks done, 88 tests green, **but the overlays render wrong
and are not usable yet.**

## Where things stand

`~/.pi/agent` has been RESTORED to its pre-work state from
`~/.pi/agent.bak-2026-08-18-0135`. Nothing from this branch is installed. The
half-modified install that was being debugged was moved aside to
`~/.pi/agent.broken-test` — it can be deleted.

Working and verified by tests: the store, unified-patch parser, split-row
pairing, word-level intra-line diff, icons, collapsed-row layout, picker row
layout and filtering, git-HEAD fallback, child-session reporting, and the
shared status bar.

Not working: the two overlay components draw with broken geometry.

## The open bug — overlay geometry

Every line of an overlay must be exactly `width` visible cells. Measured at
width 100 against the real components:

| | measured | expected |
|---|---|---|
| picker header | 102 | 100 |
| picker rows | 99 | 100 |
| viewer header | 44 | 100 |

Causes, all confirmed by reading the code:

1. **`src/ui/picker.ts` header is `width + 2`.** It emits `"╭─"` + title +
   fill + summary + `"─╮"` where `fill = inner - vw(title) - vw(summary)` and
   `inner = width - 2`, totalling `inner + 4`.
2. **`src/ui/picker.ts` rows are `width - 1`.** `"│"` + 2-cell marker + body
   padded to `inner - 3` + `"│"` totals `inner + 1`. The empty-state row has
   its own separate, also-wrong arithmetic.
3. **`src/ui/viewer.ts` header collapses to content width.** It uses
   `truncateToWidth(heading, inner - 2)`, which shortens but never pads, so a
   short heading leaves a stub instead of a full-width border.
4. **Neither panel has a fixed body height**, so the box grows and shrinks with
   content instead of being a stable rectangle, and the transcript shows
   through. This is the biggest visual difference from `/ps` and `/subagents`.

## The fix

Copy the proven pattern in
`pi-agent/dot-pi/agent/extensions/background-terminals/src/ui/ps.ts:200-320`,
which already solves all four problems:

- `pad(text, width)` — pads a styled string to exactly `width` visible cells.
- `borderSegment(width, label)` — a border run of exactly `width` cells with an
  optional embedded label.
- top = `"╭"` + borderSegment(inner) + `"╮"`; row = `"│"` + pad(content, inner)
  + `"│"`; bottom likewise.
- a fixed `bodyHeight` from `tui.terminal.rows`, with empty rows padded out.
- the key legend rendered outside the box, truncated to `width`.

Put `pad`/`borderSegment` in one shared `src/ui/frame.ts` that both overlays
import. Do not modify `ps.ts`.

When changing the body height, also fix the scroll windows: the picker computes
`maxVisible` from `rows - 8` and the viewer its height from `rows - 6`; both
must match the height actually rendered or the last row is unreachable.

**Regression test to add** (`src/ui/frame.test.ts`): assert every rendered line
is exactly `visibleWidth === width` for both overlays at widths 100, 90, 72 and
60; that the line count is constant for 0, 1 and many files; that split mode at
width 70 (the narrow fallback) still produces exact-width lines; and that a
filter matching nothing does too. Use the real theme in at least one case — the
whole bug class is ANSI escapes versus visible width.

## Two traps that already bit this branch

- **No TypeScript parameter properties, `enum`, or `namespace`.** Pi loads
  extensions with type stripping only. `constructor(private tui: TUI)`
  type-checks fine and then fails at load with "parameter property is not
  supported in strip-only mode". This silently broke the whole extension once;
  `ps.ts` declares fields explicitly for exactly this reason. Always finish with
  a load test:
  ```sh
  node --experimental-strip-types -e 'import("./index.ts").then(()=>console.log("LOAD OK"))'
  ```
- **Unverified: whether this extension disturbs `claude-bridge`.** While
  debugging, subagent spawning failed with a `prompt-capture` mismatch
  ("no capture for this 11736-char system prompt"). The timing is suspicious —
  subagents worked while `file-edits` was failing to load, and broke after it
  loaded successfully and began registering its `edit`/`write` overrides, which
  can change the system prompt text that claude-bridge matches against. This was
  NOT confirmed: the config was restored before the isolation test finished.
  Check it deliberately before installing again — install, spawn one subagent,
  and see whether it fails the same way.

  Ruled out already: the overrides do NOT strip prompt metadata. The
  `{...baseEdit}` spread carries `promptSnippet` and `promptGuidelines` through
  (verified by constructing both tool definitions and inspecting the spread).

## Re-installing when you want to try it again

```sh
cp -R ~/.pi/agent ~/.pi/agent.bak-$(date +%F-%H%M)          # back up first
cd <repo>/.worktrees/file-edits-tui/pi-agent
cp -R dot-pi/agent/. ~/.pi/agent/
cd ~/.pi/agent/extensions/file-edits && npm install --ignore-scripts
```

To back out: `rm -rf ~/.pi/agent && mv ~/.pi/agent.bak-<stamp> ~/.pi/agent`.

The picker shortcut is `alt+e` (`ctrl+f` is pi's built-in forward-char and
`ctrl+shift+f` is also bound); `/files` does the same thing.
