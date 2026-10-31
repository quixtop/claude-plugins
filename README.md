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
