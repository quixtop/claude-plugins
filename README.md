# quixtop — Claude Code plugins

Plugins for [Claude Code](https://claude.com/claude-code) from [quixtop](https://www.quixtop.com).

## Add the marketplace

In Claude Code:

```
/plugin marketplace add quixtop/claude-plugins
```

To pick up newer versions: `/plugin marketplace update quixtop`.

## ctxbar — the context window above the prompt

The context window as one row above the prompt, a colour per category, with the plan's weekly usage and its reset
countdown; while work runs, a lane per task. A task icon opens a pane over your `/todo` list.

```
/plugin install ctxbar@quixtop
```

`/ctxbar` shows or hides it. The task pane needs the [todo](https://www.quixtop.com/apps) skill.

## ensemble — the Ensemble ledger in a side pane

`/ensemble` opens or closes the project's Ensemble ledger in a side pane: what runs where, by feature.

```
/plugin install ensemble@quixtop
```

Needs the `ensemble` CLI from the [quixtop apps page](https://www.quixtop.com/apps).

## secret-guard — secret values never leave the conversation

Blocks a prompt or a file write that carries a private key or a provider token, blocks shell commands that dump the
environment or echo a secret-named variable, and warns when a tool's output shows one. Needs `jq` at `/usr/bin/jq`.

```
/plugin install secret-guard@quixtop
```

## check-on-edit — a broken skill or hook is caught as it is written

Validates a skill, hook, rule or command file the moment Claude edits it and shows Claude any failure at once.
Needs the `tune` skill, `jq` at `/usr/bin/jq` and `/usr/bin/python3`.

```
/plugin install check-on-edit@quixtop
```
