// (c) Shrix
// author: shrix
// /ensemble — the project's Ensemble ledger in a side pane: every task grouped by state (or by worker), each with its
// feature, its worker session and its summary.
// Text is monospaced; what takes a press is a Button, which the app draws in its own font (a desktop styles whatever a
// Button holds — owner 30Oct26, img 5): the group bars, a task's feature, Bucket, All tasks, and the two icons.
// A top row: the progress, always whole ("77% shipped · 1 working"), at the left, and two icons at the right — ⟳
// refresh and ⇅ sort (the grouping, state or worker); the title stays "Ensemble". Each group bar carries its name and
// count; a state bar is a band in its colour, its name and count in black bold, and pressing it folds or opens the group.
// A task is ONE line — its state's dot at the left, its feature (the press), its task dim, how long it has run or when
// it changed, and its worker; pressing the feature unfolds its details under it (its summary, every fact the ledger
// holds, and "Bucket" to its feature's bucket — every task on that feature); pressed again it folds, and one task
// unfolds at a time (owner 29Oct26, img 19: one line, details on a click, never on hover). Times read relative ("12 min ago",
// "yesterday", a rolling 24–48 h), by the engine clock, redrawn once a minute while the pane is placed; a future time
// reads "just now".
// The pane opens by itself in the LEADER alone (owner 29Oct26; a mod cannot add a row to the app's own pane menu or a
// top-bar icon, so this is the no-typing way in): the `ensemble` CLI writes the ledger from the leader only, so the
// session that runs `ensemble add|set` is marked the leader of its project (in `$.store`, by session id — a resumed
// session keeps it) and opens the pane then and at its every start. Closed by the person, it stays closed for the rest
// of that session. Every other session — and the leader any time — opens it with `/ensemble`.
// The ledger is <git dir>/ensemble/ledger.jsonl of the folder the session runs in (the `ensemble` CLI writes it; the
// leader alone). Read-only. No file watch exists in this API, so the pane re-reads on events — the session starting,
// each prompt, any Bash call that ran `ensemble`, and its own ↻ — never on a timer.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, Timer } from 'claude-code'

import type { EnsembleBadge, Look, Row, View } from '../types'

