# Ghostty Sidebar: Vertical Tabs + File Explorer

**Date:** 2026-08-17
**Status:** Approved design, not yet implemented
**Location:** `ghostty/` in this repo

## Context

The original request was "a plugin in the ghostty dir that adds vertical tab support and a file tree."

**Ghostty has no plugin API.** Verified against Ghostty 1.3.1 (installed) and its embedding header,
which states the C API "isn't meant to be a general purpose embedding API (yet)" and that its only
consumer is Ghostty's own macOS app. There is no extension point, no sidebar hook, and no supported
way to inject UI into the terminal chrome. A literal Ghostty plugin cannot be written today.

The user's governing criterion, stated explicitly, is trust and portability: *"I want something that
I have created so when I go to a new device I know it is safe to install and use."* Every decision
below is subordinate to that.

## Goals

- A persistent left sidebar, 24 columns wide, inside the terminal.
- Two switchable views: a vertical list of tabs, and a navigable file explorer.
- Explorer can navigate directories and open files.
- Code is authored in this repo, short enough to audit, with no third-party plugins.
- Install on a fresh Mac is: install two mainstream packages, clone, run one script.

## Non-goals

- Modifying, forking, or patching Ghostty itself.
- A full file manager (create/rename/delete/move). Rejected: more code to trust, and destructive
  capability cuts against the safety framing.
- Replacing the user's general tmux setup. This config is loaded in isolation.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Substrate | tmux | homebrew-core, 559,360 brew installs/year, stable config format. Chosen over Zellij (pre-1.0, 57k installs/yr) for maturity. |
| Sidebar model | One migrating pane | A single sidebar process that follows the user between windows via `join-pane`. |
| Sidebar contents | One pane, two views | Switched, not stacked. Removes a second pane and all inter-pane height arithmetic. |
| Input ownership | tmux | tmux key tables own 100% of input; renderer never reads the keyboard. |
| Language | Python 3.13 (min 3.11) | `brew install python@3.13`. No build step, stable across devices. |
| Config isolation | `tmux -f` | Never touches `~/.tmux.conf`; plain `tmux` elsewhere stays vanilla. |

### Rejected alternatives

- **Fork Ghostty's macOS app (Swift).** Truest to the ask, but means running an unsigned custom build
  of the terminal on every device and rebasing on each upstream release. Directly contradicts the
  trust criterion.
- **Third-party Zellij plugins.** Zellij's WASM sandbox and permission model are genuinely good, but
  the risk the user identified was other people's plugin code, which is exactly what this replaces.
- **Parking panes in a hidden "limbo" window** to achieve a single sidebar. Superseded by the
  migrating-pane approach, which achieves the same result without manual pane id/size/order bookkeeping
  and without breaking splits inside a tab.
