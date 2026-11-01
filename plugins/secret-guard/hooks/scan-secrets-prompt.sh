#!/usr/bin/env bash
# (c) Shrix
# author: shrix
# scan-secrets-prompt.sh — UserPromptSubmit guard.
#
# Blocks a submitted prompt that contains a recognizable SECRET VALUE
# (private-key block, provider token). On a match it exits 2, which makes
# Claude Code BLOCK AND ERASE the prompt — it is never added to the
# conversation, context, or session transcript. This is the read-IN mirror of
# scan-secrets-write.sh's write-OUT guard, sharing the same pattern file so a
# pasted key can't (a) reach the model, or (b) land in a transcript that might
# later be committed. The block message names what matched — its first 4
# characters and its length, never the value.
#
# Fails open (exit 0) on any of its own errors — never wedges your input.
# pipefail stays OFF: grep -q exits on its first match, printf then takes
# SIGPIPE, and pipefail would turn that match into a miss on large input.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

source "$(dirname "$0")/secret-patterns.sh" 2>/dev/null || exit 0
[ -z "${SECRET_VALUE_PATTERN:-}" ] && exit 0

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
[ -z "$PROMPT" ] && exit 0

if printf '%s' "$PROMPT" | grep -Eq -e "$SECRET_VALUE_PATTERN"; then
  # Name what matched — its first 4 characters and its length, never the
  # value — so a false positive is visible without a hunt. The anchored bare
  # sk- rule captures what precedes the key (one character, \n, %xx or an ANSI
  # colour code); drop it before slicing. Keep these cases in step with that
  # rule's group in secret-patterns.sh.
  HIT=$(printf '%s' "$PROMPT" | grep -Eo -e "$SECRET_VALUE_PATTERN" 2>/dev/null | head -n 1)
  case $HIT in
    \[*msk-*)    HIT=sk-${HIT#*msk-} ;;
    %??sk-*)     HIT=${HIT#%??} ;;
    \\[nrt]sk-*) HIT=${HIT#??} ;;
    ?sk-*)       HIT=${HIT#?} ;;
  esac
  WHAT=""
  [ -n "$HIT" ] && WHAT=" It matched '${HIT:0:4}…' (${#HIT} chars)."
  echo "Blocked: your message looks like it contains a real secret value (API key / private key / token).${WHAT} It was NOT processed or stored in the transcript. Remove the secret — use a placeholder or a secret-manager reference — and resend." >&2
  exit 2
fi

exit 0
