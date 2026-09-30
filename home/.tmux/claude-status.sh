#!/usr/bin/env bash
# Renders claude state across all tmux sessions into the status bar.
d=/tmp/claude-status
[ -d "$d" ] || exit 0
out=""
for f in "$d"/*; do
  [ -e "$f" ] || continue
  out="$out$(cat "$f") "
done
printf '%s' "$out"
