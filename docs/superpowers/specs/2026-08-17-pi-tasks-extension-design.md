# Pi `tasks` extension — design

Date: 2026-08-17
Status: approved

## Summary

A Pi extension that turns the terminal window into a task dashboard. It tracks
every shell command in the session — long-running processes the agent starts in
the background, the agent's own foreground `bash` calls, and the user's `!`
commands — and exposes them through a two-stage full-window overlay: a list of
tasks, and a read-only inspector showing one task's command and output.

Reference for the idea (not for the code): `davis7dotsh/my-pi-setup`,
`extensions/background-terminals`. This design is a leaner, dependency-free
implementation with a wider capture surface.

## Goals

- See at a glance what is running, what finished, and what failed.
- Inspect any task's command and output, live, without leaving Pi.
- Kill a runaway background process.
- Hand a task's output back to the agent without copy-paste.

## Non-goals (v1)

- No stdin. Tasks cannot be typed into; no PTY, no ANSI emulation.
- No survival across sessions. Background tasks die with the session.
- No spill-to-disk for large output. Bounded in-memory tail only.
- No starting tasks from the dashboard. `!command` and a real terminal cover it.
- No side-by-side layout.

## Placement and install

Source of truth: `pi-agent/extensions/tasks/` in this repository, mirroring
`~/.pi/agent/extensions/tasks/`. Pi auto-discovers `~/.pi/agent/extensions/*/index.ts`
and can hot-reload it with `/reload`. Install is a symlink or copy from this
repo into `~/.pi/agent`; documented in the extension README.

