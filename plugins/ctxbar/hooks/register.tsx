// (c) Shrix
// author: shrix
// ctxbar — the context window as ONE row above the prompt. The row opens with the plan's
// weekly (7-day) usage: its number lit up to the share used in its 10% band's colour, then its reset
// countdown dimmed.
// Its bar is the whole window (100%), every category a segment inside it in its own
// colour, then the free space and the compaction reserve alike as one straight grey line; on the
// desktop the bar is as tall as the pills.
// The share in use comes last before the task icon (✓), which closes both rows and opens the
// task pane (tasks.tsx); the Ensemble icon (⧉) sits just before it while the ensemble mod has
// a ledger here. While anything runs (the main turn, a background
// shell, a subagent) the row is the running bar instead: the dot, the week's quota used, a
// lane for each task with its own dotted trail of work done (work.ts), the running time, the icon.
// Hovering a segment, a lane or a usage figure lays a small tag naming it over the row (on the
// idle desktop row, in the branch diff's place), so the row never grows. Whenever anything else
// draws above the prompt (a survey, another mod's band), the bar steps aside until the space is
// free again. /ctxbar shows or hides it; the choice is kept across sessions. The free-space line
// follows the context-bar mod by Hamza Zafar (MIT).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Diff, Limit, Reading, Slice, Work } from '../types'
import { registerTasks, tasksSessionStart, tasksTurnEnd, todoCommand, togglePane } from './tasks'
import { type PendingCount, iconTag } from './taskfile'
import {
  CHIP_GREY, DOT_PX, EASE_S, FINISH_MS, IDLE, LANE_H, PILL_H, WIDER_AT_MS, addShell, agentRest, agentStep, callOver, clearSvg, targetOf, chipSvg, clockSvg, clockTime, dotColour, dotSvg, elapsed, ended, isRunning,
  gyrOf, laneCells, lanePill, laneSvg, lighten, liveCount, pillSize, pillSvg, promptCall, timeTagInk, tagSvg, tagWidth, textSvg,
  isNaming, laneTag, lanesOf, onShow, runTime, settle, shellsFrom, trailGrowth, waveSeconds, withAgents,
} from './work'
import type { InFlight } from './work'

export const LABEL = 13 // the longest hover label: "commands 100%"
const FEWEST_CELLS = 10 // a bar narrower than this is not drawn
const TASK_ICON = '✓' // the task pane's icon: one cell, the rows' gap before it
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']) // tools that wait on the person's answer

// One fixed colour per category, so a colour always means the same thing. The Claude
// dataviz palette's dark steps (REFS/palette.html), in the order that keeps a full bar's
// neighbours apart: validate_palette.js, worst adjacent ΔE 13 colour-blind, 19.3 normal.
export const CATEGORY: Record<string, { short: string; colour: string }> = {
  'System prompt': { short: 'prompt', colour: '#199E70' }, // aqua
  'System tools': { short: 'tools', colour: '#3987E5' }, // blue
  'MCP tools': { short: 'mcp', colour: '#C98500' }, // yellow
  'Custom agents': { short: 'agents', colour: '#D55181' }, // magenta
  'Memory files': { short: 'memory', colour: '#008300' }, // green
  Skills: { short: 'skills', colour: '#9085E9' }, // violet
  Messages: { short: 'msgs', colour: '#E66767' }, // red
}
const SPARE = '#D95926' // orange: a category this build does not name yet
// The track, free space and reserve alike: Claude Code's own border grey, as the desktop
// app draws the prompt box's edge.
export const FREE = '#4D4D4C'
// Every tag, the diff included: the app's own chip grey (CHIP_GREY, which the desktop's chips are
// drawn in too), the palette's secondary ink on it.
export const TAG = { backgroundColor: CHIP_GREY, color: '#C3C2B7' }
// The track is one straight line in one grey throughout, one glyph per cell, drawn as a chain of
// short pieces. Used stretches are colour boxes.
export const LINE = '─'
export const PIECE = 4 // the most cells one run of the line spans
export const RUN_ON = 16 // the most cells of room the bar's last stretch can run on into (desktop)
// On the desktop the bar is a pill's height, centred in the row as the app centres the diff
// chip and the share: a box's height there is counted in rows of text (20 px).
const BAR_ROWS = PILL_H / (LANE_H + 2)
// A used segment is filled with twice its cells, clipped: in a proportional font (the
// desktop app's) a cell-wide fill can come up short, and only drawn text answers the pointer.
const FILL = ' ' // figure space: digit-wide, blank, never a line break

// A hovered segment lights up in a lighter step of its own hue, never white; anything
// but a #rrggbb colour is handed back as it came.
export const glow = (hex: string): string => lighten(hex, 0.35)

// The plan's usage window the row shows: the 7-day one alone. Any other (the 5-hour session
// window, a gateway's spend limit) is left out.
const WINDOW_OF: Record<string, Limit['window']> = { seven_day: '7d' }
const NAME: Record<Limit['window'], string> = { '7d': 'weekly' } // as Claude names the window
const MINUTE = 60_000

// The engine's rate-limit windows as the row shows them, each a whole percent, the engine's own
// figure (to a tenth) kept beside it.
export function toLimits(rateLimits: readonly SessionRateLimit[]): Limit[] {
  return Object.entries(WINDOW_OF).flatMap(([kind, window]) => {
    const found = rateLimits.find(l => l.kind === kind)
    if (!found) return []
    const resetsAt = found.resetsAt === undefined ? NaN : Date.parse(found.resetsAt)
    return [{ window, percent: Math.round(found.percentUsed), reported: found.percentUsed, ...(Number.isNaN(resetsAt) ? {} : { resetsAt }) }]
  })
}

// The time left until a reset, to the minute: 3d9h, 4h15, 12m, or now once it is due.
export function countdown(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE)
  if (minutes <= 0) return 'now'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}`
  return `${minutes}m`
}


// The one gap between any two parts of either row (the dot, the quota, each lane, the time,
// the +N; the weekly mark, its countdown, the bar, the share): a no-break space and a hair,
// 4.6px in the desktop app's font (measured in Chromium at 14px: a space 3.7, a hair 0.8), two
// cells in a terminal. One width throughout, so the rows read even. No-break, so no text
// layout can fold it away where it stands alone between two parts.
export const GAP = `\u{A0}\u{200A}`
export const ICON_CELLS = GAP.length + TASK_ICON.length // the cells the task icon closes both rows with
// The Ensemble pane's icon (owner 30Oct26), left of the task icon: two linked windows, the
// sessions. Drawn only while the ensemble mod is loaded and finds a ledger here; its cells come
// off the row as the task icon's do, so the row shrinks and nothing moves.
const ENSEMBLE_ICON = '⧉'
export const ENSEMBLE_CELLS = GAP.length + ENSEMBLE_ICON.length
// On the desktop the icon is the app's native button, its padding included. Measured on screen (img 15 and 16,
// 30Oct26, same scale): its centre sits 43.25px from the task icon's, and three more cells moved the task icon 31.5px
// (a cell ≈ 10.5px), so its own three cells give 31.5px of 43.25 — one more cell takes the rest (≈1px over), and the
// task icon keeps the place it had before the Ensemble icon came.
export const ENSEMBLE_DESK_CELLS = 1
// A desktop hover that changes nothing: the app joins a box to its hover group only when its
// hover sets a style, so a box without a colour of its own sets this one to show its tag.
const NO_CHANGE = '#0000'
// The narrowest a cell of the desktop row is (7 to 9 px): a box of cells counted at this width
// holds a picture of that many pixels, whatever the cells really are.
const NARROWEST_CELL_PX = 7

// A lane's hover scope. The engine takes a scope of at most 64 characters, so a task whose key
// is too long for one goes by a short hash of its key.
function laneScope(key: string): string {
  const plain = `ctxbar-lane-${key}`
  if (plain.length <= 64) return plain
  let hash = 0
  for (const ch of key) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) | 0
  return `ctxbar-lane-#${(hash >>> 0).toString(36)}`
}

// The row's left end, a mark per window shown: the percent used (its own meter on the desktop, coloured
// digits in a terminal), then dimmed its countdown, GAP between and GAP before the bar. A window past
// its reset is not shown, even before a new reading comes in.
export function limitMarks(limits: readonly Limit[], now: number) {
  return limits.filter(limit => limit.resetsAt === undefined || limit.resetsAt > now).map(limit => {
    const left = limit.resetsAt === undefined ? '' : countdown(limit.resetsAt - now)
    const number = String(limit.percent)
    return { limit, number, countdown: left, cells: number.length + (left ? GAP.length + left.length : 0) + GAP.length }
  })
}

