# ctxbar
<!-- author: shrix -->

A Claude Code mod: the context window as one row above the prompt, a colour per category, opened by the plan's
weekly usage and its reset countdown. Hover a segment or a figure for its name. While work runs, the row becomes a
running bar with a lane per task: the turn, background shells, subagents. `/ctxbar` shows or hides it, and it steps
aside while another mod draws above the prompt.

Two icons join the row when their mods are loaded; ctxbar needs neither:
- **todo** — a task icon with the pending count opens or closes the todo mod's Tasks pane; `/ctxbar tasks` does
  the same at any width.
- **ensemble** — in a project with an Ensemble ledger, its icon opens the ensemble mod's pane.

Options (the plugin's settings): the widest a running task's pill gets (100 px), the room either side of its name
(8 px), and how many seconds the lane's wave takes to cross (4.8).