const PANE = 'ensemble'
const view = atom({ plugin: 'ensemble', key: 'view' } as const, { rows: [], readAt: '', problem: '' } as View)
const look = atom({ plugin: 'ensemble', key: 'look' } as const, { by: 'state', feature: null } as Look)
// bumped once a minute so "12 min ago" ages while the pane sits open — a redraw only: the ledger is never read on a timer
const tick = atom({ plugin: 'ensemble', key: 'tick' } as const, 0)
// the person closed the pane this session: the session start (a hot reload runs it again) no longer reopens it
const dismissed = atom({ plugin: 'ensemble', key: 'dismissed' } as const, false)
// what another mod's icon reads (ctxbar, owner 30Oct26): written on every ledger read, open and close — never derived by
// the reader, so the progress words stay this mod's alone
// the badge before the first read, and the noun's answer when no hook of this mod serves it
const NO_BADGE: EnsembleBadge = { available: false, open: false, progress: '' }
const badge = atom({ plugin: 'ensemble', key: 'badge' } as const, NO_BADGE)
// a change only: the reader's row is drawn again on every write, and a desktop drawing restarts its pictures (review
// 30Oct26), so a reload that changed nothing writes nothing
async function setBadge($: EngineInterface, change: Partial<EnsembleBadge>): Promise<void> {
  const cur = await read($, badge)
  if (Object.entries(change).every(([k, v]) => cur[k as keyof EnsembleBadge] === v)) return
  await update($, badge, now => ({ ...now, ...change }))
}
const MINUTE_MS = 60_000
// the one minute timer: started while the pane is placed, stopped once it is not; never two (a hot reload cancels the
// old module's timers itself, and a second start while one runs is a no-op)
let ticking: Timer | null = null
async function paneUp($: EngineInterface): Promise<boolean> {
  try { return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced) } catch { return false }
}
function startTick($: EngineInterface): void {
  if (ticking) return
  const timer: Timer = $.clock.every(MINUTE_MS, () => {
    void (async () => {
      if (!(await paneUp($))) { timer.cancel(); ticking = null; return }   // the pane went: no more redraws
      await update($, tick, n => n + 1)
    })()
  })
  ticking = timer
}
// held FIRST — the one state that needs the owner (design review, owner 30Oct26)
const ORDER: Row['state'][] = ['held', 'running', 'ready', 'queued', 'shipped']
// a task's dot and the ONE caption-size space after it — the same gap as "● running" in a heading (owner 29Oct26: one
// dot-to-text gap on every line); a no-break space, so no surface trims it
const DOT = '● '
// the theme's own colours, one per state, none of them the dim grey the text uses (owner 29Oct26: shipped in grey blended
// in): at work · waiting to ship · waiting to start · stopped · done — `merged`, the purple git draws a landed change in
const TONE: Record<Row['state'], Color> = { running: 'success', ready: 'suggestion', queued: 'warning', held: 'error', shipped: 'merged' }
// A state's heading in Title Case — "Running" — in the app's own font (owner 30Oct26: one uniform font; Unicode small
// capitals came from a fallback font and broke it)
const titleCase = (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()
// a bar's press face: no-break spaces wider than any pane, clipped to the bar, so the Button shows nothing yet spans it
const BLANK = ' '.repeat(240)
// progress in words: how much has shipped and how many named workers are at work
function progress(rows: Row[]): string {
  if (!rows.length) return ''   // a bucket emptied by a reload: nothing to measure
  const done = rows.filter(r => r.state === 'shipped').length
  const atWork = new Set(rows.filter(r => r.state === 'running' && r.worker).map(r => r.worker)).size   // named workers only
  return `${Math.floor((done / rows.length) * 100)}% shipped${atWork ? ` · ${atWork} working` : ''}`
}
// open (or bring up) the pane; the progress rides its first heading, never the title (owner 30Oct26)
async function show($: EngineInterface): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Ensemble' })
  if (opened.isPlaced) startTick($)
  await setBadge($, { open: opened.isPlaced })
  return opened.isPlaced
}
// the noun's toggle (ctxbar's icon): up → closed, as the person's close (the session start no longer reopens it);
// down → the ledger re-read and the pane opened. Answers the badge as it wrote it: a read in the same dispatch would
// see the one before (review 30Oct26)
async function togglePane($: EngineInterface): Promise<EnsembleBadge> {
  if (await paneUp($)) {
    const before = await read($, badge)
    await update($, dismissed, () => true)
    await $.ui.close({ id: PANE })
    await setBadge($, { open: false })
    return { ...before, open: false }
  }
  const fresh = await reload($)
  const open = await show($)
  // the person's reopen undoes their close (owner 31Oct26): the session start and the leader's ledger write may open
  // the pane by themselves again
  if (open) await update($, dismissed, () => false)
  return { available: fresh.problem === '', open, progress: progress(fresh.rows) }
}
// The leader's mark, per project root: the session id that last ran a ledger write here. ⚠️ The write must be a
// COMMAND — at the start of the line or after `;` `&` `|` `(`, maybe behind `VAR=x` or a path — never the words inside
// a grep, an echo or a commit message, and never `-h`/`--help`: one such match in a worker would move the mark
const LEDGER_WRITE = /(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*(?:\S*\/)?ensemble\s+(?:add|set)\b(?![^;&|\n]*\s--?h(?:elp)?\b)/
// the command with its heredoc bodies and quoted spans cut out, so text the command only CARRIES — a grep pattern, an
// echo, a commit message — never reads as a command (a quoted path or `"$(ensemble add …)"` is lost: a missed open
// until the next write, never a wrong mark)
const bare = (cmd: string) => cmd
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, ' ')
  .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' ')
