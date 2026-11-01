# ensemble
<!-- author: shrix -->

A Claude Code mod: `/ensemble` opens or closes the project's Ensemble ledger in a side pane — every task grouped by
state (held, running, ready, queued, shipped) or by worker, with its feature, its worker session and its summary.
A press on a task unfolds its details; `Bucket` shows every task on that feature. `⟳` reads the ledger again, `⇅`
switches the grouping.

The ledger is `<git dir>/ensemble/ledger.jsonl` of the project the session runs in, written by the
[`ensemble` script](https://github.com/quixtop/quix/blob/main/sh/ensemble/README.md). The pane opens by itself in
the leader's session — the one that last wrote the ledger — unless you closed it there.

Other mods reach the pane without depending on this one: they read its badge and call `$.ensemble.toggle()`. The
ctxbar mod's icon does both.
