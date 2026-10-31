// One ledger row, as the `ensemble` CLI writes it (~/.claude/rules-ref/sessions.md § The ledger).
export type Row = {
  id: string
  feature: string
  task: string
  origin?: string
  worker?: string | null
  state: 'queued' | 'running' | 'ready' | 'shipped' | 'held'
  started?: string
  updated: string
  paths?: string[]
  shas?: string[]
  spec?: string
  session?: string
  summary?: string
}

// What the pane draws: the rows, when they were read, and why a read failed (empty when it did not).
export type View = { rows: Row[]; readAt: string; problem: string }

// How the pane is looking at them: grouped by state or by worker, the feature whose bucket is open (or none), and the
// one task whose details are unfolded in the list (or none; absent in what an older version stored — read as none).
// `collapsed`: the group keys (a state, or a worker) folded to their heading (absent in an older store — none folded).
// `top`: the first list item the pane's own window shows, a heading or a task (absent — the top).
export type Look = { by: 'state' | 'worker'; feature: string | null; open?: string | null; collapsed?: string[]; top?: number }

// What another mod (ctxbar's icon) sees of the Ensemble: a ledger to show, the pane up or not, and the progress words
export type EnsembleBadge = { available: boolean; open: boolean; progress: string }
// `$.ensemble.toggle()`: opens the pane, or closes it when it is up (a close by the person: the session start no
// longer reopens it); answers the badge after
export type Ensemble = { toggle: () => Promise<EnsembleBadge> }

declare module 'claude-code' {
  interface EngineInterface { ensemble: Ensemble }
  interface PluginState {
    // tick: bumped once a minute while the pane is placed, so its relative times age (a redraw, never a ledger read)
    // dismissed: the person closed the pane this session, so the session start no longer opens it by itself
    // badge: what another mod's icon reads (ctxbar) — kept current on every ledger read, open and close
    ensemble: { view: View; look: Look; tick: number; dismissed: boolean; badge: EnsembleBadge }
  }
}
