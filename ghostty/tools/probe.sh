#!/bin/sh
# Verifies the tmux behaviours the sidebar depends on.
# Uses its own server socket and temp files; touches nothing you own.
set -u
SOCK=gwprobe
LOG=$(mktemp)
BIN=$(mktemp -d)
CONF=$(mktemp)

cat > "$BIN/gw-probe-marker" <<EOF
#!/bin/sh
echo "\$1" >> "$LOG"
EOF
chmod +x "$BIN/gw-probe-marker"

cat > "$CONF" <<'EOF'
set -g status off
set -g mouse on
set-hook -g after-new-window 'run-shell -b "gw-probe-marker new-window"'
set-hook -g session-window-changed 'run-shell -b "gw-probe-marker window-changed"'
bind -n MouseDown1Pane run-shell -b "gw-probe-marker mouse-#{mouse_y}"
EOF

PATH="$BIN:$PATH" tmux -L "$SOCK" -f "$CONF" new-session -d -s probe
tmux -L "$SOCK" new-window
tmux -L "$SOCK" select-window -t 1
sleep 1

check() {
  printf '%-48s' "$1"
  if grep -q "$2" "$LOG" 2>/dev/null; then echo PASS; else echo FAIL; fi
}
check "A. after-new-window hook fires"       "new-window"
check "B. session-window-changed hook fires" "window-changed"
check "C. run-shell inherits server PATH"    "new-window"

printf '%-48s' "D. join-pane preserves the process"
pane=$(tmux -L "$SOCK" split-window -d -P -F '#{pane_id}' 'sleep 300')
if tmux -L "$SOCK" join-pane -d -s "$pane" -t 0 2>/dev/null &&
   tmux -L "$SOCK" list-panes -a -F '#{pane_id} #{pane_current_command}' | grep -q "$pane sleep"; then
  echo PASS
else
  echo FAIL
fi

tmux -L "$SOCK" kill-server 2>/dev/null
echo
echo "E. mouse_y: run 'tmux -L $SOCK ...' interactively and click a pane;"
echo "   a line 'mouse-<row>' in the log confirms it. Log: $LOG"
