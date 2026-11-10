// (c) Shrix
// author: shrix
// todo's contract: what `todo.py --json` prints, the task pane's state, the badge another mod's icon reads, and the
// noun `$.todo` (spec ~/.agents/skills/ctxbar/docs/spec/ctxbar-task-panel.md § 4.4, 4.7).

// What `todo.py --json` prints.
export type Item = { key: string; title: string; done: boolean; nth: number }
export type FolderView = { name: string; label: string; pending: number; done: number; items: Item[] }
export type TaskState = {
  version: 1
  path: string
  state: 'list' | 'nofile'
  mtimeMs: number | null
  size: number | null
  folders: FolderView[]
  undo?: string // from a save that wrote: what `todo.py --json undo --token=` takes to put it back
}
export type ErrorKind = 'input' | 'read' | 'write' | 'busy' | 'conflict' | 'internal' | 'process' | 'version'
export type TaskError = { kind: ErrorKind; error: string; state?: TaskState }

// The task pane's view (spec § 4.5, A3, A12, A19): what todo.py last answered and what the
// person is doing in the pane.
export type TasksView = {
  result: TaskState | TaskError | null // null: reading…
  editError: string | null // the inline line after a failed edit, until the next good one
  pinned: { id: string; done: boolean }[] // ticked/unticked rows held in place 10 s (A19): `folder\0title\0nth` and the state the edit left; one whose task changed state again is let go
  inFlight: string[] // row keys with an edit queued: drawn dim, take no press
  showCompleted: boolean
  shown: number // pending rows shown before "show more"
  shownDone: number // completed rows shown before "show more"
  renaming: { key: string; draft: string } | null
  adding: boolean // the add field is open: the title row's + opens it, the + again or Esc closes it
  addAt: { id: string; where: 'below' | 'above' } | null // o / b: the add field opens under or over this task (its `folder\0title\0nth`), not at the top
  shape: string | null // the open field's key, its rows and whether it holds text, as typing last left them: a change redraws its height and its ✓
  search: string | null // the search bar across the title row: null closed, else its text (spec todo-search.md FR2)
  selected: string | null // the task j / k landed on (`folder\0title\0nth`): highlighted, its icons shown; t r i a dd o b and Enter act on it
  addDraft: string // the add field's text, put back after a failed add
  adds: number // successful adds: the add field's key, so a new, empty field follows each one
  readAt: number // ms since the epoch of the last read
}

// What another mod (ctxbar's task icon) sees of the pane: the mod is here, the pane up or not, and the pending tasks at
// the last read (null before one).
export type TodoBadge = {
  available: boolean
  open: boolean
  pending: { total: number } | null
}
// `$.todo.toggle()`: opens the task pane, or closes it when it is up, as a bare `/todo` does; answers the badge after
export type Todo = { toggle: () => Promise<TodoBadge> }

declare module 'claude-code' {
  interface EngineInterface { todo: Todo }
  interface PluginState {
    todo: {
      tasksOpen: boolean // the task pane is drawn
      tasksPending: Shaped<{ total: number } | null> // pending tasks at the last read; null before one
      tasksView: Shaped<TasksView>
      tasksFocus: string | null // the element key the pane's focus ring holds; read only on a key press
      tasksTop: Shaped<{ top: number; at: number; n: number } | null> // the list's first entry when the pane moved it, the engine's window then, and its number
      tasksColours: Shaped<Record<string, number>> // a project's task file path → its HUES index; kept in $.store too (`projectColours`)
      badge: TodoBadge // what another mod's icon reads (ctxbar's) — kept current on every open, close and read
    }
  }
}