const isLedgerWrite = (cmd: string) => LEDGER_WRITE.test(bare(cmd))
const leaderKey = async ($: EngineInterface) => `leader:${await $.session.root()}`
async function isLeader($: EngineInterface): Promise<boolean> {
  try { return (await $.store.get(await leaderKey($))) === (await $.session.id()) } catch { return false }
}
// the ledger's rows, or why there are none
async function load($: EngineInterface): Promise<View> {
  let readAt = ''
  try {
    readAt = new Date(await $.clock.now()).toISOString()
    const git = await $.process.run(['git', 'rev-parse', '--git-path', 'ensemble/ledger.jsonl'])
    if (git.exitCode !== 0) return { rows: [], readAt, problem: 'not a git repo — the Ensemble needs one' }
    const path = git.stdout.trim()
    if (!(await $.fs.exists(path))) return { rows: [], readAt, problem: 'no ledger yet — the leader starts it with `ensemble add`' }
    const text = (await $.fs.read(path)) as string
    const rows: Row[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { return { rows: [], readAt, problem: 'a ledger line is not JSON — run `ensemble show`' } }
    }
    return { rows, readAt, problem: '' }
  } catch (err) {
    return { rows: [], readAt, problem: `could not read the ledger: ${String((err as Error)?.message ?? err).slice(0, 80)}` }
  }
}

// re-read the ledger into the pane's state; the write redraws the pane. Returns what it read, so a caller decides on
// THAT rather than reading the atom back in the same dispatch (a dispatch's reads see one moment, its own write unseen)
// ⚠️ Reloads can overlap (a ↻ during a tool call, two Bash calls at once): one that started before the newest applied
// read is dropped, so an older read never lands last and puts back an older view
// The guard sits INSIDE the updater: `update` retries a write that lost a race, so a check before it could pass and
// still land last. A dropped reload answers the newest view, never its own older read.
let reloads = 0, applied = 0
let latest: View = { rows: [], readAt: '', problem: '' }
async function reload($: EngineInterface): Promise<View> {
  const seq = ++reloads
  const fresh = await load($)
  if (seq < applied) return latest
  applied = seq
  latest = fresh
  await update($, view, cur => (seq < applied ? cur : fresh))
  const now = seq === applied ? fresh : latest
  await setBadge($, { available: now.problem === '', progress: progress(now.rows) })
  return now
}

const newest = (a: Row, b: Row) => (b.updated || '').localeCompare(a.updated || '')
// an ISO time, relative to `now` (ms): "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the date.
// Anything unreadable — a time an older version stored in another form — is "—".
function ago(iso: string | undefined, now: number): string {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return '—'
  // short (design review, owner 30Oct26): "now", "4m", "3h", "1d" — the date after a week; the room goes to the task
  const min = Math.floor((now - t) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d` : new Date(t).toISOString().slice(0, 10)
}
// the clock time of `iso` in the person's own style, "9.32a", when it is today on this machine's clock, else "" (ctxbar's
// `4.04p`); a date or an hour away reads better as "2 days ago"
function clock(iso: string | undefined, now: number): string {
  const t = new Date(Date.parse(iso || ''))
  if (!Number.isFinite(t.getTime()) || t.toDateString() !== new Date(now).toDateString()) return ''
  const h = t.getHours(), m = String(t.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}.${m}${h < 12 ? 'a' : 'p'}`
}
// how long since `iso`, bare: "12 min", "3 h", "2 days" — a running task's time at work; "" when unreadable
function span(iso: string | undefined, now: number): string {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.floor((now - t) / 60_000))
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

// grouped by state or by worker (who holds what, at work first); EVERY task listed, none folded into "… N more"
// (owner 30Oct26); each group headed by its bold name and its count at the right, one blank line above it
type Group = { key: string; label: string; n: number; color: Color | undefined; rows: Row[] }
function groupsOf(rows: Row[], by: Look['by']): Group[] {
  const groups = by === 'state'
    ? ORDER.map(state => {
        const of = rows.filter(r => r.state === state).sort(newest)
        return { key: state, label: state, n: of.length, color: TONE[state] as Color | undefined, rows: of }
      })
    : [...new Set(rows.map(r => r.worker || '—'))].sort().map(w => {
        const of = rows.filter(r => (r.worker || '—') === w).sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || newest(a, b))
        return { key: w, label: w === '—' ? 'not assigned' : w, n: of.length, color: undefined as Color | undefined, rows: of }
      })
  return groups.filter(g => g.rows.length > 0)
}
// the list as the window walks it: each group's heading, then its tasks unless folded
type Item = { group: Group; row?: Row }
const itemsOf = (groups: Group[], collapsed: string[], by: Look['by']): Item[] =>
  groups.flatMap(g => [{ group: g }, ...(collapsed.includes(`${by}:${g.key}`) ? [] : g.rows.map(row => ({ group: g, row })))])
