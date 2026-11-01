#!/usr/bin/env bash
# (c) Shrix
# author: shrix
# secret-patterns.sh — single source of truth for secret VALUE signatures.
#
# Sourced by scan-secrets-write.sh (write side: Write|Edit|NotebookEdit),
# scan-secrets-prompt.sh (prompt side: UserPromptSubmit) and
# warn-secrets-output.sh (output side: PostToolUse). Defines ONE variable so
# the three can never drift — update the regex here and all follow.
#
# High-signal secret value signatures:
#   PEM/OpenSSH private-key headers, AWS access keys (AKIA/ASIA),
#   GitHub PAT (classic + fine-grained), Slack tokens,
#   OpenAI sk-/sk-proj-/sk-svcacct-/sk-admin- keys,
#   Anthropic keys (sk-ant-), Stripe live keys (sk_live_/rk_live_),
#   SendGrid (SG.), GitLab PAT (glpat-), npm tokens (npm_),
#   Google API keys (AIza...) + OAuth client secrets (GOCSPX-), JWTs,
#   OpenRouter (sk-or-v1-) and Langfuse (sk-lf-) secret keys.
# push and pushlog keep verbatim copies of this pattern;
# ~/.agents/tests/skills/pushlog/test_secret_patterns.sh fails when they differ.
#
# The bare sk- rule must not fire after a LOWERCASE letter: unanchored it
# matched any word ending in "sk" (task-, risk-, disk-) followed by 32+
# letters or digits, and blocked ordinary prompts. Exclude only [a-z], and
# keep catching the common escapes that end in a lowercase letter — \n \r \t,
# a URL-encoded %xx and an ANSI colour code. The gap: a key straight after a
# lowercase letter ("foosk-…"), which includes rarer escapes such as \f, \b,
# \x3d and \u000b.
# The sk-svcacct-/sk-admin- rule needs no anchor: it requires OpenAI's marker
# T3BlbkFJ (base64 "OpenAI") inside the key, as gitleaks' openai-api-key rule
# does, so prose and slugs that spell the prefix ("feature/sk-admin-panel-…")
# cannot match, and a key glued to any character still does. Payload lengths
# on each side are open-ended, since real keys vary.
SECRET_VALUE_PATTERN='-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|github_pat_[0-9A-Za-z_]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|(^|[^a-z]|\\[nrt]|%[0-9A-Fa-f]{2}|\[[0-9;]*m)sk-[A-Za-z0-9]{32,}|sk-(svcacct|admin)-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|(sk|rk)_live_[0-9A-Za-z]{16,}|SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|glpat-[0-9A-Za-z_-]{20,}|npm_[0-9A-Za-z]{36,}|AIza[0-9A-Za-z_-]{35}|GOCSPX-[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{30,}|sk-or-v1-[0-9a-f]{64}|sk-lf-[0-9a-f]{8}-[0-9a-f-]{12,}'
