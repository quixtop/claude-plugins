# check-on-edit

Validates a Claude Code extension the moment Claude edits it: a skill, hook, rule or command file under
`~/.agents/skills`, `~/.claude/skills`, `~/.claude/hooks`, `~/.claude/rules` or `~/.claude/commands`. It checks
YAML frontmatter, shell syntax by the shebang, Python, JSON and JavaScript, and a failure goes straight back to
Claude so the broken file is fixed in the same turn. Edits anywhere else return at once.

```
claude plugin marketplace add quixtop/claude-plugins && claude plugin install check-on-edit@quixtop
```

Needs the `tune` skill (its `scripts/snapshot.py`, in `~/.agents/skills/tune` or `~/.claude/skills/tune`), `jq` at
`/usr/bin/jq` (macOS 15 and later ship it) and `/usr/bin/python3` (on a Mac without the Command Line Tools, the
first check asks to install them). Without them it does nothing.