// The rows an item takes: a heading one and the blank line above it, a task one; an unfolded task at least five (its
// line, `when`, `id`, Bucket, the blank under it), a row per fact it has, the summary a row per 40 characters, and one
// spare for a line the dock wraps — over rather than under, so the window never clips the end (review 30Oct26)
function rowsOf(it: Item, open: string | null): number {
  if (!it.row) return 2
  const r = it.row
  if (r.id !== open) return 1
  return 6 + (r.summary ? Math.ceil(r.summary.length / 40) : 0) + (r.spec ? 1 : 0) + (r.paths?.length ? 1 : 0) + (r.shas?.length ? 1 : 0)
}
// The furthest `top` still fills the window: the items' rows summed from the end until they pass what the window holds
// under the top row and the pinned heading
function lastTop(items: Item[], bodyRows: number, open: string | null): number {
  let room = bodyRows - 2
  for (let i = items.length - 1; i >= 0; i--) {
    room -= rowsOf(items[i]!, open)
    if (room < 0) return i + 1
  }
  return 0
}
// Where a move asked in ROWS takes `top`, an item index (review 30Oct26): the tree's own rows or more (Home, End) go
// to the edge; a page — the window's rows or more — moves by what the window showed under the top row and the pinned
// heading; anything less walks the items' rows. Never past `most`.
function moved(items: Item[], top: number, e: { by: number; bodyRows: number; contentRows: number }, open: string | null, most: number): number {
  if (Math.abs(e.by) >= e.contentRows) return e.by < 0 ? 0 : most
  let rows = Math.abs(e.by) >= e.bodyRows ? Math.abs(e.by) - 2 : Math.abs(e.by)
  let i = Math.min(top, most)
  if (e.by > 0) while (rows > 0 && i < most) rows -= rowsOf(items[i++]!, open)
  else while (rows > 0 && i > 0) rows -= rowsOf(items[--i]!, open)
  return i
}

// The least rows the window's items draw, every line unwrapped: a heading one (two under a gap, after the first), a
// task one, an unfolded task its line, summary, facts (`when` and `id` always), Bucket and the blank under it. A count that never exceeds the
// drawing, unlike `rowsOf`, which errs over
function leastRows(shown: Item[], open: string | null): number {
  return shown.reduce((n, it, i) => {
    if (!it.row) return n + (i > 0 ? 2 : 1)
    const r = it.row
    if (r.id !== open) return n + 1
    return n + 5 + (r.summary ? 1 : 0) + (r.spec ? 1 : 0) + (r.paths?.length ? 1 : 0) + (r.shas?.length ? 1 : 0)
  }, 0)
}

