#!/usr/bin/env bash
# Update this session's claude state + push aggregate to a global tmux option.
# Usage: claude-status-update.sh wait|work|done|clear|prune [detail]
#   detail: optional short text drawn dim after the session name (e.g. ctx "34%")
#   prune:  no per-session write, just recompute (drops dead sessions)
d=/tmp/claude-status
[ -n "$TMUX" ] || exit 0
mkdir -p "$d"
action="$1"
detail="${2:-}"

if [ "$action" != "prune" ]; then
  s=$(tmux display -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
  [ -n "$s" ] || exit 0
  statefile="$d/.state-$s"
  [ "$(cat "$statefile" 2>/dev/null)" = "$action $detail" ] && exit 0
  printf '%s %s' "$action" "$detail" > "$statefile"
  tail=""
  [ -n "$detail" ] && tail="#[fg=#6c7086,nobold,noreverse] $detail"
  # active session (the one the client is attached to) is drawn bold+reverse, others plain
  hi="#{?#{==:#S,$s},#[bold],#[nobold#,dim]}"
  case "$action" in
    wait)  printf '#[fg=#f9e2af]%s󱠢 %s #[default]%s#[default]' "$hi" "$s" "$tail" > "$d/$s" ;;
    work)  printf '#[fg=#fab387]%s %s #[default]%s#[default]' "$hi" "$s" "$tail" > "$d/$s" ;;
    done)  printf '#[fg=#89b4fa]%s %s #[default]%s#[default]' "$hi" "$s" "$tail" > "$d/$s" ;;
    clear) rm -f "$d/$s" "$statefile" ;;
  esac
fi

live=$(tmux list-sessions -F '#{session_name}' 2>/dev/null)
agg=""
for f in "$d"/*; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  if printf '%s\n' "$live" | grep -qxF -- "$name"; then
    [ -n "$agg" ] && agg="$agg#[fg=#45475a]│ "
    agg="$agg$(cat "$f")"
  else
    rm -f "$f" "$d/.state-$name"
  fi
done
[ -n "$agg" ] && agg="$agg#[fg=#6c7086]· "
tmux set -g @claude_all "$agg"
for c in $(tmux list-clients -F '#{client_name}' 2>/dev/null); do tmux refresh-client -t "$c" -S 2>/dev/null; done
true