// A usage figure's tag: the window's name alone; the figure beside it says the rest.
export function limitTag(limit: Limit): string {
  return NAME[limit.window]
}

// The branch's diff from `git diff-index --shortstat`: lines added and removed; null when nothing
// changed or git said anything else.
export function diffOf(shortstat: string): Diff | null {
  const count = (word: string) => Number(shortstat.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? 0)
  const diff = { added: count('insertion'), removed: count('deletion') }
  return diff.added + diff.removed > 0 ? diff : null
}

// The person's offset from UTC in minutes east, from `date +%z` (+0530, -0700); undefined for
// anything else.
export function utcOffsetOf(zone: string): number | undefined {
  const m = /^([+-])(\d{2})([0-5]\d)$/.exec(zone.trim())
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : undefined
}

// A count with its thousands grouped, as the app writes the diff: 4,942.
export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// The diff tag's inks: the app's own green and red for lines added and removed, on the tags' grey,
// as the app draws them.
const ADDED = '#88D063'
const REMOVED = '#D2565A'

// A figure's picture as the row draws it: its source at its own width, the row's height, and
// what it says for a reader that cannot see it.
const pictured = (p: { source: string; width: number }, alt: string) => ({ source: p.source, alt, width: p.width, height: LANE_H })

const shown = atom({ plugin: 'ctxbar', key: 'reading' } as const, null as Reading | null)
const hidden = atom({ plugin: 'ctxbar', key: 'isHidden' } as const, false)
const limits = atom({ plugin: 'ctxbar', key: 'limits' } as const, [] as Limit[])
const diffNow = atom({ plugin: 'ctxbar', key: 'diff' } as const, null as Diff | null)
const clockAt = atom({ plugin: 'ctxbar', key: 'now' } as const, 0)
// What the desktop row draws from instead of the clock: its pictures tick by themselves, so it is
// drawn anew only when something it shows changes (deskChanged), not every second.
const redrawAt = atom({ plugin: 'ctxbar', key: 'redrawAt' } as const, 0)
const work = atom({ plugin: 'ctxbar', key: 'work' } as const, IDLE)
// The task pane's state the icon draws from; tasks.tsx writes it (the same plugin and key).
const tasksOpen = atom({ plugin: 'ctxbar', key: 'tasksOpen' } as const, false)
const tasksPending = atom({ plugin: 'ctxbar', key: 'tasksPending' } as const, null as PendingCount | null, { shape: 'tasks-pending-2' })
const tasksFolder = atom({ plugin: 'ctxbar', key: 'tasksFolder' } as const, null as string | null)
// What the ensemble mod publishes for this icon (its `badge`), read as any mod's value may be:
// ctxbar does not depend on that mod, so its contract is not typed here, and without it the
// value stays null and no icon is drawn.
type EnsembleBadge = { available: boolean; open: boolean; progress: string }
const ensembleBadge = atom({ plugin: 'ensemble', key: 'badge' } as never, null)
// Its press: that mod's own switch, `$.ensemble.toggle()`, untyped here (no dependency). A
// failure is swallowed so the bar never breaks on it; the icon then does nothing.
async function toggleEnsemble($: EngineInterface): Promise<void> {
  // @ts-expect-error: the ensemble mod's noun; ctxbar carries no contract for it
  try { await $.ensemble.toggle() } catch { /* that mod is gone or refused: nothing to do */ }
}

// The clock the drawings read only goes forward: writers that interleave never step it back.
const stampClock = ($: EngineInterface, now: number) => update($, clockAt, at => Math.max(at, now))

type Row = { name: string; tokens: number; kind: string }
type Breakdown = { categories: readonly Row[]; rawMaxTokens: number; percentage: number }

// The breakdown as the bar draws it. Deferred and empty rows drop out. The reserve and
// the free space are what is left of the window once the used rows are counted, so a
// window used to its end reads full, and past its end reads as used alone.
export function toReading(b: Breakdown): Reading {
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const inUse = used.reduce((n, c) => n + c.tokens, 0)
  const reserveAsked = b.categories.filter(c => c.kind === 'buffer').reduce((n, c) => n + c.tokens, 0)
  const room = Math.max(0, b.rawMaxTokens - inUse)
  const reserve = Math.min(reserveAsked, room)
  const free = room - reserve

  const slices: Slice[] = used.map(c => ({
    name: c.name,
    short: CATEGORY[c.name]?.short ?? (c.name.trim().toLowerCase().split(/\s+/)[0]!.slice(0, 8) || 'other'),
    tokens: c.tokens,
    kind: 'used',
    colour: CATEGORY[c.name]?.colour ?? SPARE,
  }))
  if (free > 0) slices.push({ name: 'Free space', short: 'free', tokens: free, kind: 'free', colour: FREE })
  if (reserve > 0) slices.push({ name: 'Autocompact buffer', short: 'reserve', tokens: reserve, kind: 'buffer', colour: FREE })
  return { slices, window: b.rawMaxTokens, percent: b.percentage }
}

// How many of `width` cells each slice gets: shares of the whole row, rounded so they
// add up to exactly `width`; a used slice with any tokens is never squeezed to nothing.
export function cells(r: Reading, width: number): number[] {
  const whole = Math.max(1, r.slices.reduce((n, s) => n + s.tokens, 0))
  const ideal = r.slices.map(s => (s.tokens * width) / whole)
  const given = ideal.map(x => Math.floor(x))
  const order = ideal.map((x, i) => ({ i, cut: x - Math.floor(x) })).sort((a, z) => z.cut - a.cut)
  let spare = width - given.reduce((n, c) => n + c, 0)
  for (let j = 0; spare > 0 && j < order.length; j++, spare--) {
    const i = order[j]!.i
    given[i] = (given[i] ?? 0) + 1
  }
  r.slices.forEach((s, i) => {
    if (s.kind !== 'used' || (given[i] ?? 0) > 0) return
    const donor = given.indexOf(Math.max(...given))
    if ((given[donor] ?? 0) > 1) {
      given[donor] = (given[donor] ?? 0) - 1
      given[i] = 1
    }
  })
  return given
}