export const register: Register = on => {
  // `$.ensemble.toggle()` for another mod's icon (ctxbar, owner 30Oct26). The noun built here has no `$` — none
  // exists yet — so it is only the bottom of its chain; this mod's own `ensemble.toggle` hook below does the work
  on('engine.create', async (_, e, next) => ({
    ...(await next(e)),
    ensemble: { toggle: async (): Promise<EnsembleBadge> => NO_BADGE },
  }))
  on('ensemble.toggle', async $ => ({ value: await togglePane($) }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ensemble', description: "Open or close this project's Ensemble ledger — what runs where, by feature" })
    const fresh = await reload($)
    // a pane already up (a hot reload) keeps its times ageing, and is opened again under the plain title — one an older
    // version titled "Ensemble · NN% …" would otherwise keep it. The timer starts first: the re-open's answer must not
    // decide it. A failed open never blocks the session start (the catch below).
    if (await paneUp($)) { startTick($); await show($).catch(() => false) }
    // the leader's session opens the pane by itself — when a person sits at it (never `-p` or the SDK), and never once
    // the person closed it this session
    else if (e.isInteractive && fresh.problem === '' && !(await read($, dismissed)) && (await isLeader($))) await show($).catch(() => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // the person's close (the pane's ✕ or its key) keeps it closed for the session; a plugin's or an unload's does not
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, dismissed, () => true)
    if (e.id === PANE) await setBadge($, { open: false })
    return next(e)
  }).catch(($, e, next) => next(e))

  // `/ensemble` toggles, as `/todo` does (owner 31Oct26): the pane up → closed, as the ⧉ icon closes it; down → opened.
  // The reply follows the branch taken, never the badge alone: an open the surface could not place is not "closed"
  on('command.run', { command: 'ensemble' }, async $ => {
    const wasUp = await paneUp($)
    const after = await togglePane($)
    if (wasUp) return { text: 'Ensemble pane closed.' }
    return { text: after.open ? 'Ensemble pane opened.' : 'The Ensemble pane could not open here.' }
  })

  // Neither ever refuses the prompt or the call: a failure here — the catch — hands the event on unchanged (next(e)
  // replays what an earlier call settled to; nothing runs twice).
  on('prompt.submit', async ($, e, next) => {
    void reload($).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // a ledger write that RAN — not refused, not failed (a bad id or option exits non-zero) — marks this session its
    // project's leader, and the leader's pane opens unless the person closed it. The mark is awaited; the reload and the
    // open are not, so the model's tool result never waits on a git run and a file read.
    if (!ran.deny && !ran.isError && isLedgerWrite(e.command)) {
      await $.store.set(await leaderKey($), await $.session.id())
      void (async () => {
        const fresh = await reload($)
        if (fresh.problem === '' && !(await paneUp($)) && !(await read($, dismissed))) await show($)
      })().catch(() => {})   // the next prompt's reload retries; nothing here may surface as an unhandled rejection
    } else if (/\bensemble\b/.test(e.command)) void reload($).catch(() => {})
    return ran
  }).catch(($, e, next) => next(e))

  // The look (owner 29Oct26: "better looking … crisp"): colour only where it means a state, the theme's own keys, dark
  // and light alike; hierarchy by weight, not by boxes — the feature bright, the task dim; one line a task, one blank
  // line between groups; quiet controls, never a full-width button. Every Button keyed, holding strings and Text only.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const l = await read($, look)
    await read($, tick)   // read so the minute's bump redraws the relative times
    const now = await $.clock.now()
    const setLook = (change: Partial<Look>) => { void update($, look, cur => ({ ...cur, ...change })) }

    // a group's bar folds its group (see `heading` below). ⚠️ Toggled from the CURRENT value inside update(), never the render's snapshot: two presses before a redraw
    // each saw the same snapshot, and one toggle was lost (review 30Oct26). Keys carry their
    // grouping (`state:held`, `worker:held`), so a worker named like a state never folds with it.
    const collapsed = l.collapsed ?? []
    // Folding the group the window is inside (its heading pinned) brings that heading to the top: `top` is an item
    // index, and the group's tasks leaving the list would otherwise land it in a later group (review 30Oct26).
    const fold = (key: string) => () => {
      void update($, look, cur => {
        const c = cur.collapsed ?? []
        if (c.includes(key)) return { ...cur, collapsed: c.filter(k => k !== key) }
        const items = itemsOf(groupsOf(v.rows, cur.by), c, cur.by)
        const at = items[cur.top ?? 0]
        const top = at && `${cur.by}:${at.group.key}` === key ? items.indexOf(items.find(it => it.group === at.group)!) : cur.top
        return { ...cur, collapsed: [...c, key], top }
      })
    }
    // ⚠️ A desktop draws whatever a Button holds in its own font and colour — its label or its children alike (img 5:
    // mono, black and small caps inside a Button all came out in the app's white sans). So plain words are monospaced
    // Text, and what takes a press is a Button in the app's font: a bar, a task's feature, Bucket, All tasks, ⟳, ⇅.
    // A bar (owner 30Oct26): the state's light colour, its name and count in BLACK bold Title Case as plain Text — a
    // Button would draw them in the app's white — and no mark. The press is a blank Button laid OVER the whole bar
    // (absolute, edge to edge, its run of no-break spaces clipped to the bar), so a press anywhere on it folds or opens
    // the group. ⚠️ No `label`: a desktop draws the label in place of the children and sizes the Button to it (img 10:
    // "Fold Shipped" in white over the black name, and only that word took the press). A worker bar (by worker) has no colour and keeps the theme's text colour.
    // A terminal paints a press's blank cells over whatever lies under it, so there the name is the press's own child
    // (owner 31Oct26, mod-design rule 6); the count stays plain Text beside it.
    const heading = (key: string, label: string, n: number, color?: Color) => {
      const fk = `${l.by}:${key}`
      const ink = color ? 'black' : undefined
      const name = color ? titleCase(label) : label
      if (e.surface === 'terminal') return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} backgroundColor={color}>
          <Button key={`fold-${key}`} plain onPress={fold(fk)}><Text mono weight="bold" color={ink}>{name}</Text></Button>
          <Text mono weight="bold" color={ink} tabular>{`${n}`}</Text>
        </Box>
      )
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} backgroundColor={color} position="relative">
          <Text mono weight="bold" color={ink}>{name}</Text>
          <Text mono weight="bold" color={ink} tabular>{`${n}`}</Text>
          <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
            <Button key={`fold-${key}`} plain onPress={fold(fk)}>{BLANK}</Button>
          </Box>
        </Box>
      )
    }
    // a state as a small coloured tag, the dot and the word in the state's own colour (grouped by worker, in a task's meta)
    const tag = (state: Row['state']) => <Text mono color={TONE[state]} size="caption" weight="semibold">● {state}</Text>
    // the right edge of a task: when it changed, then who holds it — or, grouped by worker (where the heading already
    // says who), its state's tag. The worker is dim: colour means a state here, never a person.
    const meta = (r: Row) => (
      <Box flexDirection="row" columnGap={2}>
        {r.state === 'running' && span(r.started, now)
          // the one LIVE number — how long it has run — in the running colour, never dim (design review, owner 30Oct26)
          ? <Text mono color={TONE.running} size="caption" tabular>{span(r.started, now)}</Text>
          : <Text mono dimColor size="caption" tabular>{ago(r.updated, now)}</Text>}
        {l.by === 'worker' ? tag(r.state) : <Text mono dimColor size="caption" weight="semibold" tabular>{r.worker || '—'}</Text>}
      </Box>
    )
    const toggle = (r: Row, isOpen: boolean) => () => setLook({ feature: isOpen ? null : r.feature })
    // a list task's press: unfold its details, or fold them if they are the ones open; one task unfolded at a time
    const unfold = (r: Row) => () => setLook({ open: (l.open ?? null) === r.id ? null : r.id })
    // a task's facts, for its unfolded line and its bucket, each a line only when the ledger has it — all one would otherwise open its session for
    const facts = (r: Row): [string, string][] => {
      const out: [string, string][] = []
      const at = clock(r.started, now)
      const times = [r.started ? `started ${at ? `${at}, ` : ''}${ago(r.started, now)}` : '', `changed ${ago(r.updated, now)}`].filter(Boolean).join(' · ')
      const who = [r.worker ? `by ${r.worker}` : 'not assigned', r.origin && r.origin !== r.worker ? `from ${r.origin}` : ''].filter(Boolean).join(' · ')
      out.push(['when', `${times} · ${who}`])
      if (r.spec) out.push(['spec', `spec ${r.spec}`])
      if (r.paths?.length) out.push(['paths', `${r.paths.length === 1 ? 'file' : 'files'} ${r.paths.join(', ')}`])
      if (r.shas?.length) out.push(['shas', `${r.shas.length === 1 ? 'commit' : 'commits'} ${r.shas.join(', ')}`])
      out.push(['id', `${r.id}${r.session ? ` · session ${r.session}` : ''}`])
      return out
    }
    // one task in a list: ONE line — its state's dot, the feature, the task dim, meta, and the › mark at the right end
    // (the press). Pressed, its details unfold under it (the mark turns ⌄): the summary whole, every fact the ledger
    // holds, and "Bucket" with its own › to the feature's bucket.
    // Two columns, so every line under a task starts under its feature on any font (img 16: two spaces were narrower
    // than the dot on the desktop); the dot pinned to the FIRST line (`alignItems: flex-start`), never centred against
    // the unfolded details (owner 29Oct26, img 19).
    const rowOf = (r: Row) => {
      const isOpen = (l.open ?? null) === r.id
      return (
        <Box key={r.id} flexDirection="row" alignItems="flex-start">
          <Text mono color={TONE[r.state]} size="caption">{DOT}</Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
                <Button key={`row-${r.id}`} plain onPress={unfold(r)}>{r.feature}</Button>
                <Text mono dimColor size="caption" wrap="truncate-end">{r.task}</Text>
              </Box>
              <Box flexShrink={0}>{meta(r)}</Box>
            </Box>
            {isOpen ? (
              <Box flexDirection="column" marginBottom={1}>
                {r.summary ? <Text mono dimColor wrap="wrap">{r.summary}</Text> : null}
                {facts(r).map(([k, t]) => <Text mono key={`${r.id}-${k}`} dimColor size="caption" wrap="wrap">{t}</Text>)}
                <Box flexDirection="row">
                  <Button key={`bucket-${r.id}`} plain dimColor onPress={toggle(r, false)}>Bucket</Button>
                </Box>
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    // the top row, above every heading (owner 30Oct26): the progress at the left, ALWAYS whole ("77% shipped · 1
    // working" — never truncated), and two icons at the right: ⟳ refresh and ⇅ sort (switch the grouping between state
    // and worker) — icons alone, no words. All normal, none dim. No read time: every prompt and `ensemble` call re-reads,
    // so it would always say "just now".
    const other: Look['by'] = l.by === 'state' ? 'worker' : 'state'
    const header = (
      <Box key="controls" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
        <Text mono tabular>{progress(v.rows)}</Text>
        <Box flexDirection="row" alignItems="center" columnGap={0} flexShrink={0}>
          <Button key="refresh" plain onPress={() => { void reload($).catch(() => {}) }}>⟳</Button>
          <Button key="by" plain onPress={() => setLook({ by: other, feature: null, top: 0 })}>⇅</Button>
        </Box>
      </Box>
    )

    if (v.problem !== '') return <Box flexDirection="column" rowGap={1}>{header}<Text mono dimColor>{v.problem}</Text></Box>
    if (v.rows.length === 0) return <Box flexDirection="column" rowGap={1}>{header}<Text mono dimColor>The ledger is empty.</Text></Box>

    // a feature's bucket: every task on it, newest first, everything shown and free to wrap. Opened from a scrolled
    // list the engine's window still sits at 1, so the bucket draws the list's slack row while it does (review 31Oct26)
    if (l.feature) {
      const bucket = v.rows.filter(r => r.feature === l.feature).sort(newest)
      return (
        <Box flexDirection="column">
          {e.props.scroll.offset > 0 ? <Box key="slack" height={1} /> : null}
          {header}
          <Box flexDirection="row" alignItems="center" columnGap={2} marginTop={1}>
            <Button key="back" plain dimColor onPress={() => setLook({ feature: null })}>All tasks</Button>
            <Text mono weight="bold" size="body">{l.feature}</Text>
            <Text mono dimColor size="caption">{bucket.length} {bucket.length === 1 ? 'task' : 'tasks'}{bucket.length ? ` · ${progress(bucket)}` : ''}</Text>
          </Box>
          {bucket.map(r => (
            <Box key={r.id} flexDirection="row" marginTop={1}>
              <Text mono color={TONE[r.state]} size="caption">{DOT}</Text>
              <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                  <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
                    <Text mono color={TONE[r.state]} size="caption" weight="semibold">{r.state}</Text>
                    <Button key={`row-${r.id}`} plain onPress={toggle(r, true)}>{r.task}</Button>
                  </Box>
                  <Box flexShrink={0}>{meta(r)}</Box>
                </Box>
                {r.summary ? <Text mono dimColor wrap="wrap">{r.summary}</Text> : null}
                {facts(r).map(([k, t]) => <Text mono key={`${r.id}-${k}`} dimColor size="caption" wrap="wrap">{t}</Text>)}
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    // the list from the window's first item (`top`, see the `ui.scroll` hook): when that item is a task, its group's
    // heading is drawn first, pinned under the top row (owner 30Oct26: a heading sticks when it reaches the top)
    const items = itemsOf(groupsOf(v.rows, l.by), collapsed, l.by)
    const top = Math.min(l.top ?? 0, lastTop(items, e.props.scroll.bodyRows, l.open ?? null))
    const shown = items.slice(top)
    const pinned = shown[0]?.row ? shown[0].group : null
    const bar = (g: Group, gap: boolean) => (
      <Box key={`head-${g.key}`} flexDirection="column" marginTop={gap ? 1 : 0}>{heading(g.key, g.label, g.n, g.color)}</Box>
    )
    // the slack row (see the `ui.scroll` hook): drawn while the list is scrolled, or while the engine's window still
    // sits on it, so the top row is never the one hidden. A scrolled list also carries blank fill under it, topping
    // the tree up to the window plus the slack row by `leastRows`: at the end the drawn rows could otherwise fit the
    // window, the engine clamp it to 0 and a wheel up raise nothing on the desktop (review 31Oct26). ⚠️ Never more:
    // a window's worth let the desktop's view run on into the fill, snapped back to 1 on every move — a 2–3 s jitter
    // while a trackpad's momentum lasted (owner 31Oct26). Counted, never measured: the desktop's counts can lag a
    // redraw, and one short measure would leave the list stuck (review 31Oct26). Lines that wrap only add rows, so the
    // view can run on by those alone
    return (
      <Box flexDirection="column">
        {top > 0 || e.props.scroll.offset > 0 ? <Box key="slack" height={1} /> : null}
        {header}
        {pinned ? bar(pinned, false) : null}
        {shown.map((it, i) => (it.row ? rowOf(it.row) : bar(it.group, i > 0)))}
        {top > 0 ? <Box key="fill" height={Math.max(0, e.props.scroll.bodyRows - 1 - (pinned ? 1 : 0) - leastRows(shown, l.open ?? null))} /> : null}
      </Box>
    )
  })

  // The list keeps its own window (owner 30Oct26): the engine's would carry the headings off the top with the rest. A
  // move shifts `top` — the first list item shown — by the rows asked, as far as the last items filling the window,
  // and sets the engine's window itself: a bucket scrolled down, or the engine keeping a focused press in view, must
  // never leave the list's top row hidden (review 30Oct26). ⚠️ The desktop moves its own view FIRST and raises
  // `ui.scroll` only when that view can move (probed 31Oct26: no event at all for a wheel up with the window at 0), so
  // a list scrolled down keeps the window at 1, over the blank slack row the drawing adds, and a wheel up always has a
  // row to move; at the very top the window is 0 and there is no slack. A bucket, a problem or an empty ledger
  // scrolls as the engine scrolls it.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const l = await read($, look)
    const v = await read($, view)
    if (l.feature || v.problem !== '' || v.rows.length === 0) return next(e)
    const items = itemsOf(groupsOf(v.rows, l.by), l.collapsed ?? [], l.by)
    const open = l.open ?? null
    const most = lastTop(items, e.bodyRows, open)
    const top = moved(items, l.top ?? 0, e, open, most)
    await update($, look, cur => ({ ...cur, top }))
    return next({ ...e, offset: top > 0 ? 1 : 0 })
  })
}
