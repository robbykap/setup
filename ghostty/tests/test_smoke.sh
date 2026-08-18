#!/bin/sh
# End-to-end check on a throwaway tmux server. Run: sh ghostty/tests/test_smoke.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOCK=gwsmoke
STATE=$(mktemp -d)
failures=0

export XDG_STATE_HOME="$STATE"
export PATH="$ROOT/bin:$PATH"
export PYTHONPATH="$ROOT/lib"
export GW_PYTHON="${GW_PYTHON:-/opt/homebrew/bin/python3.13}"

check() {
  printf '%-52s' "$1"
  if [ "$2" = "0" ]; then echo PASS; else echo FAIL; failures=$((failures + 1)); fi
}

tmux -L "$SOCK" -f "$ROOT/tmux/tmux.conf" new-session -d -s smoke -x 100 -y 30
sleep 1
gw-sidebar 2>/dev/null || tmux -L "$SOCK" run-shell "gw-sidebar"
sleep 1

pane=$(tmux -L "$SOCK" show-option -gqv @sidebar_pane)
[ -n "$pane" ]; check "sidebar pane was created" $?

tmux -L "$SOCK" capture-pane -p -t "$pane" | grep -q "TABS"; check "sidebar renders its header" $?

tmux -L "$SOCK" new-window
sleep 1
holder=$(tmux -L "$SOCK" list-panes -a -F '#{pane_id} #{window_index}' | awk -v p="$pane" '$1 == p {print $2}')
[ "$holder" = "2" ]; check "sidebar migrated to the new window" $?

count=$(tmux -L "$SOCK" list-panes -a -F '#{pane_id}' | grep -cx "$pane")
[ "$count" = "1" ]; check "exactly one sidebar exists" $?

tmux -L "$SOCK" run-shell "sb-cmd --session smoke view toggle"
sleep 1
grep -q '"view": "files"' "$STATE/gw/smoke.json"; check "view toggle reached the state file" $?

tmux -L "$SOCK" capture-pane -p -t "$pane" | grep -q "FILES"; check "sidebar redrew after the poke" $?

width=$(tmux -L "$SOCK" display-message -pt "$pane" '#{pane_width}')
[ "$width" = "24" ]; check "sidebar is 24 columns wide" $?

tmux -L "$SOCK" kill-server 2>/dev/null
rm -rf "$STATE"

echo
if [ "$failures" -eq 0 ]; then echo "smoke: all checks passed"; else echo "smoke: $failures failed"; fi
exit "$failures"
