#!/usr/bin/env bash
# (c) Shrix
# author: shrix
# scan-secrets-bash.sh — PreToolUse guard for Bash.
#
# Denies a Bash command that looks like it dumps ENVIRONMENT VARIABLES, where
# real secrets often live. The filesystem sandbox guards secret FILES but not
# process env, and the permission deny list only blocks the literal `env` /
# `printenv` commands — this closes the interpreter/echo idioms they miss
# (python/node/deno/bun/ruby/perl env access, export -p, declare -p,
# compgen -e, /proc/self/environ, echo $X_KEY). The $VAR match is
# case-sensitive and anchored to the end of the name, so $monkey and
# $PUBLIC_KEY_PATH do NOT trip it while $API_KEY does.
#
# It is a SPEED BUMP, not a wall: an obfuscated dump can still slip. Patterns
# are anchored to keep false positives low. Fails open on its own error.
# pipefail stays OFF: grep -q exits on its first match, printf then takes
# SIGPIPE, and pipefail would turn that match into a miss on large input.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -z "$CMD" ] && exit 0

# Env-dump idioms. Interpreter code is denied only for a WHOLE-env dump or a
# read of a secret-named variable — os.environ.get('VIRTUAL_ENV') and a
# grep for "process.env" run. `env` / `printenv` piped or redirected anywhere
# count as a dump (the permission deny only stops the bare command).
DUMP_INTERP='(print|pprint|dumps|repr|str)\([^)]*os\.environ([^.[A-Za-z0-9_]|$)|os\.environ\.(items|keys|values)\(|os\.environ\._|(console\.log|JSON\.stringify|Object\.(keys|entries|values))\([^)]*process\.env([^.[A-Za-z0-9_]|$)|(^|[^A-Za-z0-9_])(p|pp|puts|print)[[:space:](]+ENV([^[A-Za-z0-9_]|$)|ENV\.(to_h|to_a|each|keys|values|inspect)|%ENV'
# A bare reference to the whole env inside one interpreter call (up to the next
# & or |) — `node -p process.env`, `e=os.environ; print(e)`, `for (k in
# process.env)` — read on a copy where `**os.environ` (copying the env into a
# child's) is masked first. Inside a quoted code argument the scan runs to the
# closing quote, so a `||` or `&&` in the code does not end it.
DUMP_BARE='(python3?|node|deno|bun|perl)[[:space:]][^&|]*(process\.env|os\.environ)([^.[A-Za-z0-9_]|$)|(python3?|node|deno|bun|perl)[[:space:]][^&|'"'"'"]*('"'"'[^'"'"']*|"[^"]*)(process\.env|os\.environ)([^.[A-Za-z0-9_]|$)|ruby[[:space:]][^&|]*ENV([^[A-Za-z0-9_.]|$)|ruby[[:space:]][^&|'"'"'"]*('"'"'[^'"'"']*|"[^"]*)ENV([^[A-Za-z0-9_.]|$)'
DUMP_NAMED='(os\.environ(\.get\(|\[)|process\.env(\.|\[)|ENV\[|getenv\()[^)]{0,3}([A-Za-z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)|KEY|TOKEN|SECRET|PASSWORD|APIKEY|[A-Za-z0-9_]*_APIKEY)([^A-Za-z0-9_]|$)'
# env/printenv as the dumping command: optional wrappers (each with its own
# flags and numbers, e.g. `timeout 5`, `nice -n 10`), then only flags,
# -u NAME pairs or redirects, then the end of the command (no program to run).
DUMP_ENVCMD='(^|[;&|({`]|\$\()[[:space:]]*((command|exec|sudo|nohup|time|xargs|nice|timeout|caffeinate|stdbuf|(/usr/bin/)?env)([[:space:]]+(-[A-Za-z0-9=-]+|[0-9.]+[smhd]?))*[[:space:]]+)*(/usr/bin/)?(env|printenv)([[:space:]]+(-u[[:space:]]+[A-Za-z_][A-Za-z0-9_]*|-[A-Za-z0-9-]+|[0-9]?>&?[0-9]*|<[^[:space:]|;&]*))*[[:space:]]*($|[|;&>)`])'
DUMP="$DUMP_INTERP|$DUMP_NAMED|$DUMP_ENVCMD|"'export[[:space:]]+-p|declare[[:space:]]+-x?p|compgen[[:space:]]+-e|/proc/self/environ|(echo|printf)[[:space:]].*\$\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)([^A-Za-z0-9_]|$)|awk.*ENVIRON|(^|[;&|[:space:]/])ps[[:space:]][^;&|]*-[a-zA-Z]*E|(^|[;&|[:space:]/])ps[[:space:]]+[a-zA-Z]*e[a-zA-Z]*([[:space:]]|$)|(^|[;&|({]|(then|do|else|!|builtin|command|eval)[[:space:]])[[:space:]]*(export|typeset|declare|set)[[:space:]]*($|[;&|)}]|[0-9]?>)|(typeset|declare)[[:space:]]+-[a-zA-Z]*[xp][[:space:]]*($|[;&|)}>])|(typeset|declare)[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-[a-zA-Z]*p|-[a-zA-Z]*c[[:space:]]+['"'"'"]?([^'"'"'"]*[;&|][[:space:]]*)?(set|export|env|printenv|typeset|declare)([[:space:]]+-0)?['"'"'"]?[[:space:]]*($|[;&|)])'

CMDX=$(printf '%s' "$CMD" | sed 's/\*\*os\.environ/**OSENV/g')
if printf '%s' "$CMD" | grep -Eq -e "$DUMP" || printf '%s' "$CMDX" | grep -Eq -e "$DUMP_BARE"; then
  REASON='Blocked by scan-secrets-bash hook: this command looks like it dumps environment variables (where secrets often live). If it is intentional and safe, run it yourself in the terminal.'
  jq -nc --arg r "$REASON" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
fi

exit 0
