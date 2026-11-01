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
    }
  }
}