Plain TypeScript on Node. No runtime dependencies beyond what Pi provides
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`). Pi
strips types at load, so there is no build step.

## Architecture

| File | Responsibility | ~LOC |
|---|---|---|
| `index.ts` | Wiring only: event handlers, tool registration, `/tasks` command, `alt+t` shortcut, widget | 250 |
| `src/domain.ts` | `Task` type, status enum, elapsed/exit formatting | 80 |
| `src/store.ts` | Task list: add/update/settle, 50-entry cap, subscriptions | 150 |
| `src/spawn.ts` | Background process lifecycle: spawn, pipe, tree kill | 180 |
| `src/ring.ts` | Bounded 256KB output buffer, dropped-byte accounting | 70 |
| `src/observe.ts` | `tool_execution_*` and `user_bash` events into foreground entries | 120 |
| `src/prompt.ts` | Tool descriptions and model-facing result text | 120 |
| `src/ui/dashboard.ts` | Stage 1: list overlay | 250 |
| `src/ui/detail.ts` | Stage 2: output inspector overlay | 250 |

**Core boundary.** `store.ts` is a synchronous read model with subscriptions.
Producers (`spawn.ts`, `observe.ts`) write into it; consumers (UI, widget) read
and render from it. The UI never touches a process directly: `x` calls
`store.requestKill(id)` and the spawn layer reacts. This keeps the UI testable
without spawning anything.

### Task kinds

- **background** — the extension owns the process. Has a pid. Separate stdout
  and stderr buffers. Killable.
- **foreground** — mirrored from the agent's `bash` tool calls. No pid, single
  merged output stream, not killable (Pi owns the process; killing it under the
  tool would corrupt the tool result).
- **user** — the same as foreground, sourced from `user_bash`, tagged so it is
  distinguishable in the list.

## Data flow

### Background tasks

`bg_start` → `spawn.ts` spawns `/bin/sh -c <command>` in its own process group
with stdin `ignore`, stdout and stderr each piped into a 256KB ring buffer →
store update → subscribers re-render.

On exit the task settles as `done` (exit 0), `failed` (non-zero or spawn error),
or `killed`. Exactly one follow-up message is delivered to the agent describing
the outcome, queued via `deliverAs: "followUp"` with `triggerTurn: true`: it
never interrupts a mid-turn stream, and wakes the agent only if idle. If
`bg_status` or `bg_kill` returns that same settlement, the pending follow-up for
that id is consumed so the agent is never told twice.

Maximum 8 concurrent background tasks. `bg_start` rejects beyond that.

### Foreground tasks

`tool_execution_start` (toolName `bash`) creates a running entry holding the
command from `args`. Each `tool_execution_update` carries the **full accumulated
output** for that call, throttled by Pi — so the buffer is **replaced**, not
appended; appending would duplicate everything. `tool_execution_end` settles the
entry with success or error.

`user_bash` entries follow the same lifecycle, tagged as user-sourced. Pi emits
no "user bash finished" event, so these are captured by wrapping the
`BashOperations` Pi uses to run the command: the wrapper tees output into the
store and settles the task when execution returns or throws.

Events for unknown ids (an `end` without a `start`, e.g. after `/reload`) are
ignored rather than throwing.

## User interface

Opened by `/tasks` or `alt+t` (fallback `ctrl+q`; both user-overridable —
`ctrl+b` is already bound to cursor-left in Pi). Rendered as a full-window
overlay via `ctx.ui.custom({ overlay: true })`.

**Widget.** While at least one background task runs, a one-line widget above the
editor shows the running count and the hint to open the dashboard. It is
rewritten only when the count changes, not on every output chunk.

**Stage 1 — dashboard.** Rows of `glyph · title · id · pid · elapsed · status`,
newest first.

- `j`/`k` or arrows — select
- `enter` — inspect
- `x` — kill (background only)
- `f` — cycle filter: all → background → failed
- `esc` — close

Live-updating on store changes plus a 1Hz tick for elapsed times. Selection is
tracked by task id so it stays on the same task when the list mutates.

**Stage 2 — detail.** Header with command, cwd, status, elapsed, exit. Output
viewport pinned to the bottom (live tail) until scrolled.

- `j`/`k` — scroll, `pgup`/`pgdn` — page, `g`/`G` — top/bottom
- `t` — toggle stdout/stderr (background only; hidden for merged streams)
- `x` — kill (background only)
- `s` — send to agent
- `y` — yank visible output to clipboard
- `esc` — back to the dashboard

Keys that do not apply to the current task kind display a short reason rather
than silently doing nothing.

**`s` — send to agent.** Injects a visible message containing the command,
status, and the last ~100 lines of output, delivered as a queued follow-up over
the same path as exit notifications, so double delivery remains impossible.

Repaints from streaming output are throttled to ~20Hz so a chatty process cannot
starve input handling.

## Model-facing tools

- `bg_start(command, title, working_dir?)` — spawn a background task, return its
  id. Fire-and-forget.
- `bg_status(id)` — status plus a tail-truncated view of the output.
- `bg_list()` — all tracked tasks.
- `bg_kill(ids[])` — SIGTERM the process group, SIGKILL after 3s, return final
  state.

Titles are whitespace-collapsed and capped at 80 characters: a newline inside a
fixed-height row desyncs the TUI renderer.

## Error handling

- Spawn failure settles the task as `failed` with the error text. Never a silent
  drop.
- Kill sends SIGTERM to the process group, then SIGKILL after 3 seconds, bounded
  so a wedged process cannot hang shutdown.
- Output past 256KB per stream drops the oldest bytes and records the dropped
  count, shown as a `first N KB dropped` note in the detail view. A drop never
  splits a multi-byte UTF-8 sequence into an invalid one.
- No UI (print/RPC mode): tools still work; `/tasks` prints a text list.
- Session shutdown (`/new`, `/resume`, `/fork`, `/reload`, quit) kills every
  background task's process tree and clears the widget.

## Testing

Run with `node --test --experimental-strip-types`, matching how Pi loads TS.

- `ring.test.ts` — under cap, at cap, over cap; dropped-byte accounting; a
  multi-byte UTF-8 sequence split by a drop boundary.
- `store.test.ts` — status transitions; the 50-entry cap evicting the oldest
  *settled* task and never a running one; filter cycling; subscription fan-out;
  selection stability when the list mutates under the cursor.
- `observe.test.ts` — synthetic event sequences produce correct entries;
  cumulative snapshots replace rather than duplicate; orphaned or out-of-order
  `end` events are ignored; `user_bash` tagged correctly.
- `spawn.test.ts` — real short-lived processes: exit code capture, stderr
  separation, killing a tree whose child ignores SIGTERM, spawn-failure path.
- `ui.test.ts` — render output against a fake store at several widths, and the
  key-handling table. Pure string assertions, no TUI runtime.

## Verification before completion

Tests pass, `tsc --noEmit` clean, and a manual smoke run in real Pi: start a
long background task, see the widget appear, open the dashboard with `alt+t`,
watch live output, kill the task, confirm the agent receives exactly one exit
notification, and confirm a foreground `bash` call appears with streaming
output.
