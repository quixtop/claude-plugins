#!/bin/bash
# (c) Shrix
# author: shrix
# check-on-edit.sh — PostToolUse hook for Edit|Write: validates the file just
# edited with tune's `snapshot.py check` (YAML frontmatter and the (shrix)
# description rules, shell by its shebang, Python, JSON, JavaScript), but only
# inside the user's own extension and rule folders. A FAIL exits 2 so Claude
# sees it at once; every other outcome, including its own errors, exits 0.
# ⚠️ Runs on macOS's /usr/bin/python3 (3.9) DELIBERATELY, never Homebrew's:
# its compile() is what keeps the user's Python 3.9-safe, and 3.9 is the
# fallback every hook uses when Homebrew is missing. A 3.14 compile passes
# syntax that 3.9 then crashes on (review, 2Oct26). Cost measured 2Oct26
# (5 warm runs): ~83 ms per checked file; edits elsewhere return after one jq call.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
_gap() { [ -t 1 ] && printf '\n'; return 0; }
trap _gap EXIT
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  awk 'NR==1 { next } /^# \(c\)/ { next } /^# author:/ { next } /^#/ { sub(/^# ?/,""); print; next } { exit }' "$0"
  exit 0
fi
SNAP="${CC_SNAPSHOT_PY:-$HOME/.agents/skills/tune/scripts/snapshot.py}"; [ -f "$SNAP" ] || SNAP="$HOME/.claude/skills/tune/scripts/snapshot.py"
F=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$F" ] && [ -f "$F" ] && [ -f "$SNAP" ] || exit 0
case "$F" in
  "$HOME"/.agents/skills/*|"$HOME"/.claude/skills/*|"$HOME"/.claude/hooks/*|"$HOME"/.claude/rules/*|\
  "$HOME"/.claude/rules-ref/*|"$HOME"/.claude/commands/*|"$HOME"/.claude/CLAUDE.md) ;;
  *) exit 0 ;;
esac
# -I: the script's own folder (and the user site) is never on sys.path, so a
# json.py planted beside snapshot.py can't run here, outside the sandbox
OUT=$(/usr/bin/python3 -I "$SNAP" check "$F" 2>&1)
if printf '%s\n' "$OUT" | grep -q '^FAIL'; then
  printf 'check-on-edit: %s\n' "$OUT" >&2
  exit 2
fi
exit 0