- **Zig** (matches Ghostty's core language). Nothing here runs inside Ghostty, so its language exerts
  no pull; Zig is pre-1.0 and would add a toolchain plus a compile step before the terminal is usable.
- **Nushell.** Fits the user's daily shell and the `nushell/` dir, but nu is 0.x with breaking changes
  between releases — poor fit for code that must boot correctly on an unfamiliar machine.
- **Python 3.9** (`/usr/bin/python3`, ships with Xcode CLT). Zero install, but the user asked for a
  modern Python.

## Architecture

Three layers, each independently replaceable.

1. **Ghostty layer** — `ghostty/config`. Appearance settings plus `command` pointing at the launcher,
   so opening Ghostty lands in the workspace. Ghostty's native tabs are left alone and serve as
   "windows of workspaces"; tmux owns the in-workspace tabs.
2. **tmux layer** — `ghostty/tmux/tmux.conf`. Declares the sidebar, the hooks that migrate it, and
   every key binding. Loaded via `tmux -f`.
3. **Renderer layer** — `ghostty/bin/sidebar`. A pure renderer: prints a frame, waits to be poked,
   prints again. No raw terminal mode, no input parsing, no async.

```
ghostty/
  config              ghostty settings; launches the workspace
  README.md           what it is, install, uninstall, keybindings
  install.sh          preflight + symlinks; idempotent; --dry-run
  tmux/tmux.conf      layout, hooks, all keybinds
  bin/gw              resolve interpreter, create-or-attach session
  bin/gw-follow       migrate the sidebar pane into the active window
  bin/sidebar         renderer: TABS and FILES views
  bin/sb-cmd          state mutations, invoked by tmux keybinds
  tests/              unit tests + one integration smoke test
```

## Components

### `bin/gw` — launcher
**Does:** resolves a Python interpreter in fixed order (`$GW_PYTHON` → `/opt/homebrew/bin/python3.13`
→ `python3` only if version ≥ 3.11), verifies tmux is present and meets the minimum version, then
runs `tmux -f <repo>/ghostty/tmux/tmux.conf new-session -A -s <name> -c "$PWD"`.
**Why fixed order:** the user's `python3` resolves to miniconda, and on a fresh Mac it resolves to
system 3.9. PATH is not trustworthy here.
**Fails by:** printing the exact `brew install` command and exiting non-zero. Never silently degrades.

### `bin/sidebar` — renderer
**Does:** renders one frame of the sidebar to stdout, then blocks on a FIFO with a 2-second timeout
and re-renders. Reads state and, in TABS view, `tmux list-windows -F`.
**Depends on:** the state file, the FIFO, and the `tmux` binary. Nothing else.
**Interface:** `sidebar --session <name>`.

Header is two rows, acting as view buttons with the active view highlighted:

```
+------------------------+
|  TABS  |  FILES        |
+------------------------+
|  1 * nvim         2p   |
|  2   server            |
|  3   logs          !   |
+------------------------+
```

TABS view: one row per tmux window — index, name, pane count, active-row highlight, zoom and bell
markers. FILES view: indented tree of expanded directories, cursor row highlighted, hidden files and
`.git` omitted by default.

### `bin/sb-cmd` — state mutation
**Does:** applies one verb to the state file and pokes the FIFO. Verbs: `view toggle|tabs|files`;
`tree up|down|expand|collapse|activate|toggle-hidden`; `tree root <path>`; `poke`.
**Why separate from the renderer:** keeps the renderer pure, and makes every mutation a one-line
tmux binding that can be read and understood in isolation.

### `bin/gw-follow` — sidebar migration
**Does:** on window change, `join-pane` the sidebar into the newly active window, then
`select-layout main-vertical` with `main-pane-width 24`, then return focus to the work pane.
**Why this works:** `join-pane` moves an existing pane and preserves its running process, so the
sidebar keeps its scroll position, view mode, and process identity. Because only one sidebar exists,
`main-vertical` deterministically yields sidebar-left / work-right, and splits inside a tab continue
to behave normally.
**Guard:** a lock file prevents hook recursion, since joining a pane itself changes layout and focus.

### State

`${XDG_STATE_HOME:-$HOME/.local/state}/gw/<session>.json`

```json
{
  "view": "tabs",
  "tree": {
    "root": "/abs/path",
    "expanded": ["/abs/path/src"],
    "cursor": 0,
    "scroll": 0,
    "show_hidden": false
  }
}
```

A sibling `<session>.fifo` is the poke channel. Corrupt or unreadable state resets to defaults
rather than crashing.

## Keybindings

| Key | Action |
|---|---|
| `prefix + Tab` | Toggle sidebar view |
| `prefix + e` | Jump to FILES view and enter tree mode |
| `prefix + j` / `prefix + k` | Next / previous tab |
| `prefix + 1`..`9` | Jump to tab by index |
| `prefix + R` | Re-root the tree at the active pane's directory |
| `prefix + B` | Respawn the sidebar |
| `j` / `k` (tree mode) | Move cursor |
| `h` / `l` (tree mode) | Collapse / expand |
| `Enter` (tree mode) | Expand a directory, or open a file |
| `.` (tree mode) | Toggle hidden files |
| `q` / `Escape` (tree mode) | Leave tree mode |

Tree mode is a tmux key table, so bare keys work without the sidebar pane ever taking keyboard focus.
Pane-navigation keys are bound to skip the pane carrying the `@sidebar` option — it is chrome, not a
destination.

## Data flow

**Window switch:** user presses `prefix + j` → tmux `select-window` → window-change hook fires →
`gw-follow` joins the sidebar pane into the new window and re-applies the layout → `sb-cmd poke` →
renderer redraws with the new active row.

**View toggle:** `prefix + Tab` → `sb-cmd view toggle` writes state and pokes → renderer redraws.

**Open a file:** `Enter` in tree mode → `sb-cmd tree activate` → if the entry is a directory, toggle
expansion and poke; if a file, check `#{pane_current_command}` on the work pane. If it is a shell
(`zsh`, `bash`, `fish`, `nu`), `send-keys` `$EDITOR '<path>'` followed by Enter. Otherwise show a
`display-message` and change nothing — never type into a running program.

`cd '<path>'` is sent under the same guard for the "open directory in shell" action.

## Failure handling

- Renderer catches its own exceptions and prints a one-line error **inside the pane**; it never dies
  and leaves a blank column.
- Corrupt state file resets to defaults.
- Missing or too-old tmux/Python: `gw` refuses to start and prints the exact fix.
- Sidebar pane killed (including by killing its host window): `prefix + B` respawns it.
- `install.sh` backs up any existing file to `.bak` before symlinking, is idempotent, and supports
  `--dry-run`. It prints the PATH line for the user to add rather than editing a shell rc itself.

## Testing

Test-driven. The logic worth testing is pure and needs no terminal:

- `tests/test_tree.py` — flatten/expand, hidden-file filtering, cursor movement, scroll-offset math.
- `tests/test_tabs.py` — parsing `tmux list-windows -F` output into rows; click-row → window index.
- `tests/test_render.py` — snapshot tests: fixed state plus fake tmux output in, exact lines out.
- `tests/test_state.py` — round-trip, and recovery from corrupt/missing state.
- `tests/test_smoke.sh` — boots a headless tmux server with the repo config, asserts the sidebar pane
  exists, switches windows and asserts the sidebar migrated, `capture-pane`s to confirm rendered
  content, then kills the server.

## Rough edges and validation items

- Click-to-switch depends on mapping `#{mouse_y}` to a sidebar row. Plausible from tmux's format
  support but **not yet verified**; to be confirmed during implementation. If it does not work
  cleanly, keyboard switching still covers the feature and mouse support is dropped.
- The exact tmux hook name for window changes (`session-window-changed` vs `after-select-window`)
  must be confirmed against the installed tmux version before wiring `gw-follow`.
- Killing the window that currently hosts the sidebar destroys it. Mitigated by `prefix + B`, not
  prevented.
- Minimum tmux version is pinned at 3.3; `gw` checks it at launch. All features used (hooks with
  format expansion, key tables, `join-pane`, `main-pane-width`) predate it comfortably.

## Install and uninstall

**Install:** `brew install tmux python@3.13` → clone repo → `ghostty/install.sh` (symlinks
`~/.config/ghostty/config`, prints the PATH line for `ghostty/bin`).

**Uninstall:** delete the symlink and restore the `.bak`. Nothing else on the system was modified —
no shell rc edits, no `~/.tmux.conf` changes, no daemons.
