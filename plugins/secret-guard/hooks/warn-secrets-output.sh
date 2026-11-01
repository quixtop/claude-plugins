#!/usr/bin/env bash
# (c) Shrix
# author: shrix
# warn-secrets-output.sh — PostToolUse notice for Bash|Read|Grep.
#
# The three scan-secrets-* hooks guard INPUTS: a pasted prompt, a Write/Edit,
# an env-dump Bash command. Nothing guards OUTPUT — a credential sitting in a
# file you read, or in command stdout, reaches the model unfiltered.
#
# This hook CANNOT fix that. The hook schema has updatedInput for PreToolUse
# but no updatedOutput anywhere, so by the time a result exists it is already
# in context. What it can do is TELL YOU, so a leaked key becomes a rotation
# you know about rather than one you don't.
#
# Reports the FAMILY only, never the value — printing the secret to warn about
# the secret would defeat the point and would itself land in the transcript.
#
# Warns ONCE per family per session: re-warning on every grep over a file that
# contains a key turns the signal into wallpaper.
#
# Fails open (exit 0) on any error — a warning hook must never wedge a tool.
# pipefail stays OFF: grep -q exits on its first match, printf then takes
# SIGPIPE, and pipefail would turn that match into a miss on large input.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

source "$(dirname "$0")/secret-patterns.sh" 2>/dev/null || exit 0
[ -z "${SECRET_VALUE_PATTERN:-}" ] && exit 0

INPUT=$(cat)

BODY=$(printf '%s' "$INPUT" | jq -r '.tool_response // empty | tostring' 2>/dev/null || true)
[ -z "$BODY" ] && exit 0

# Fast path first: most results contain nothing, and this hook runs on every
# Bash/Read/Grep. Only pay for family extraction once a match is confirmed.
printf '%s' "$BODY" | grep -Eq -e "$SECRET_VALUE_PATTERN" || exit 0

family() {
  case "$1" in
    sk-ant-*)          echo "Anthropic" ;;
    sk-proj-*|sk-svcacct-*|sk-admin-*) echo "OpenAI" ;;
    ghp_*|gho_*|ghs_*|ghu_*|ghr_*) echo "GitHub" ;;
    AKIA*|ASIA*)       echo "AWS" ;;
    AIza*)             echo "Google" ;;
    xox*)              echo "Slack" ;;
    glpat-*)           echo "GitLab" ;;
    *PRIVATE*)         echo "private key" ;;
    *)                 echo "credential" ;;
  esac
}

FAMS=$(printf '%s' "$BODY" | grep -Eo -e "$SECRET_VALUE_PATTERN" 2>/dev/null \
       | while IFS= read -r hit; do family "$hit"; done | sort -u)
[ -z "$FAMS" ] && FAMS="credential"

SID=$(printf '%s' "$INPUT" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "a tool"' 2>/dev/null || echo "a tool")

# One family per line — "private key" holds a space, so never word-split FAMS.
# The here-doc keeps the loop in this shell, so NEW survives it.
NEW=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  STATE="${TMPDIR:-/tmp}/cc-secretwarn-${SID}-${f// /-}"
  [ -e "$STATE" ] && continue
  : > "$STATE" 2>/dev/null || true
  NEW="${NEW:+$NEW, }$f"
done <<EOF
$FAMS
EOF
[ -z "$NEW" ] && exit 0

MSG="⚠️  ${NEW} credential pattern reached context via ${TOOL} output. The value is NOT shown here, and no hook can redact a tool result — rotate it if it was live. (once per family per session)"
jq -nc --arg m "$MSG" '{systemMessage:$m}' 2>/dev/null || true
exit 0
