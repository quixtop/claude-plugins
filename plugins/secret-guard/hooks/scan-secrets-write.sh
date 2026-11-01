#!/usr/bin/env bash
# (c) Shrix
# author: shrix
# scan-secrets-write.sh — PreToolUse guard for Write|Edit|NotebookEdit.
#
# Blocks the tool call when the content being written contains a recognizable
# SECRET VALUE (private-key blocks, cloud/provider tokens). The read side is
# covered by permissions.deny/ask + the sandbox; this closes the write side so
# a secret that slips into context can't be persisted into a project file.
#
# Matches value FORMATS (not bare variable names) to keep false positives low.
# On a match it returns a PreToolUse "deny" decision; otherwise it stays silent
# and exits 0 (allow). Never blocks on its own errors (fails open by design —
# the read-side controls are the real boundary; this is the belt over braces).
# pipefail stays OFF: grep -q exits on its first match, printf then takes
# SIGPIPE, and pipefail would turn that match into a miss on large input.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

INPUT=$(cat)
CONTENT=$(printf '%s' "$INPUT" \
  | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.new_source // empty' 2>/dev/null \
  || true)

if [ -z "$CONTENT" ]; then
  exit 0
fi

# Secret value signatures are defined once in the shared pattern file and
# sourced here (the same regex powers the prompt and output hooks). Fail open if it
# is missing so this guard never blocks on its own error.
source "$(dirname "$0")/secret-patterns.sh" 2>/dev/null || exit 0
PATTERN="${SECRET_VALUE_PATTERN:-}"
[ -z "$PATTERN" ] && exit 0

if printf '%s' "$CONTENT" | grep -Eq -e "$PATTERN"; then
  REASON='Blocked by scan-secrets-write hook: this content contains what looks like a real secret value (a private-key block or a provider token). If it is intentional (e.g. a test fixture), write the file yourself in the terminal, or turn off the secret-guard plugin (/plugin).'
  jq -nc --arg r "$REASON" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
fi

exit 0
