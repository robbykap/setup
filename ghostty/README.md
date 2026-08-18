# Ghostty workspace: vertical tabs + file explorer

A 24-column sidebar with two switchable views, built on tmux. Ghostty has no plugin API,
so nothing here runs inside Ghostty — it is a tmux session that Ghostty opens into.

## Install

```sh
brew install tmux python@3.13
sh ghostty/install.sh
export PATH="$PWD/ghostty/bin:$PATH"   # add to your shell rc
```

## Keys

| Key | Action |
|---|---|
| `prefix + Tab` | Switch sidebar view |
| `prefix + e` | File explorer + tree mode |
| `prefix + j` / `k` | Next / previous tab |
| `prefix + t` | New tab |
| `prefix + R` | Re-root the tree here |
| `prefix + B` | Rebuild the sidebar |
| `j` `k` `h` `l` (tree mode) | Move, collapse, expand |
| `Enter` (tree mode) | Open file, or expand folder |
| `c` (tree mode) | `cd` the shell to the selection |
| `.` (tree mode) | Toggle hidden files |
| `q` / `Escape` | Leave tree mode |

Clicking a row in the sidebar to switch to it is implemented and the mouse binding is
installed, but a live mouse click has not been verified end to end — it can't be
synthesized in a scripted session, so this path is exercised by code review only.

## Tests

```sh
sh ghostty/run-tests.sh          # unit tests
sh ghostty/tests/test_smoke.sh   # end-to-end on a throwaway tmux server
```

## Uninstall

Delete `~/.config/ghostty/config` (restore `config.bak` if present) and remove the PATH line.
Nothing else on the system was modified: no `~/.tmux.conf` changes, no shell rc edits, no daemons.

## Notes

- Work panes stack vertically to the right of the sidebar — that is `main-vertical` doing its job.
- Killing the window holding the sidebar kills the sidebar. `prefix + B` brings it back.
- State lives in `~/.local/state/gw/<session>.json` and is safe to delete.