export function share(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%'
  const pct = (part * 100) / whole
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

export function label(s: Slice, r: Reading): string {
  const full = `${s.short} ${share(s.tokens, r.window)}`
  return full.length <= LABEL ? full : `${full.slice(0, LABEL - 1)}…`
}

// The share in use at the row's end: the rows' one gap, then exactly the number's own width.
export function inUse(percent: number): string {
  return `${GAP}${Math.round(percent)}%`
}

// Whether a tree beneath draws anything of its own: the engine's placeholder, hidden or
// empty boxes and blank text do not; visible text, a box painted or framed, or any other
// element (a button, a picture) does.
export function claims(node: unknown): boolean {
  if (typeof node === 'string') return node.trim() !== ''
  if (!node || typeof node !== 'object') return false
  const element = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  if (element.type === 'engine' || element.props?.display === 'none') return false
  if (element.type !== 'Box' && element.type !== 'Text') return true
  if (element.type === 'Box' && (element.props?.backgroundColor || element.props?.borderStyle)) return true
  return Array.isArray(element.children) && element.children.some(claims)
}

// Reads the window and the usage windows again, unless the bar is hidden: nobody would see it.
// `isNew`: a response has just come in (a main turn's end), so its usage windows are as of now.
async function remeasure($: EngineInterface, isNew = false): Promise<void> {
  if (await read($, hidden)) return
  const { context, rateLimits } = await $.session.usage({ breakdown: 'summary' }) // a local estimate: no token-count calls
  const b = context.breakdown
  if (b) await update($, shown, () => toReading(b))
  await keepLimits($, rateLimits, isNew)
}

// Reads the branch's diff again, as a pull request would hold it: against the merge base with
// the remote's default branch (origin/main, origin/master as fallbacks), edits not yet
// committed included; with no base, the edits alone. Asked after the start, after each call
// that can change files and at each turn's end, never on a timer; one git run at a time, a
// call while one runs asking for one more after it. Unless the bar is hidden. `fresh` (a start, a
// turn's end, a show) works the merge base out again; a call keeps it while HEAD stays put.
let diffRunning = false
let diffAgain = false
let diffFresh = false
const CHANGES_FILES = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash', 'EnterWorktree', 'ExitWorktree'])
async function remeasureDiff($: EngineInterface, fresh = false): Promise<void> {
  if (fresh) diffFresh = true
  if (diffRunning) return void (diffAgain = true)
  diffRunning = true
  try {
    do {
      diffAgain = false
      if (await read($, hidden)) return
      const isFresh = diffFresh
      diffFresh = false
      const diff = await readDiff($, isFresh)
      await update($, diffNow, () => diff)
    } while (diffAgain)
  } finally {
    diffRunning = false
  }
}

// The person's offset from UTC, read from their machine at each start: a desktop lane tag gives the
// clock time a task began. Undefined until read, or where it cannot be; a read that fails keeps the
// last good one.
let utcOffsetMin: number | undefined
async function readZone($: EngineInterface): Promise<void> {
  const done = await $.process.run(['date', '+%z'], { timeoutMs: 10_000 }).catch(() => undefined)
  const offset = done?.exitCode === 0 ? utcOffsetOf(done.stdout) : undefined
  if (offset !== undefined) utcOffsetMin = offset
}

// The merge base last worked out, and the commit HEAD was at then; head null: no HEAD (not a git
// repository, or one with no commit yet), so a call runs no git until a fresh read looks again.
let baseFor: { head: string | null; base: string | null } | undefined
async function readDiff($: EngineInterface, fresh: boolean): Promise<Diff | null> {
  const git = async (...args: string[]) => {
    const done = await $.process.run(['git', ...args], { timeoutMs: 10_000 }).catch(() => undefined)
    return done?.exitCode === 0 ? done.stdout.trim() : null
  }
  if (!fresh && baseFor?.head === null) return null
  const at = await git('rev-parse', 'HEAD')
  let base: string | null = null
  if (!fresh && at && baseFor?.head === at) base = baseFor.base
  else {
    const head = await git('rev-parse', '--abbrev-ref', 'origin/HEAD')
    for (const ref of [...(head ? [head] : []), 'origin/main', 'origin/master'].filter((r, i, all) => all.indexOf(r) === i)) {
      base = (await git('merge-base', 'HEAD', ref)) || null // an empty answer is no base
      if (base) break
    }
    baseFor = { head: at, base }
  }
  // diff-index, not diff: it never rewrites git's index, so it never locks out another git command.
  const stat = await git('diff-index', '-M', '--shortstat', base ?? 'HEAD', '--')
  return stat === null ? null : diffOf(stat)
}

// The plan's windows are the account's, the same in every session. The newest reading of each is
// shown and kept in the store for any session with none yet (one resumed or reloaded before its
// first response). `isNew`: the reading came with a response just in (a measure, a main turn's end),
// so it is stamped with the time; one read again at a start or a show may be any age, so it never
// takes the place of a stamped one of the same week, nor does a reading that comes back empty.
async function keepLimits($: EngineInterface, rateLimits: readonly SessionRateLimit[], isNew: boolean): Promise<void> {
  const now = await $.clock.now()
  await stampClock($, now)
  const fresh = toLimits(rateLimits).map(l => (isNew ? { ...l, at: now } : l))
  const stored = storedLimits(await $.store.get('limits').catch(() => undefined), now)
  let latest: Limit[] = []
  await update($, limits, kept => (latest = newest(kept.filter(l => l.resetsAt === undefined || l.resetsAt > now), stored, fresh)))
  const known = latest.filter(l => l.resetsAt !== undefined) // one with no reset time cannot be told stale elsewhere
  if (fresh.length > 0 && known.length > 0) await $.store.set('limits', known).catch(() => undefined)
}

// Each window once, its newest reading. A later reset is a later week (resets within the hour are
// one week, should the engine's time of it move). In the same week the later stamp wins (a plan
// changed mid-week can lower the share); one of unknown age gives way to a stamped one; of two
// unstamped, the higher share (a week's use only grows), and of two alike the later in the lists.
const HOUR = 60 * MINUTE
export function newest(...lists: readonly (readonly Limit[])[]): Limit[] {
  const reset = (l: Limit) => l.resetsAt ?? -Infinity
  const stamp = (l: Limit) => l.at ?? -Infinity
  const isNewer = (l: Limit, had: Limit) => {
    const isSameWeek = reset(l) === reset(had) || Math.abs(reset(l) - reset(had)) < HOUR
    if (!isSameWeek) return reset(l) > reset(had)
    if (l.at !== undefined || had.at !== undefined) return stamp(l) >= stamp(had)
    return l.percent >= had.percent
  }
  const by = new Map<Limit['window'], Limit>()
  for (const l of lists.flat()) {
    const had = by.get(l.window)
    if (!had || isNewer(l, had)) by.set(l.window, l)
  }
  return [...by.values()]
}

// The store's kept reading, as far as it still holds: windows the row shows that have not reset yet.
export function storedLimits(value: unknown, now: number): Limit[] {
  if (!Array.isArray(value)) return []
  return newest(value.flatMap(v => {
    const l = v as Partial<Limit> | null
    return l && Object.values(WINDOW_OF).includes(l.window as Limit['window']) && typeof l.percent === 'number' && Number.isFinite(l.percent)
      && l.percent >= 0 && typeof l.resetsAt === 'number' && l.resetsAt > now
      // a stamp ahead of now (a clock that ran fast) counts as now, so a reading just in still wins
      ? [{
        window: l.window!,
        percent: l.percent,
        ...(typeof l.reported === 'number' && Number.isFinite(l.reported) ? { reported: l.reported } : {}),
        resetsAt: l.resetsAt,
        ...(typeof l.at === 'number' && Number.isFinite(l.at) ? { at: Math.min(l.at, now) } : {}),
      }]
      : []
  }))
}

// The minute tick, running only while the bar is shown. It beats on the wall clock's minute, just after it changes, so the countdowns move and
// the context used's time tag (a picture, fixed at its drawing) names the minute it is hovered in.
// `tickRun` tells a start that was superseded or stopped while it read the clock.
let tick: Timer | undefined
let tickRun = 0
let beatAt = 0 // the last beat's time
const MINUTE_EDGE_MS = 50 // past the edge, so the redraw reads the new minute

function startTick($: EngineInterface): void {
  tick?.cancel()
  const run = ++tickRun
  void $.clock.now().then(now => {
    if (run !== tickRun) return
    const beat = () => void stamp($).catch(() => undefined)
    tick = $.clock.after(MINUTE - (now % MINUTE) + MINUTE_EDGE_MS, () => {
      if (run !== tickRun) return
      beat()
      tick = $.clock.every(MINUTE, beat)
    })
  }).catch(() => undefined)
}

function stopTick(): void {
  tickRun++
  tick?.cancel()
  tick = undefined
}

async function stamp($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await stampClock($, now)
  // the countdown moved on a minute, and the context used's time tag with it: both on the idle row
  // only; the running row's usage figure moves only when its window resets
  const resetSince = (await read($, limits)).some(l => l.resetsAt !== undefined && l.resetsAt > beatAt && l.resetsAt <= now)
  beatAt = now
  if (deskRow !== 'running' || resetSince) await redraw($, now)
}

// The desktop row is drawn anew only when something it shows moves on by itself: a background
// shell's trail stepping further, or the clock gaining a character (just after it: a timer set
// within the last second before it; the beat catches a timer that never came). Whatever the record
// holds changing draws it anew anyway (setWork writes the record), and its pictures tick and move
// by themselves between drawings. `drawnAs` is what the last desktop drawing showed of these.
let drawnAs = ''
let wideningAt = 0 // when the timer for the clock's next character is due; 0, none set
const redraw = ($: EngineInterface, now: number) => update($, redrawAt, at => Math.max(at, now))
const deskKey = (w: Work, now: number) =>
  `${lanesOf(w, now).lanes.map(l => `${l.key}:${l.reach}`).join(' ')}|${elapsed(runTime(w, now)).length}`

async function deskChanged($: EngineInterface, w: Work, now: number): Promise<void> {
  if (!isDeskDrawn) return // no desktop row on show: the hidden bar, a survey, a terminal alone
  if (deskKey(w, now) !== drawnAs) await redraw($, now)
  if (w.pausedSince !== null || liveCount(w) === 0 || wideningAt > now) return // the clock stands still
  const run = runTime(w, now)
  const wider = WIDER_AT_MS.find(at => at > run)
  if (wider !== undefined && wider - run < 1000) {
    wideningAt = now + wider - run + 5
    $.clock.after(wider - run + 5, () => void $.clock.now().then(at => redraw($, at)).catch(() => undefined))
  }
}

// When each picture of a desktop row came on show, per surface (the app and a phone take turns
// drawing): a picture fades in where it first appears, and is drawn whole by every later drawing
// while it stays. One that was not in that surface's drawing just before has (re)appeared: the
// row swapped, the bar came back, a lane came in from +N. Each drawing forgets the rest.
// Given what a picture shows, a change to it is kept while it eases (EASE_S): what it showed
// before, when that changed, and how long the old had stood then (`fromStood`); and since when it
// has shown what it shows now (`settledAt`), on whichever clock the caller keeps it by.
type Seen = {
  since: number; drawing: number; look?: string; state?: unknown; from?: unknown; changedAt?: number
  settledAt?: number; fromStood?: number
}
type Shows = { drawings: number; since: Map<string, Seen> }
const shows = new Map<string, Shows>()
let isDeskDrawn = false // the last desktop drawing drew the row: not the hidden bar, a survey, a narrow band
let deskRow: 'idle' | 'running' | null = null // which row it drew
function beginDrawing(surface: string): Shows {
  const view = shows.get(surface) ?? { drawings: 0, since: new Map() }
  shows.set(surface, view)
  view.drawings++
  for (const [key, seen] of view.since) if (seen.drawing < view.drawings - 1) view.since.delete(key)
  isDeskDrawn = false
  deskRow = null
  return view
}
function seenFor<T>(view: Shows, key: string, now: number, state?: T): { shownMs: number; from?: T; changedMs: number; stoodMs: number; fromStoodMs?: number } {
  const seen = view.since.get(key)
  const kept = seen && seen.drawing === view.drawings - 1 ? seen : undefined
  const look = state === undefined ? undefined : JSON.stringify(state)
  const next: Seen = { since: kept?.since ?? now, drawing: view.drawings, look, state, settledAt: kept?.settledAt ?? kept?.since ?? now }
  if (kept?.look !== undefined && look !== undefined && kept.look !== look) {
    Object.assign(next, { from: kept.state, changedAt: now, settledAt: now, fromStood: now - (kept.settledAt ?? kept.since) })
  } else if (kept?.changedAt !== undefined && now - kept.changedAt < EASE_S * 1000) {
    Object.assign(next, { from: kept.from, changedAt: kept.changedAt, fromStood: kept.fromStood })
  }
  view.since.set(key, next)
  return {
    shownMs: now - next.since, from: next.from as T | undefined, changedMs: next.changedAt === undefined ? Infinity : now - next.changedAt,
    stoodMs: now - next.settledAt!, ...(next.fromStood === undefined ? {} : { fromStoodMs: next.fromStood }),
  }
}
const shownFor = (view: Shows, key: string, now: number) => seenFor(view, key, now).shownMs

// What runs now: every change goes through settle, so `since` keeps its contract, and the
// running time's tick follows. Bookkeeping never fails the event that fed it. The clock is
// written first: a drawing between the two writes reads the old record against the new
// clock, which holds still or runs on, never back (a stop that ends adds to `waited`).
async function setWork($: EngineInterface, change: (w: Work, now: number) => Work): Promise<void> {
  const now = await $.clock.now()
  await stampClock($, now)
  await update($, work, kept => {
    const w = onShow(kept, now) // whole, though kept by an older build
    return settle(ended(w, change(w, now), now), now)
  })
  await pace($)
}

// The subagents still running, read afresh; one whose stop went through stays out while the
// list still calls it running, and a start for it lets it back in (work.ts withAgents).
async function refreshAgents($: EngineInterface, change: { stopped?: string; started?: string } = {}): Promise<void> {
  const list = await $.agent.list()
  await setWork($, (w, now) => withAgents(w, list, now, change))
}

// One beat of the tick: the time moves on (a terminal draws it anew; the desktop only when
// something it shows changes), and a task done long enough leaves (the bar goes with the last
// of them).
async function beat($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await stampClock($, now)
  const w = { ...IDLE, ...(await read($, work)) }
  if (w.finished.some(f => now - f.endedAt >= FINISH_MS)) await setWork($, x => x)
  await deskChanged($, w, now)
}

// The running time's one-second tick: on only while something runs, the bar is shown, and
// a surface draws it (not a -p run). Read afresh each time, so no stale answer leaves it on.
let pulse: Timer | undefined
let isDrawn = false // a person's surface is drawing: an interactive start, or a client attached

async function pace($: EngineInterface): Promise<void> {
  const isOn = isDrawn && isRunning({ ...IDLE, ...(await read($, work)) }) && !(await read($, hidden))
  if (isOn && !pulse) {
    pulse = $.clock.every(1000, () => void beat($).catch(() => undefined))
  } else if (!isOn && pulse) {
    pulse.cancel()
    pulse = undefined
  }
}

export const register: Register = (on, options) => {
  registerTasks(on) // the task pane (hooks/tasks.tsx): one hooks module per plugin, so it is imported
  const size = pillSize(options) // the pill's width and padding, from the mod's options
  const waveS = waveSeconds(options) // the lanes' wave: seconds a crossing, from the mod's options
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'ctxbar', description: 'Show or hide the one-row context bar above the prompt; /ctxbar tasks opens or closes the task pane',
      argumentHint: '[tasks]',
    }).catch(() => undefined)
    await $.command.register({
      name: 'todo', description: 'Open or close the task pane; with words, run them as the todo skill does (add, remove, completed, …)',
      argumentHint: '[add|remove|completed|uncheck|clear|path …]', immediate: true,
    }).catch(() => undefined)
    await tasksSessionStart($).catch(() => undefined) // the pane's state again, a reload of the mod included
    const wasHidden = (await $.store.get('hidden').catch(() => undefined)) === true
    await update($, hidden, () => wasHidden)
    // Something draws the bar: the terminal REPL, or a client already attached (the desktop
    // app attaches once, so a reload finds it here rather than in session.attach). A -p
    // run has neither.
    isDrawn = e.isInteractive || (await $.session.surfaces().catch(() => [])).length > 0
    if (!wasHidden && isDrawn) startTick($)
    // A reload keeps the record, its running time going on; what it waited on is let go, since
    // the calls that would close it are no longer this module's to see.
    await setWork($, (w, now) => ({
      ...w, asks: [], agentCalls: [], tool: null, target: null,
      agents: w.agents.map(a => (a.call === undefined ? a : agentRest([a], a.id, a.call, now)[0]!)),
    })).catch(() => undefined)
    void remeasure($).catch(() => undefined)
    void remeasureDiff($, true).catch(() => undefined)
    void readZone($).catch(() => undefined)
    return started
  })

  // The desktop app, a phone or another client joins after the start, and a session it
  // drives is not interactive: the ticks start when it attaches (neither ever doubles).
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    isDrawn = true
    if (!(await read($, hidden).catch(() => true))) startTick($)
    await pace($).catch(() => undefined)
    return attached
  })

  // The usage windows move between turns too: the engine says so when one moves a whole point.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits')) {
      await (async () => {
        if (!(await read($, hidden))) await keepLimits($, e.rateLimits, true)
      })().catch(() => undefined)
    }
    return measured
  })

  // A /clear or a resume brings another conversation with no session.start: drop the
  // old figures, and the next turn measures the new window.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await update($, shown, () => null).catch(() => undefined)
    return ended
  })

  // Only the main conversation's window is drawn; a subagent fills a window of its own.
  // The main loop's turns are the running row's backbone; a subagent's end re-reads the list.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await setWork($, (w, now) => ({ ...w, inTurn: true, turnSince: now, tool: null, steps: 0 })).catch(() => undefined)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await setWork($, w => ({ ...w, inTurn: false, turnSince: null, tool: null, target: null })).catch(() => undefined) // its asks go with it (settle)
      // a turn stopped or failed before a response may hold an old one's windows: not as of now
      await remeasure($, e.reason === 'answer' || e.reason === 'refusal').catch(() => undefined)
      void remeasureDiff($, true).catch(() => undefined) // a fetch or a push moves the remote's branch, not HEAD
      void tasksTurnEnd($).catch(() => undefined)
    } else await refreshAgents($).catch(() => undefined)
    return done
  })

  // The calls in flight, so a permission prompt, which names no call, is matched to its own; and
  // whether a prompt matched none, so any call from its caller ending closes it (else only calls
  // that asked, Agent calls and the main loop's write after the call look).
  const inFlight = new Map<string, InFlight>()
  let isUnmatched = false

  // The main loop's tool in flight, and any shell a call leaves running in the background.
  // Observe only: the call goes on unchanged, whatever the bookkeeping does. Before an
  // ordinary call, one state write (a subagent's also reads the clock) and nothing else, so no
  // tool waits on the bar; a question
  // to the person (or a plan to approve) also opens its ask, the time stopping while it is open.
  // An Agent call holds its caller, waiting on the subagent, until it is over.
  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const agentId = e.agentId
    const who = agentId ?? 'main'
    const call = e.tool_use_id
    const isAgent = e.tool === 'Agent'
    const flight: InFlight = { call, who, tool: e.tool, e: e as unknown as Record<string, unknown>, asked: ASKS.has(e.tool) }
    inFlight.set(call, flight)
    const target = targetOf(flight.e)
    const startedAt = agentId === undefined ? 0 : await $.clock.now().catch(() => 0) // a subagent's pill's words new as of now
    await update($, work, kept => {
      const w = { ...IDLE, ...kept } // whole, though kept by an older build
      const step = agentId === undefined
        ? { ...w, tool: e.tool, target, steps: w.steps + 1 }
        : { ...w, agents: agentStep(w.agents, agentId, call, e.tool, target, startedAt) }
      return isAgent ? { ...step, agentCalls: [...step.agentCalls, { who, call }] } : step
    }).catch(() => undefined)
    if (flight.asked) await setWork($, w => ({ ...w, asks: [...w.asks, { who, tool: e.tool, call }] })).catch(() => undefined)
    // Answered, allowed, refused, run, aborted or abandoned, the call is over, once: its ask or
    // Agent call closes (a stop it ends added up at once), the caller's tool clears (a subagent's
    // only if no later call of its own has started), and a shell it left running is a lane.
    let isOver = false
    const over = async (shell?: { id: string; description: unknown; command: unknown }) => {
      if (isOver) return
      isOver = true
      inFlight.delete(call)
      const endedAt = isMain ? 0 : await $.clock.now().catch(() => 0)
      const done = (kept: Work) => {
        const closed = callOver({ ...IDLE, ...kept }, call, who)
        // the caller's newest call still in flight, if any, is what it is doing now
        const then = [...inFlight.values()].filter(f => f.who === who).pop()
        const after = isMain
          ? { ...closed, tool: then?.tool ?? null, target: then ? targetOf(then.e) : null }
          : { ...closed, agents: agentRest(closed.agents, who, call, endedAt, then && { call: then.call, tool: then.tool, target: targetOf(then.e) }) }
        isUnmatched = after.asks.some(a => a.call === null) // read each time: the updater that writes last decides
        return after
      }
      if (shell) await setWork($, (w, now) => ({ ...done(w), shells: addShell(w.shells, shell.id, shell.description, shell.command, now) }))
      else if (flight.asked || isAgent) await setWork($, done)
      else if (isMain || isUnmatched) {
        let isClosed = false // an ask from this caller that matched no call
        await update($, work, kept => {
          const after = done(kept)
          isClosed = after.asks.length !== { ...IDLE, ...kept }.asks.length
          return after
        })
        if (isClosed) await setWork($, x => x)
      } else await update($, work, done) // a subagent's call: its lane back to thinking
    }
    // A dispatch abandoned (Esc at its prompt, a hook above settling first) may never settle:
    // its abort closes the call too.
    const onAbort = () => void over().catch(() => undefined)
    try {
      if (next.signal.aborted) onAbort()
      else next.signal.addEventListener('abort', onAbort, { once: true })
    } catch {
      // no abort to follow: the call closes when it settles
    }
    const called = await next(e).catch(async (error: unknown) => {
      await over().catch(() => undefined)
      throw error
    })
    try {
      next.signal.removeEventListener('abort', onAbort)
    } catch {
      // nothing was added
    }
    // a shell it left running, with its words (work.ts addShell labels it: its description, else
    // its command, else 'shell'); whatever the result holds, the call is closed
    const shell = (() => {
      try {
        const output = 'result' in called ? (called.result as { backgroundTaskId?: unknown } | undefined) : undefined
        const id = e.tool === 'Bash' && typeof output?.backgroundTaskId === 'string' ? output.backgroundTaskId : undefined
        if (id === undefined) return undefined
        const words = e as { description?: unknown; command?: unknown }
        return { id, description: words.description, command: words.command }
      } catch {
        return undefined
      }
    })()
    await over(shell).catch(() => undefined)
    if (CHANGES_FILES.has(e.tool)) void remeasureDiff($).catch(() => undefined) // after the call, never holding it
    return called
  })

  // A permission prompt about to be put to the person, unless a hook beneath already decided or
  // blocked it: an ask for the call it is about, open until that call is over (tool.call above)
  // or whoever asked is gone. Nothing marks the answer itself: a call allowed counts its run as
  // waiting too. A hook above that decides after this one has no dialog opened either; this one
  // cannot see it, and the call's time counts as waiting.
  on('classic.PermissionRequest', async ($, e, next) => {
    const answered = await next(e)
    const isDecided = Boolean((answered as { decision?: unknown; block?: unknown } | undefined)?.decision || answered?.block)
    if (!isDecided && !next.signal.aborted) { // an abandoned dispatch opens no dialog
      const who = e.agent_id ?? 'main'
      await setWork($, w => {
        const call = promptCall([...inFlight.values()], w.asks, who, e.tool_name, e.tool_input)
        const flight = call === null ? undefined : inFlight.get(call)
        if (flight) flight.asked = true
        if (call === null) isUnmatched = true
        return { ...w, asks: [...w.asks, { who, tool: e.tool_name, call }] }
      }).catch(() => undefined)
    }
    return answered
  })

  // Subagents come and go: each start and end re-reads the session's list of them. A stop
  // that went through takes its agent out at once (the list may still call it running
  // while the stop is settled), and its list of in-flight work re-reads the shells.
  on('classic.SubagentStart', async ($, e, next) => {
    const answered = await next(e)
    await refreshAgents($, { started: e.agent_id }).catch(() => undefined)
    return answered
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const answered = await next(e)
    await (async () => {
      if (e.background_tasks) {
        const tasks = e.background_tasks
        await setWork($, (w, now) => ({ ...w, shells: shellsFrom(w.shells, tasks, now) }))
      }
      await refreshAgents($, answered?.block ? {} : { stopped: e.agent_id })
    })().catch(() => undefined)
    return answered
  })

  // The main loop stops with the engine's own list of the work still in flight: the
  // background shells are read again from it, so a finished one drops out.
  on('classic.Stop', async ($, e, next) => {
    const answered = await next(e)
    const tasks = e.background_tasks
    if (tasks) await setWork($, (w, now) => ({ ...w, shells: shellsFrom(w.shells, tasks, now) })).catch(() => undefined)
    await refreshAgents($).catch(() => undefined)
    return answered
  })

  // A compaction empties the window between turns; a precompute installs nothing.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && 'messages' in compacted) void remeasure($).catch(() => undefined)
    return compacted
  }).catch(($, e, next) => next(e)) // never in the compaction's way

  on('command.run', { command: 'todo' }, async ($, e) => todoCommand($, e.args))

  on('command.run', { command: 'ctxbar' }, async ($, e) => {
    if (e.args.trim() === 'tasks') return todoCommand($, '') // the pane, any width, the bar's shown/hidden left alone
    const nowHidden = await update($, hidden, was => !was)
    await $.store.set('hidden', nowHidden).catch(() => undefined)
    if (nowHidden) stopTick()
    else {
      startTick($)
      await remeasure($).catch(() => undefined)
      void remeasureDiff($, true).catch(() => undefined)
    }
    await pace($).catch(() => undefined)
    return { text: nowHidden ? 'ctxbar hidden. /ctxbar shows it again' : 'ctxbar on' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)
    const view = e.surface !== 'terminal' ? beginDrawing(e.surface) : undefined // every desktop drawing counts, one that draws nothing too
    // The band is anyone's: a survey, or a mod beneath that draws there, takes it whole, and
    // the bar steps aside until it is free.
    if (e.props.hasSurvey || claims(beneath) || (await read($, hidden))) return beneath
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined // a picture wherever one draws as one
    // The task icon closes both rows; everything else is drawn in the band less its cells, so no
    // part of the row moves with the icon's look (spec A6, S2).
    const ensemble = (await read($, ensembleBadge)) as EnsembleBadge | null
    const hasEnsemble = ensemble?.available === true
    const cols = e.props.bodyColumns - ICON_CELLS - (hasEnsemble ? ENSEMBLE_CELLS + (Svg ? ENSEMBLE_DESK_CELLS : 0) : 0)
    const isTasksOpen = await read($, tasksOpen)
    // Its tag is a chip as the row's other tags are (the tags' grey, a picture on the desktop).
    const iconTagText = iconTag(await read($, tasksPending), await read($, tasksFolder))
    const tag = (text: string, right: number) => (
      <Box position="absolute" top={0} right={right} display="none" hover={{ display: 'flex' }}>
        {Svg
          ? <Svg {...pictured(tagSvg([{ text, colour: TAG.color }]), text)} />
          : <Text {...TAG}>{` ${text} `}</Text>}
      </Box>
    )
    // The Ensemble icon as the task icon is: lit while its pane is up, dim while not, its tag the progress
    const ensembleTag = ensemble?.progress ? `ensemble · ${ensemble.progress}` : 'ensemble'
    const ensembleIcon = hasEnsemble && (
      <Box key="ensemble" flexDirection="row" flexShrink={0} position="relative">
        <Text>{GAP}</Text>
        <Button key="ensemble:icon" plain dimColor={!ensemble.open} label={ENSEMBLE_ICON} onPress={() => void toggleEnsemble($)} />
        {tag(ensembleTag, ENSEMBLE_CELLS)}
      </Box>
    )
    // Beside the Ensemble icon on the desktop the two native buttons sit a hair apart (0.8px), so their glows read
    // 1px apart (owner 30Oct26); a terminal keeps the row's gap, its narrowest step being a cell.
    const tasksIcon = (
      <Box key="tasks" flexDirection="row" flexShrink={0} position="relative">
        <Text>{hasEnsemble && Svg ? ' ' : GAP}</Text>
        <Button key="tasks:icon" plain dimColor={!isTasksOpen} label={TASK_ICON} onPress={() => void togglePane($).catch(() => undefined)} />
        {tag(iconTagText, ICON_CELLS)}
      </Box>
    )
    const icon = hasEnsemble ? [ensembleIcon, tasksIcon] : tasksIcon
    // A terminal is drawn anew each second, with the clock; the desktop row only when what it shows
    // changes (redrawAt), its pictures ticking and moving by themselves: every drawing starts each
    // picture in the app over, so fewer drawings, fewer starts.
    let now: number
    if (Svg) {
      await read($, redrawAt)
      now = await $.clock.now()
    } else now = await read($, clockAt)
    const marks = limitMarks(await read($, limits), now)
    const markCells = marks.reduce((n, m) => n + m.cells, 0)
    const running = onShow(await read($, work), now)
    if (Svg) drawnAs = deskKey(running, now)
    const showing = (key: string) => (view ? shownFor(view, key, now) : Infinity) // how long the picture has been on show
    // How long a picture has been on show, and, if what it shows changed within EASE_S, what it was.
    const eased = <T,>(key: string, state: T) => {
      const seen = view ? seenFor(view, key, now, state) : undefined
      return { shownMs: seen?.shownMs ?? Infinity, change: seen?.from === undefined ? undefined : { from: seen.from, changedMs: seen.changedMs } }
    }
    const meter = (key: string, percent: number) => {
      const look = eased(key, Math.round(percent))
      return chipSvg(percent, look.shownMs, look.change)
    }
    // Dim words that ease when they change, held by the end the row holds them by.
    const words = (key: string, text: string, anchor: 'start' | 'end' = 'start') => {
      const look = eased(key, text)
      return textSvg(text, 'dim', look.shownMs, look.change, anchor)
    }
    // The weekly mark: the percent (its digits lit up to it on the desktop, coloured in a terminal),
    // then its countdown dimmed, GAP between.
    const weekly = (m: (typeof marks)[number]) => (Svg
      ? [
        <Svg key="chip" {...pictured(meter('idle:chip', m.limit.percent), `weekly ${m.number}%`)} />,
        ...(m.countdown ? [<Text key="g1">{GAP}</Text>, <Svg key="left" {...pictured(words('idle:left', m.countdown), `resets in ${m.countdown}`)} />] : []),
      ]
      : [<Text key="n" color={gyrOf(m.limit.percent)}>{m.number}</Text>, ...(m.countdown ? [<Text key="left" dimColor>{GAP + m.countdown}</Text>] : [])])
    // A hover tag, revealed by its scope's hover, out of the flow, so the row never moves. On the
    // desktop a chip drawn as the diff's is, its words in `ink`, the colour of what is hovered, its
    // right end that of the box around it: on the idle row the diff's (the bar's, with no diff), the
    // diff moving out of sight meanwhile; on the running row the row's. In a terminal its words on
    // the tags' grey, `right` cells from the row's end, over an unseen copy of the diff (`diffText`)
    // where one shows.
    const hoverTag = (key: string, scope: string, label: string, ink: string, right: number, diffText: string | null) => {
      if (Svg) {
        // room for the whole chip, whatever lies under it (with no diff, nothing), the chip at its
        // right end: the app keeps a picture within its box, and would squeeze it to nothing
        const chip = tagSvg([{ text: label, colour: ink }])
        return [
          <Box key={key} position="absolute" top={0} right={0} height={1} minWidth={Math.ceil(chip.width / NARROWEST_CELL_PX)}
            justifyContent="flex-end" display="none" hover={{ scope, display: 'flex' }}>
            <Svg {...pictured(chip, label)} />
          </Box>,
        ]
      }
      return [
        ...(diffText === null ? [] : [
          <Box key={`cover:${key}`} position="absolute" top={0} right={right} display="none" hover={{ scope, display: 'flex' }}>
            <Text {...TAG} color={TAG.backgroundColor}>{diffText}</Text>
          </Box>,
        ]),
        <Box key={key} position="absolute" top={0} right={right} display="none" hover={{ scope, display: 'flex' }}>
          <Text {...TAG}>{` ${label} `}</Text>
        </Box>,
      ]
    }
    // The usage marks, each with its tag (in a terminal `tagRight` cells from the row's end).
    const usageOf = (list: typeof marks, tagRight: number, diffText: string | null) => list.map(m => {
      const scope = `ctxbar-limit-${m.limit.window}`
      return {
        mark: (
          <Box key={`use${m.limit.window}`} flexDirection="row" flexShrink={0} hover={Svg ? { scope, backgroundColor: NO_CHANGE } : { scope }}>
            {weekly(m)}
            <Text>{GAP}</Text>
          </Box>
        ),
        tag: hoverTag(`usetag${m.limit.window}`, scope, limitTag(m.limit), gyrOf(m.limit.percent), tagRight, diffText),
        scope,
      }
    })

    // While anything runs, the row is the running bar instead: the dot, the week's quota used,
    // a lane for each task sharing the row equally, and the running time. Nothing else.
    if (isRunning(running)) {
      const { lanes, more } = lanesOf(running, now)
      // The week's quota used (the number alone; none off a subscription), the lanes, the time
      // and how many more, GAP between every two of them, lanes included.
      const quota = marks[0]
      const run = runTime(running, now)
      const head = quota === undefined ? GAP : `${GAP}${quota.number}${GAP}`
      const tail = `${GAP}${elapsed(run)}${more > 0 ? `${GAP}+${more}` : ''}`
      const room = cols - 1 - head.length - tail.length - (lanes.length - 1) * GAP.length
      if (lanes.length === 0 || room < FEWEST_CELLS) return beneath
      const each = Math.floor(room / lanes.length)
      // Everything that moves is placed by the run clock (each drawing starts every picture over,
      // so each starts where the last one was), and holds still while the work waits on the
      // person; each picture fades in where it first appears.
      const isStill = running.pausedSince !== null || liveCount(running) === 0 // waiting on the person, or all done
      const clockLook = eased('run:clock', elapsed(run).length) // the clock eases only when it gains a character
      const drawn = lanes.map((lane, i) => {
        const width = i === lanes.length - 1 ? room - each * (lanes.length - 1) : each
        const scope = laneScope(lane.key)
        const colour = lane.colour
        // The picture, and the pill laid over it: a picture of its own at its true size, as
        // wide as its words, the room beside it shared out in the trail's proportion, so its
        // left edge is at or before the trail's end. No key on the overlay: a keyed Box is a
        // hover scope of its own and would hide the lane's tag.
        const asPictures = (Picture: NonNullable<typeof Svg>) => {
          const laneShown = showing(`lane:${lane.key}`)
          const pill = lanePill(lane, width, size)
          // The pill's words and the trail's place each keep their own change: a step grows the trail
          // with the call's words, and its end puts the words back without moving it, so one record
          // would cut the trail's ease short. The pill eases from both, placed by the earlier.
          const said = eased(`pill:${lane.key}`, pill.text)
          const placed = eased(`trail:${lane.key}`, { start: pill.start, cells: width })
          const ages = [said.change?.changedMs, placed.change?.changedMs].filter((ms): ms is number => ms !== undefined)
          const sinceMs = ages.length === 0 ? Infinity : Math.max(...ages) // the earlier change, still easing
          const was = placed.change?.from ?? { start: pill.start, cells: width }
          // A running subagent's pill shows its name now and then (FLASH), timed from when its words
          // last changed in this surface's drawing, on the run clock: any change of words starts it
          // over, and a wait holds it at its frame, however often the row is drawn meanwhile. Words
          // that change while the name shows ease from the name.
          const stood = view && pill.name !== undefined ? seenFor(view, `flash:${lane.key}`, run, pill.text) : undefined
          const flash = pill.name === undefined || stood === undefined ? undefined
            : { name: pill.name, steadyMs: stood.stoodMs, isHeld: isStill, start: pill.start, cells: width }
          const wasNamed = pill.name !== undefined && stood?.fromStoodMs !== undefined && isNaming(stood.fromStoodMs)
          const badge = pillSvg(lane, pill.text, size, laneShown, sinceMs === Infinity
            ? undefined
            : { from: { text: wasNamed ? pill.name! : said.change?.from ?? pill.text, start: was.start, cells: was.cells }, start: pill.start, cells: width, changedMs: sinceMs }, flash)
          const grown = trailGrowth(placed.change, pill.start, width) // its new dots fade in
          return [
            <Picture key="picture" source={laneSvg(lane, width, run, { isHeld: isStill, shownMs: laneShown, waveS, grown })} alt={`${lane.kind}: ${lane.label}`} height={LANE_H} />,
            <Box position="absolute" top={0} left={0} right={0} height={1} flexDirection="row">
              <Box width={0} flexGrow={pill.start} />
              <Picture {...pictured(badge, pill.text)} />
              <Box width={0} flexGrow={width - pill.start} />
            </Box>,
          ]
        }
        // The terminal's cells: the words over the lane, the trail's part lit; a running subagent's
        // name in place of its words for FLASH.for now and then, at the second's redraw.
        const celled = () => {
          const isNamed = lane.kind === 'agent' && !lane.isDone && lane.title !== undefined && !isStill
            && isNaming(now - (lane.steadySince ?? lane.since))
          const cellsOf = laneCells(isNamed ? { ...lane, label: lane.title! } : lane, width)
          return [
            <Text key="lit" backgroundColor={colour} color="#ffffff">{cellsOf.lit}</Text>,
            <Text key="rest" backgroundColor={FREE} color={colour}>{cellsOf.rest}</Text>,
          ]
        }
        // Its hover tag. A terminal's says how long the task has run, redrawn each second. The desktop's
        // is a picture, which stands still while hidden, so a task still running gives the clock time it
        // began (no time where the person's offset from UTC is not known), and its words are cut so the
        // chip fits the row's narrowest cells; a finished task's says how long it took.
        const deskTime = lane.until !== undefined ? undefined : utcOffsetMin === undefined ? '' : `since ${clockTime(lane.since, utcOffsetMin)}`
        const tagOf = (most: number) => laneTag(lane, now, most, Svg ? deskTime : undefined)
        let most = cols - 2
        while (Svg && most > 1 && Math.ceil(tagWidth(tagOf(most)) / NARROWEST_CELL_PX) > cols - 1) most--
        return {
          lane: (
            // A lane takes its share of cells, and any room the font leaves on top: its picture
            // stretches to the box, so the row ends where the icons' cells begin (a terminal
            // leaves no room).
            <Box key={lane.key} flexDirection="row" width={width} flexGrow={1} height={1} flexShrink={0} overflow="hidden"
              position="relative" hover={Svg ? { scope, backgroundColor: NO_CHANGE } : { scope }}>
              {Svg ? asPictures(Svg) : celled()}
            </Box>
          ),
          tag: hoverTag(`tag:${lane.key}`, scope, tagOf(most), glow(colour), 0, null),
        }
      })
      // The clock's hover tag: the clock time the run began, on both surfaces (owner 31Oct26), as a
      // running lane's desktop tag gives it; none where the person's offset from UTC is not known.
      const clockScope = 'ctxbar-runclock'
      const clockTag = utcOffsetMin === undefined || running.since === null ? []
        : hoverTag('clocktag', clockScope, `since ${clockTime(running.since, utcOffsetMin)}`, timeTagInk(running.since), 0, null)
      if (view) (isDeskDrawn = true), (deskRow = 'running')
      return (
        <Box flexDirection="column">
          {beneath}
          <Box key="band" flexDirection="row" height={1}>
          <Box key="row" flexDirection="row" height={1} position="relative" width={cols} flexShrink={0}>
            {/* The dot lights up in each task's colour in turn: fading on the desktop, blinking in a terminal. */}
            {Svg
              ? <Svg source={dotSvg(liveCount(running) === 0 ? [] : lanes.map(l => l.colour), FREE, run, { isHeld: isStill, shownMs: showing('run:dot') })} alt="running" width={DOT_PX} height={LANE_H} />
              : <Text color={dotColour(lanes, now, FREE)}>●</Text>}
            <Text>{GAP}</Text>
            {quota && Svg && [<Svg key="quota" {...pictured(meter('run:quota', quota.limit.percent), `weekly ${quota.number}%`)} />, <Text key="qgap">{GAP}</Text>]}
            {quota && !Svg && [<Text key="quota" color={gyrOf(quota.limit.percent)}>{quota.number}</Text>, <Text key="qgap">{GAP}</Text>]}
            {drawn.flatMap((d, i) => (i === 0 ? [d.lane] : [<Text key={`gap:${lanes[i]!.key}`}>{GAP}</Text>, d.lane]))}
            {Svg
              ? [
                <Text key="cgap">{GAP}</Text>,
                <Box key="clock" flexDirection="row" flexShrink={0} hover={{ scope: clockScope, backgroundColor: NO_CHANGE }}>
                  <Svg {...pictured(clockSvg(run, isStill, clockLook.shownMs, clockLook.change), `running ${elapsed(run)}`)} />
                </Box>,
                ...(more > 0 ? [<Text key="mgap">{GAP}</Text>, <Svg key="more" {...pictured(words('run:more', `+${more}`, 'end'), `${more} more`)} />] : []),
              ]
              : <Box key="clock" flexDirection="row" flexShrink={0} hover={{ scope: clockScope }}><Text dimColor>{tail}</Text></Box>}
            {drawn.flatMap(d => d.tag)}
            {clockTag}
          </Box>
          {icon}
          </Box>
        </Box>
      )
    }

    // Idle: the context bar. It takes the whole row but the usage marks, the diff and the share; a
    // narrow row drops the diff first, then the marks, so the bar keeps its cells.
    const r = await read($, shown)
    if (!r) return beneath
    const end = inUse(r.percent)
    const kept = cols - end.length - markCells >= FEWEST_CELLS ? marks : []
    const rowCells = cols - end.length - (kept.length > 0 ? markCells : 0)
    if (rowCells < FEWEST_CELLS) return beneath
    // The branch's diff, between the bar and the share, in cells of its own (the
    // rows' one gap before it), so no part of the bar lies beneath it: a rounded chip in the tags'
    // grey on the desktop, as the app draws it, dark grey cells in a terminal; lines added in green,
    // removed in red. A hover tag takes its place while hovered. Only where the bar keeps its own
    // room beside it.
    const diff = await read($, diffNow)
    const counts = diff && [`+${grouped(diff.added)}`, `−${grouped(diff.removed)}`] as const
    const diffCells = counts ? GAP.length + counts[0].length + counts[1].length + 3 : 0
    const hasDiff = counts !== null && rowCells >= diffCells + FEWEST_CELLS
    const barCells = hasDiff ? rowCells - diffCells : rowCells
    const split = cells(r, barCells)
    const diffChip = Svg && hasDiff && counts
      ? tagSvg([{ text: counts[0], colour: ADDED }, { text: ' ', colour: TAG.color }, { text: counts[1], colour: REMOVED }], showing('idle:diff'))
      : undefined
    // The share closes the row, the task icon after it in the band: on the desktop a picture of
    // its own width, the row's end.
    const sharePicture = Svg ? words('idle:share', end.slice(GAP.length), 'end') : undefined
    // What a terminal's hover tags lie over: an unseen copy of the diff's text.
    const diffText = hasDiff && counts ? ` ${counts[0]} ${counts[1]} ` : null
    // On the desktop the chip lies over a room of its own in the row's flow, one gap either side.
    const diffTag = hasDiff && counts && (Svg
      ? <Svg key="diff" {...pictured(diffChip!, `${counts[0]} ${counts[1]} lines changed`)} />
      : (
        <Box key="diff" flexDirection="row" flexShrink={0}>
          <Text {...TAG}>{' '}</Text>
          <Text {...TAG} color={ADDED}>{counts[0]}</Text>
          <Text {...TAG}>{' '}</Text>
          <Text {...TAG} color={REMOVED}>{counts[1]}</Text>
          <Text {...TAG}>{' '}</Text>
        </Box>
      ))
    const usage = usageOf(kept, end.length, diffText)
    // The context used's hover tag: the clock time of this drawing. The desktop row is drawn when the turn
    // stops, so there it is the time the work stopped; a terminal redraws each second. None where the
    // person's offset from UTC is not known.
    const shareScope = 'ctxbar-share'
    const drawnAt = await $.clock.now()
    const stoppedAt = utcOffsetMin === undefined ? undefined : clockTime(drawnAt, utcOffsetMin)
    const shareTag = stoppedAt === undefined ? [] : hoverTag('sharetag', shareScope, stoppedAt, timeTagInk(drawnAt), end.length, diffText)

    // A stretch of the bar: a used slice is a colour box filled past its edge, so every cell
    // answers the pointer; the track is one straight line drawn in short pieces.
    const look = (s: Slice, scope: string, lit: string) => ({
      backgroundColor: s.kind === 'used' ? s.colour : undefined,
      hover: s.kind === 'used' ? { scope, backgroundColor: lit } : Svg ? { scope, backgroundColor: NO_CHANGE } : { scope },
    })
    // A row tall in a terminal; a pill's height on the desktop, what it holds centred in it.
    const tall = Svg ? { height: BAR_ROWS, alignSelf: 'center' as const, alignItems: 'center' as const } : { height: 1 }
    // The track: one straight line, each short piece pinned to its cells, so it never wraps.
    const track = (colour: string, width: number, key: string) =>
      Array.from({ length: Math.ceil(width / PIECE) }, (_, j) => {
        const cellsHere = Math.min(PIECE, width - j * PIECE)
        return (
          <Box key={`${key}.${j}`} width={cellsHere} height={1} flexShrink={0} overflow="hidden">
            <Text color={colour}>{LINE.repeat(cellsHere)}</Text>
          </Box>
        )
      })
    const stretch = (s: Slice, scope: string, lit: string, width: number, key: string) =>
      s.kind === 'used'
        ? <Text backgroundColor={s.colour} hover={{ scope, backgroundColor: lit }}>{FILL.repeat(width * 2)}</Text>
        : track(s.colour, width, key)
    const pieces = r.slices.flatMap((s, i) => {
      const width = split[i] ?? 0
      if (width === 0) return []
      const scope = `ctxbar-${i}`
      const lit = glow(s.colour)
      // A segment is pinned to its cells and one row, clipped, never wrapped, so no font
      // (the desktop app's draws a cell's glyph wider or narrower) can change the row.
      return [{
        s,
        i,
        width,
        scope,
        lit,
        segment: (
          <Box key={`seg${i}`} flexDirection="row" width={width} {...tall} flexShrink={0} overflow="hidden"
            {...look(s, scope, lit)}>
            {stretch(s, scope, lit, width, `seg${i}`)}
          </Box>
        ),
        // Its hover tag: in the diff's place on the desktop, its words in a used segment's lit step, and
        // for the track the same lightening of its grey, so it reads on the chip; just before the share
        // in a terminal.
        tag: hoverTag(`tag${i}`, scope, label(s, r), lit, end.length, diffText),
      }]
    })
    // The desktop app's font draws the row's text narrower or wider than the cells it was
    // counted in, so the last stretch runs on into whatever room is left: the share ends at
    // the row's edge, where the icons' cells begin. A terminal's cells are exact: it has none.
    const last = pieces[pieces.length - 1]
    const runOn = Svg && last && (
      <Box key="runon" flexDirection="row" width={0} flexGrow={1} {...tall} overflow="hidden"
        {...look(last.s, last.scope, last.lit)}>
        {stretch(last.s, last.scope, last.lit, RUN_ON, 'runon')}
      </Box>
    )
    // On the desktop the diff yields its place to a hover tag, which is as wide as its own words. A
    // hover can only reveal or move a box, never hide one, so the gap and the diff's room stay in the
    // row's flow (the room a clear picture the chip's width) and what shows there lies inside one box
    // per tag, each moving it two rows down while its own tag shows: the chip at the room's right end
    // leaves the clip, and, where the bar ends in its track, the track's line, two rows above the chip,
    // comes into it, running on through the gap and the room to the tag. A clear box over the gap and
    // the room keeps the pointer there from lighting a tag (the boxes that move the chip join their
    // tags' hover groups).
    const trackEnd = last && last.s.kind !== 'used' ? last.s.colour : undefined
    const deskDiff = Svg && diffTag && diffChip && [
      <Text key="dgap">{GAP}</Text>,
      <Svg key="room" {...pictured(clearSvg(diffChip.width), 'branch diff')} />,
      <Box key="clip" position="absolute" top={0} left={0} right={0} height={1} overflow="hidden">
        {[...pieces, ...usage, ...(stoppedAt === undefined ? [] : [{ scope: shareScope }])].reduceRight((inner, { scope }, k) => (
          <Box key={`hide${k}`} position="absolute" top={0} left={0} right={0} height={1} flexDirection="row"
            hover={{ scope, top: 2 }}>
            {inner}
          </Box>
        ), (
          <Box key="slide" position="absolute" top={0} left={0} right={0} height={1} flexDirection="row" justifyContent="flex-end">
            {diffTag}
            {trackEnd && (
              <Box key="line" position="absolute" top={-2} left={0} right={0} height={1} flexDirection="row" overflow="hidden">
                {track(trackEnd, diffCells * 2, 'line')}
              </Box>
            )}
          </Box>
        ))}
      </Box>,
      <Box key="guard" position="absolute" top={0} left={0} right={0} height={1} />,
    ]

    if (view) (isDeskDrawn = true), (deskRow = 'idle')
    return (
      <Box flexDirection="column">
        {beneath}
        <Box key="band" flexDirection="row" height={1}>
        <Box key="row" flexDirection="row" height={1} position="relative" width={cols} flexShrink={0}>
          {usage.map(u => u.mark)}
          {pieces.map(p => p.segment)}
          {runOn}
          {!Svg && diffTag && <Text key="dgap">{GAP}</Text>}
          {Svg
            ? (
              // the gap and the diff, and the hover tags that take its place, their right ends its own
              <Box key="tags" flexDirection="row" flexShrink={0}>
                {deskDiff}
                {pieces.flatMap(p => p.tag)}
                {usage.flatMap(u => u.tag)}
                {shareTag}
              </Box>
            )
            : diffTag}
          {sharePicture
            ? [
              <Text key="egap">{GAP}</Text>,
              <Box key="share" flexShrink={0} hover={{ scope: shareScope, backgroundColor: NO_CHANGE }}>
                <Svg {...pictured(sharePicture, `${end.slice(GAP.length)} of the window in use`)} />
              </Box>,
            ]
            : <Box key="share" flexShrink={0} hover={{ scope: shareScope }}><Text dimColor>{end}</Text></Box>}
          {!Svg && pieces.flatMap(p => p.tag)}
          {!Svg && usage.flatMap(u => u.tag)}
          {!Svg && shareTag}
        </Box>
        {icon}
        </Box>
      </Box>
    )
  })
}
