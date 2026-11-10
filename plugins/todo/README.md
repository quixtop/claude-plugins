# todo
<!-- author: shrix -->

A Claude Code mod: a docked task pane over the session's project list (`<project root>/.claude/todo.md`) — add, tick,
rename, reorder and delete, with Gmail- and vi-style keys — and the `/todo` command. A bare `/todo` opens or closes the pane; `/todo <words>` runs them
as the todo skill does (`add`, `remove`, `completed`, …) and answers with its output.

The pane reads and writes the list only through the todo skill's `todo.py`, and the skill lives inside the mod, at
`skills/todo/`: one plugin, one `/todo`.

Other mods reach the pane without depending on this one: they read its `badge` (`available`, `open`, `pending`) and
call `$.todo.toggle()`. The ctxbar mod's task icon does both.
