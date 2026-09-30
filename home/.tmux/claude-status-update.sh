#!/usr/bin/env bash
# Update this session's claude state + push aggregate to a global tmux option.
# Usage: claude-status-update.sh wait|work|done|clear|prune
#   prune: no per-session write, just recompute (drops dead sessions)
d=/tmp/claude-status
[ -n "$TMUX" ] || exit 0
mkdir -p "$d"
action="$1"

if [ "$action" != "prune" ]; then
  s=$(tmux display -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
  [ -n "$s" ] || exit 0
  # skip if state unchanged (avoids redraw spam on rapid tool calls)
  statefile="$d/.state-$s"
  [ "$(cat "$statefile" 2>/dev/null)" = "$action" ] && exit 0
  printf '%s' "$action" > "$statefile"
  case "$action" in
    wait)  printf '#[fg=#f9e2af]󱠢 %s#[default]' "$s" > "$d/$s" ;;
    work)  printf '#[fg=#fab387] %s#[default]' "$s" > "$d/$s" ;;
    done)  printf '#[fg=#89b4fa] %s#[default]' "$s" > "$d/$s" ;;
    clear) rm -f "$d/$s" ;;
  esac
fi

# recompute aggregate, dropping any session that no longer exists
live=$(tmux list-sessions -F '#{session_name}' 2>/dev/null)
agg=""
for f in "$d"/*; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  if printf '%s\n' "$live" | grep -qxF -- "$name"; then
    agg="$agg$(cat "$f") "
  else
    rm -f "$f" "$d/.state-$name"   # orphan: session gone
  fi
done
tmux set -g @claude_all "$agg"
# push a redraw to every attached client (realtime, no interval wait)
for c in $(tmux list-clients -F '#{client_name}' 2>/dev/null); do tmux refresh-client -t "$c" -S 2>/dev/null; done
true
