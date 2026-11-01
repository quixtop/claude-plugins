// (c) Shrix
// author: shrix
// ctxbar's state contract: what the bar draws from, the plan's weekly usage window, and whether
// it is hidden.
export type Slice = {
  name: string
  short: string // the hover label's name: a word or two
  tokens: number // as drawn: the reserve and free space are clamped to the window
  kind: 'used' | 'free' | 'buffer'
  colour: string
}

export type Reading = {
  slices: Slice[] // used rows first, then free space, then the compaction reserve
  window: number // the window measured against
  percent: number // tokens in use over the window, as a whole percentage
}

// The plan's usage window the row's left end shows: the 7-day one.
export type Limit = {
  window: '7d'
  percent: number // whole percent of the window used
  reported?: number // the percent as the engine reported it, to a tenth: what `percent` rounds
  resetsAt?: number // ms since the epoch; absent when the engine gave no reset time
  at?: number // ms since the epoch a response just in reported it; absent when its age is unknown (a reading read again)
}

// The branch's diff as a pull request would hold it: lines added and removed against its base,
// edits not yet committed included.
export type Diff = { added: number; removed: number }

// What is running now, as the running row shows it. `since` is null exactly when the bar is
// down: nothing runs and no task that just ended is on show (work.ts settles it).
export type Work = {
  since: number | null // ms since the epoch the running began
  inTurn: boolean // a main turn is under way
  turnSince: number | null // ms since the epoch the main turn began; null between turns
  tool: string | null // the main loop's tool call in flight
  target: string | null // what that call works on, in a few words (work.ts targetOf); null with none
  steps: number // the main turn's tool calls so far
  shells: Running[] // background shells still running (a monitor is no task)
  agents: Running[] // subagents still running
  finished: Finished[] // tasks that just ended, shown done for a moment before their lane goes
  stopped: string[] // subagents whose stop went through, while the engine's list still calls them live
  asks: Ask[] // what is put to the person and still open: one per call waiting on their answer
  agentCalls: AgentCall[] // Agent calls open: whoever made one waits on the subagent it started
  pausedSince: number | null // ms since the epoch the running time stopped: waiting, and nothing else moving
  waited: number // ms the running time stood still in this run, in stops that have ended (an open one counts from pausedSince)
}

// One call waiting on the person: a permission prompt or a question open. `who` asks ('main' or a
// subagent's id); `call` is the call's id, or null when the prompt matched no call in flight (the
// mod reloaded meanwhile): then any call from the same caller ending closes it.
export type Ask = { who: string; tool: string; call: string | null }

// An Agent call in flight: `who` made it ('main' or a subagent's id); `call` is its id.
export type AgentCall = { who: string; call: string }

// A task that just ended: its lane shows it done until `endedAt` plus a few seconds.
export type Finished = {
  key: string // the lane it had
  kind: 'inline' | 'agent' | 'shell'
  label: string
  since: number
  endedAt: number
  hue?: number // the colour it had, kept to the end
}

// One background shell or subagent: its id, a few words for it, since when it runs, its
// tool calls so far, and its colour (work.ts's HUES), given once when settled and kept. A
// subagent's call in flight: its tool, what it works on, and its id (so only its own end clears
// it), and since when its pill's words have stood (`doingSince`, ms since the epoch); a shell's
// `target` is the command it runs, where its label is its description.
export type Running = {
  id: string; label: string; since: number; steps: number; hue?: number
  tool?: string; target?: string; call?: string; doingSince?: number
}

// What `todo.py --json` prints (spec docs/spec/ctxbar-task-panel.md § 4.4, 4.7).
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
  inFlight: string[] // row keys (and `folder:<label>`) with an edit queued: drawn dim, take no press
  showCompleted: boolean
  shown: number // pending rows shown before "show more"
  shownDone: number // completed rows shown before "show more"
  renaming: { key: string; draft: string } | null
  folderDraft: string | null // '' while the new-folder field is open (its text lives in the Input), null while closed
  folderRename: { label: string; draft: string } | null
  confirmDelete: string | null // the folder label whose delete asks
  adding: boolean // the add field is open: the title row's + opens it, the + again or Esc closes it
  addAt: { id: string; where: 'below' | 'above' } | null // o / b: the add field opens under or over this task (its `folder\0title\0nth`), not at the top
  picking: boolean // the folder list is open under the title: it or its ▼ opens and closes it, a pick closes it
  touched: string | null // the key of the open field typed in since it opened: only then does its ✓ show
  selected: string | null // the task j / k landed on (`folder\0title\0nth`): highlighted, its icons shown; t r i a dd o b and Enter act on it
  addDraft: string // the add field's text, put back after a failed add
  adds: number // successful adds: the add field's key, so a new, empty field follows each one
  readAt: number // ms since the epoch of the last read
}

declare module 'claude-code' {
  interface PluginState {
    ctxbar: {
      reading: Reading | null
      isHidden: boolean
      limits: Limit[] // the 7-day window; empty off a subscription or before the first reply
      diff: Diff | null // the branch's diff; null outside a repository or with nothing changed
      now: number // ms since the epoch the countdowns and the running time are read against
      redrawAt: number // ms since the epoch the desktop row was last asked to draw anew: only when what it shows changes
      work: Work
      tasksOpen: boolean // the task pane is drawn; the icon draws normal, else dim
      tasksPending: Shaped<{ total: number; by: Record<string, number> } | null> // pending tasks at the last read, in all and by folder label, for the icon's tag; null before one
      tasksFolder: string | null // the selected folder's label; null, or one gone (an earlier build's All, ''): the pane shows the first folder, the icon's tag counts all
      tasksView: Shaped<TasksView>
      tasksFocus: string | null // the element key the pane's focus ring holds; read only on a key press
      tasksTop: Shaped<{ top: number; at: number; n: number } | null> // the list's first entry when the pane moved it, the engine's window then, and its number
      tasksSent: Shaped<Record<string, number>> // the tasks sent this session (folder, title, copy) → prompts their tint has left
      tasksColours: Record<string, number> // folder name (trimmed, lower case) → its HUES index; kept in $.store too
    }
  }
}
