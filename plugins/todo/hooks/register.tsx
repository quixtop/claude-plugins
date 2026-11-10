// (c) Shrix
// author: shrix
// todo — the task pane over the /todo file (hooks/tasks.tsx), and `/todo`: bare, it opens or closes the pane; with
// words, todo.py runs them. Another mod (ctxbar's task icon) reads the pane's `badge` and opens or closes it with
// `$.todo.toggle()`; without that mod this one runs exactly as it does with it.
import type { Register } from 'claude-code'

import type { TodoBadge } from '../types'
import { NO_BADGE, registerTasks, tasksSessionStart, tasksTurnEnd, todoCommand, toggleBadge } from './tasks'

export const register: Register = on => {
  registerTasks(on) // the task pane (hooks/tasks.tsx): one hooks module per plugin, so it is imported

  // `$.todo.toggle()` for another mod's icon. The noun built here has no `$` — none exists yet — so it is only the
  // bottom of its chain; this mod's own `todo.toggle` hook below does the work
  on('engine.create', async (_, e, next) => ({
    ...(await next(e)),
    todo: { toggle: async (): Promise<TodoBadge> => NO_BADGE },
  }))
  on('todo.toggle', async $ => ({ value: await toggleBadge($) }))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'todo', description: 'Open or close the task pane; with words, run them as the todo skill does (add, remove, completed, …)',
      argumentHint: '[add|remove|completed|uncheck|clear|search …]', immediate: true,
    }).catch(() => undefined)
    await tasksSessionStart($).catch(() => undefined) // the pane's state again, a reload of the mod included
    return started
  })

  // A main turn's end: an open pane reads the file again; never holding the turn up.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) void tasksTurnEnd($).catch(() => undefined)
    return done
  })

  on('command.run', { command: 'todo' }, async ($, e) => todoCommand($, e.args))
}
