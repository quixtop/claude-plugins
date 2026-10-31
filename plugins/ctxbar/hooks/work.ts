// (c) Shrix
// author: shrix
// What is running now, for ctxbar's running row: the main turn, background shells and
// subagents, each a lane of the bar. Pure functions over the Work record; register.tsx
// feeds them the events and draws the lanes. The dotted trail follows the progress bar of
// the savvy-progress mod by JohnnyVizz (MIT).
import type { Ask, Finished, Running, Work } from '../types'

export const IDLE: Work = {
  since: null, inTurn: false, turnSince: null, tool: null, target: null, steps: 0, shells: [], agents: [], finished: [], stopped: [],
  asks: [], agentCalls: [], pausedSince: null, waited: 0,
}

// At work now: a subagent parked for a message it may never get (`waiting`, `idle`: one
// that can be resumed) is not running, and neither is a finished one.
const LIVE = new Set(['pending', 'running'])
// Background shells only: a monitor watches rather than works (an artifact's live-updates watch
// lasts the whole session), so it never holds the running row.
const SHELL_TYPES = new Set(['shell'])

// How long a task that just ended stays on show, done, before its lane goes.
export const FINISH_MS = 3000

// How many tasks run now: the main turn, subagents, background shells (done ones are not).
export const liveCount = (w: Work): number => (w.inTurn ? 1 : 0) + w.agents.length + w.shells.length

// The bar is up while anything runs, or a task that just ended is still on show.
export const isRunning = (w: Work): boolean => liveCount(w) > 0 || w.finished.length > 0

// The record as it is to be shown at `now`: whole (a record kept from an older build lacks
// the newer fields) and without done lanes past their few seconds, whether or not a beat
// came to clear them (none comes while the bar is hidden).
export function onShow(w: Work, now: number): Work {
  const whole = { ...IDLE, ...w }
  return { ...whole, finished: whole.finished.filter(f => now - f.endedAt < FINISH_MS) }
}

// The running time: from the start to now while anything runs, less the time it stood still
// waiting on the person; while it waits, it stands where the waiting began; with only done
// lanes on show, it stands at when the last of them ended.
export function runTime(w: Work, now: number): number {
  if (w.since === null) return 0
  const end = liveCount(w) > 0 ? (w.pausedSince ?? now) : Math.max(w.since, ...w.finished.map(f => f.endedAt))
  return Math.max(0, end - w.since - w.waited)
}

// Whether the running time stands still: something waits on the person (a permission prompt or
// a question), and nothing else moves: no background shell, and every subagent at work and the
// main thread in its turn either asking or waiting on a subagent of its own (an Agent call open).
// `asks` and `agentCalls` hold only callers still there (settle). The main thread asking while
// another of its calls runs beside it counts as waiting: such calls are reads, over in moments.
const isPaused = (w: Work): boolean => {
  const asking = new Set(w.asks.map(a => a.who))
  const waiting = new Set([...asking, ...w.agentCalls.map(c => c.who)])
  return asking.size > 0 && w.shells.length === 0 && w.agents.every(a => waiting.has(a.id))
    && (!w.inTurn || waiting.has('main'))
}

// What still has its caller there: the main thread in its turn, a subagent at work.
const present = <T extends { who: string }>(w: Work, list: readonly T[]): T[] =>
  list.filter(x => (x.who === 'main' ? w.inTurn : w.agents.some(g => g.id === x.who)))

// What changed from `prev` to `next` that ended: the main turn, a subagent or a shell that
// left its list. Each goes on show as done, keeping its colour; one done long enough goes.
// A task starting when none ran (only done lanes on show) starts the running time afresh.
export function ended(prev: Work, next: Work, now: number): Work {
  const gone = (was: readonly Running[], is: readonly Running[], kind: 'agent' | 'shell'): Finished[] =>
    was.filter(r => !is.some(i => i.id === r.id))
      .map(r => ({ key: `${kind}:${r.id}`, kind, label: r.label, since: r.since, endedAt: now, ...(r.hue === undefined ? {} : { hue: r.hue }) }))
  const turnEnded: Finished[] = prev.inTurn && !next.inTurn
    ? [{ key: 'inline', kind: 'inline', label: 'done', since: prev.turnSince ?? prev.since ?? now, endedAt: now }]
    : []
  const fresh = [...turnEnded, ...gone(prev.agents, next.agents, 'agent'), ...gone(prev.shells, next.shells, 'shell')]
  const kept = next.finished.filter(f => now - f.endedAt < FINISH_MS && !fresh.some(x => x.key === f.key))
  // A task that runs again (the next turn) is live, not done.
  const live = new Set([...(next.inTurn ? ['inline'] : []), ...next.agents.map(a => `agent:${a.id}`), ...next.shells.map(s => `shell:${s.id}`)])
  const isFresh = liveCount(prev) === 0 && liveCount(next) > 0
  const restart = isFresh ? { since: now, waited: 0, pausedSince: null } : {}
  return { ...next, ...restart, finished: [...kept, ...fresh].filter(f => !live.has(f.key)) }
}

// Keeps `since` true to its contract (set while the bar is up, kept from when the running
// began, null once nothing is on show), and gives each new task the first colour no task on
// show has, so every lane differs and none repaints when another ends.
export function settle(w: Work, now: number): Work {
  const used = new Set([...w.agents, ...w.shells, ...w.finished].flatMap(r => (r.hue === undefined ? [] : [r.hue])))
  const paint = (r: Running): Running => {
    if (r.hue !== undefined) return r
    let hue = 0
    while (used.has(hue)) hue++
    used.add(hue)
    return { ...r, hue }
  }
  // The time stops when waiting begins with nothing else moving, and the stop is added up
  // when it ends; an ask goes with whoever asked; with the bar down, nothing is kept.
  const asks = present(w, w.asks)
  const agentCalls = present(w, w.agentCalls)
  const paused = isPaused({ ...w, asks, agentCalls }) && liveCount(w) > 0
  const pausedSince = paused ? (w.pausedSince ?? now) : null
  const waited = w.waited + (!paused && w.pausedSince !== null ? now - w.pausedSince : 0)
  const up = isRunning(w)
  return {
    ...w, agents: w.agents.map(paint), shells: w.shells.map(paint), since: up ? (w.since ?? now) : null,
    pausedSince: up ? pausedSince : null, waited: up ? waited : 0, asks: up ? asks : [], agentCalls: up ? agentCalls : [],
  }
}

// A list as it stands now, each item keeping what it had when already known.
function keep(prev: readonly Running[], next: readonly { id: string; label: string; target?: string }[], now: number): Running[] {
  return next.map(n => {
    const known = prev.find(p => p.id === n.id)
    return known ? { ...known, ...n } : { ...n, since: now, steps: 0 }
  })
}

type Task = { id: string; type: string; status: string; description: string; command?: string }

// A shell's label (its description, else its command, else its type) and, where the label is its
// description, the command it runs.
// A description is kept whole (up to 200 characters): the pill picks its words and the tag cuts it to
// the row. One that only repeats the command is no description: the command names the shell then.
function shellWords(description: unknown, command: unknown, fallback: string): { label: string; target?: string } {
  const runs = typeof command === 'string' ? commandName(command) : ''
  const told = typeof description === 'string' ? labelOf(description, 200) : ''
  const isCommand = told === '' || (typeof command === 'string' && told === labelOf(command, 200))
  const label = (isCommand ? runs : told) || fallback
  return !isCommand && runs !== '' && runs !== label ? { label, target: runs } : { label }
}

// A command by its program and what that runs, for a lane's tag: past any leading `cd …`, settings
// (NAME=value) and sudo/nohup/exec/time, the program's name and up to two words after it, stopping
// at an option or the next command; a path stands as its last part.
// `cd /x && python3 tools/check.py --all` → `python3 check.py`.
export function commandName(command: string): string {
  const words = command.replace(/\n/g, ' ; ').replace(/^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/, '').trim().split(/\s+/)
  let i = 0
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || /^(sudo|nohup|exec|time|env)$/.test(words[i]!))) i++
  const last = (w: string) => w.replace(/^["']+|["']+$/g, '').split('/').filter(Boolean).pop() ?? w
  const kept: string[] = []
  for (const w of words.slice(i)) {
    if (kept.length > 0 && (w.startsWith('-') || /^(&&?|\|\|?|;|>|<|2>)/.test(w) || /^["']/.test(w))) break
    const ends = /[;&|]+$/.test(w)   // the next command glued on: `sleep 5;`
    const word = last(w.replace(/[;&|]+$/, ''))
    if (word !== '') kept.push(word)
    if (ends || kept.length === 3) break
  }
  return labelOf(kept.join(' ')) || labelOf(command)
}

// The words of a task's description that say what it does, for a pill too narrow for all of it: a
// leading time or condition clause goes ("At 04:20 UTC, …", "Every 5 min, …", "When …, …"), then
// filler words, times and numbers (a word starting with a digit) and marks with no letter; the first
// word left (most often the verb) and the last (most often what it acts on) stay. With nothing
// left, the description as it came.
const LEAD = /^(at|after|before|when|whenever|once|every|each|until|if|on|in|by)\s[^,]*,\s*/i
const FILLER = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'with', 'from', 'in', 'on', 'at', 'by', 'into', 'its', 'this', 'that', 'these', 'those', 'then', 'please', 'all', 'some', 'any'])
export function keyWords(text: string): string {
  const words = text.replace(LEAD, '').split(/\s+/)
    .map(w => w.replace(/^[("'`]+|[.,;:!?)"'`…]+$/g, ''))
    .filter(w => /\p{L}/u.test(w) && !FILLER.has(w.toLowerCase()) && !/^\d/.test(w))
  if (words.length === 0) return text
  return words.length === 1 ? words[0]! : `${words[0]} ${words[words.length - 1]}`
}

// The background shells still running, from the engine's list of in-flight work.
export function shellsFrom(prev: readonly Running[], tasks: readonly Task[], now: number): Running[] {
  const live = tasks.filter(t => SHELL_TYPES.has(t.type) && LIVE.has(t.status))
  return keep(prev, live.map(t => ({ id: t.id, ...shellWords(t.description, t.command, nameOf(t.type) || 'shell') })), now)
}

type AgentRow = { id: string; description: string; type: string; status: string }

// The subagents still running, from `$.agent.list()`.
export function agentsFrom(prev: readonly Running[], list: readonly AgentRow[], now: number): Running[] {
  const live = list.filter(a => LIVE.has(a.status))
  return keep(prev, live.map(a => ({ id: a.id, label: nameOf(a.description, a.type) || 'agent' })), now)
}

// The record with the subagents read afresh from `$.agent.list()`. The list lags a stop: an
// agent whose stop went through stays out, done, for as long as the list still calls it
// live, whatever reads it meanwhile. A start for it (a resumed agent) lets it back in.
export function withAgents(w: Work, list: readonly AgentRow[], now: number, change: { stopped?: string; started?: string } = {}): Work {
  const listed = new Set(list.filter(a => LIVE.has(a.status)).map(a => a.id))
  const stopped = new Set(w.stopped.filter(id => id !== change.started && listed.has(id)))
  if (change.stopped !== undefined && listed.has(change.stopped)) stopped.add(change.stopped)
  return { ...w, stopped: [...stopped], agents: agentsFrom(w.agents, list.filter(a => !stopped.has(a.id) && a.id !== change.stopped), now) }
}

// A background shell a call just started, until the next reading of the engine's list.
export function addShell(prev: readonly Running[], id: string, description: unknown, command: unknown, now: number): Running[] {
  return prev.some(s => s.id === id) ? [...prev] : [...prev, { id, ...shellWords(description, command, 'shell'), since: now, steps: 0 }]
}

// One more tool call of a subagent: the call now in flight, its tool and what it works on, its
// pill's words new as of `now`.
export function agentStep(prev: readonly Running[], id: string, call: string, tool: string, target: string, now: number): Running[] {
  return prev.map(a => (a.id === id ? { ...a, steps: a.steps + 1, call, tool, target, doingSince: now } : a))
}

// A subagent's call over: if it was the one shown, the agent shows `then` (another of its calls
// still in flight), else it is back to thinking; its pill's words are new as of `now` only if they
// changed (another call of the same tool leaves them be).
export function agentRest(prev: readonly Running[], id: string, call: string, now: number, then?: { call: string; tool: string; target: string }): Running[] {
  return prev.map(a => {
    if (a.id !== id || a.call !== call) return a
    const isSame = labelOf(then?.tool ?? '') === labelOf(a.tool ?? '')
    const doingSince = isSame ? a.doingSince : now
    const rest = { id: a.id, label: a.label, since: a.since, steps: a.steps, ...(doingSince === undefined ? {} : { doingSince }), ...(a.hue === undefined ? {} : { hue: a.hue }) }
    return then ? { ...rest, ...then } : rest
  })
}

// What a tool call works on, in a few words for a lane's tag: a file's name, a command's words, a
// pattern, a page's host, a query, a task's description, a skill, else a folder's name; '' with none.
export function targetOf(call: Readonly<Record<string, unknown>>): string {
  const text = (key: string) => (typeof call[key] === 'string' ? (call[key] as string).trim() : '')
  const nameIn = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const file = text('file_path') || text('notebook_path')
  if (file) return labelOf(nameIn(file))
  const url = text('url')
  if (/^file:/i.test(url)) return labelOf(nameIn(url.replace(/^file:/i, '')))
  if (url) {
    const host = url.replace(/^[a-z][a-z0-9+.-]*:(?=\/\/)/i, '').replace(/^\/\//, '').split(/[/?#]/)[0] ?? ''
    return labelOf(host.slice(host.lastIndexOf('@') + 1)) // never the credentials before an @
  }
  return labelOf(text('command') || text('pattern') || text('query') || text('description') || text('skill') || nameIn(text('path')))
}

// A tool call in flight: its id, who made it, its tool, the call as tool.call had it (the
// arguments beside the envelope's own keys), and whether something was put to the person for it.
export type InFlight = { call: string; who: string; tool: string; e: Readonly<Record<string, unknown>>; asked: boolean }
const ENVELOPE = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])
// A value as text, its keys in order at every depth: the same arguments read the same, however
// their keys were ordered.
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : x))
const argsOf = (e: Readonly<Record<string, unknown>>) => canon(Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE.has(k))))

// The call a permission prompt is about (the prompt names none): one in flight from the same
// caller and tool and not asking yet, the newest with the prompt's arguments if several; else the
// newest (one left over by an abandoned dispatch is older than any live call); null when none is
// in flight.
export function promptCall(calls: readonly InFlight[], asks: readonly Ask[], who: string, tool: string, input: unknown): string | null {
  const open = calls.filter(c => c.who === who && c.tool === tool && !asks.some(a => a.call === c.call))
  if (open.length > 1) {
    const same = canon(input)
    const match = open.filter(c => argsOf(c.e) === same).pop()
    if (match) return match.call
  }
  return open[open.length - 1]?.call ?? null
}

// A call is over (answered, refused, run or aborted): its ask closes, and with it any ask of the
// same caller that matched no call (the caller is at work again, so whatever that prompt was is
// behind it); an Agent call no longer holds its caller.
export function callOver(w: Work, call: string, who: string): Work {
  const asks = w.asks.filter(a => a.call !== call && !(a.call === null && a.who === who))
  const agentCalls = w.agentCalls.filter(c => c.call !== call)
  return asks.length === w.asks.length && agentCalls.length === w.agentCalls.length ? w : { ...w, asks, agentCalls }
}

// A few words, one line: control characters out, whitespace folded, cut to `most` characters
// (whole characters, never half of one).
export function labelOf(text: string, most = 40): string {
  const one = [...text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()]
  return one.length <= most ? one.join('') : `${whole(one.slice(0, most - 1)).join('')}…`
}

// The first of some words that is not blank, as a label; '' when all are.
const nameOf = (...words: (string | undefined)[]): string =>
  words.map(x => labelOf(x ?? '')).find(x => x !== '') ?? ''

// Running time to the second: 0:07, 1:24, 1:02:09.
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// A moment as a 12-hour clock time, on an offset from UTC (`offsetMin` minutes east): 9.05a,
// 9.00p, 12.30a.
export function clockTime(ms: number, offsetMin: number): string {
  const day = 24 * 60
  const m = (((Math.floor(ms / 60_000) + offsetMin) % day) + day) % day
  const two = (n: number) => String(n).padStart(2, '0')
  const hour = Math.floor(m / 60)
  return `${hour % 12 || 12}.${two(m % 60)}${hour < 12 ? 'a' : 'p'}`
}

// --- lanes: one per running task, sharing the bar equally ---

export type Kind = 'inline' | 'agent' | 'shell'
// `reach`: how far the lane's trail runs, 0 to under 1. Work done on a soft scale, never a
// share of a whole: no task here knows its end; a task that has ended reaches 1. `until`:
// when it ended, for a done lane.
// `label` is the pill's words; `title` names the task where the pill shows its tool instead (a
// subagent), and `steadySince` is since when those words have stood; `doing` is what its call in
// flight works on, or the command a shell runs.
export type Lane = {
  key: string; kind: Kind; label: string; steps: number | null; reach: number; since: number; colour: string
  isDone: boolean; until?: number; title?: string; steadySince?: number; doing?: string
}

const MAX_LANES = 4
export const INLINE_COLOUR = '#8B7BF2' // this turn's lane: violet, always
// The other tasks' colours, one each, none of them the turn's violet; past the last a
// colour comes round again (only with that many tasks running at once).
export const HUES = ['#4F8FEA', '#D29A2E', '#2BB3A3', '#E06C9F', '#6DBE45', '#E8834A', '#3CB8E0']
const hueOf = (r: { hue?: number }) => HUES[(r.hue ?? 0) % HUES.length]!

// The ink of the context used's time tag: one of the lane colours, a different one each minute
// (the minute number times 5, which is coprime with the 8 colours, so neighbours differ and all
// come round). The tag is drawn once a minute, so each drawing shows one colour throughout.
const TAG_INKS = [INLINE_COLOUR, ...HUES]
export const timeTagInk =(ms: number) => TAG_INKS[(Math.floor(ms / 60_000) * 5) % TAG_INKS.length]!

// x of half: 0 at none, a half at `half`, nearing 1 beyond; kept to twentieths, so a lane's
// picture changes now and then rather than every second.
export function soft(x: number, half: number): number {
  return Math.floor((x / (x + half)) * 20) / 20
}

// The lanes in order (the main turn, then subagents, then shells, each kind by when it
// began, a task that just ended keeping its place, done), at most MAX_LANES of them, and
// how many more beyond those.
export function lanesOf(record: Work, now: number): { lanes: Lane[]; more: number } {
  const w = onShow(record, now)
  const done = (f: Finished): Lane => ({
    key: f.key, kind: f.kind, label: `✓ ${f.label}`, steps: null, reach: 1, since: f.since,
    colour: f.kind === 'inline' ? INLINE_COLOUR : hueOf(f), isDone: true, until: f.endedAt,
  })
  const ofKind = (kind: Kind) => w.finished.filter(f => f.kind === kind).map(done)
  const bySince = (a: Lane, b: Lane) => a.since - b.since
  const all: Lane[] = [
    ...(w.inTurn && w.since !== null
      ? [{ key: 'inline', kind: 'inline' as const, label: labelOf(w.tool ?? '') || 'thinking', steps: w.steps, reach: soft(w.steps, 8), since: w.turnSince ?? w.since, colour: INLINE_COLOUR, isDone: false, ...(w.tool && w.target ? { doing: w.target } : {}) }]
      : ofKind('inline')),
    ...[
      ...w.agents.map(a => ({
        key: `agent:${a.id}`, kind: 'agent' as const, label: labelOf(a.tool ?? '') || 'thinking', steps: a.steps, reach: soft(a.steps, 8), since: a.since, colour: hueOf(a), isDone: false,
        title: a.label, steadySince: a.doingSince ?? a.since, ...(a.tool ? { doing: [labelOf(a.tool), a.target ?? ''].filter(Boolean).join(' ') } : {}),
      })),
      ...ofKind('agent'),
    ].sort(bySince),
    ...[
      ...w.shells.map(s => ({ key: `shell:${s.id}`, kind: 'shell' as const, label: s.label, steps: null, reach: soft((now - s.since) / 1000, 60), since: s.since, colour: hueOf(s), isDone: false, ...(s.target ? { doing: s.target } : {}) })),
      ...ofKind('shell'),
    ].sort(bySince),
  ]
  return { lanes: all.slice(0, MAX_LANES), more: Math.max(0, all.length - MAX_LANES) }
}

// The running bar's dot (desktop): a grey dot, each task's colour fading up over it in turn
// and away again (about a second lit, a second dark, then the next task's colour), placed by
// the run clock like the lanes, so a redraw never jumps it, and holding still where it is while
// the work waits on the person. With every task done it is the grey alone (register.tsx). DOT_PX
// across, no margin: the row's gap after it is the row's GAP alone.
export const DOT_PX = 8
// `grown`: a lane's trail that grew within EASE_S, from what cell, and how long ago.
export type Look = { isHeld?: boolean; shownMs?: number; waveS?: number; grown?: { from: number; changedMs: number } }

// A trail that grew in a lane of the same width (register.tsx keeps where it ended): from what cell,
// and how long ago. None in a lane that resized (it moved itself), nor under 3 cells, where the
// picture draws on a grid of its own.
export function trailGrowth(change: { from: { start: number; cells: number }; changedMs: number } | undefined, start: number, cells: number) {
  return change !== undefined && change.from.cells === cells && cells >= 3 && change.from.start < start
    ? { from: change.from.start, changedMs: change.changedMs }
    : undefined
}
export function dotSvg(colours: readonly string[], dark: string, clockMs: number, { isHeld = false, shownMs = Infinity }: Look = {}): string {
  const period = 2 * Math.max(1, colours.length)
  const at = (s: number) => +((s / period) * 100).toFixed(3) // a moment of a slot, as a share of the cycle
  const t = secondsInto(clockMs, period)
  // each colour's place in the cycle a rule of the picture's own style sheet, as the lanes' are
  const delays = colours.map((_, i) => `.d${i}{animation-delay:-${secondsInto((t - 2 * i) * 1000, period).toFixed(2)}s}`).join('')
  const lit = colours.map((colour, i) => `<circle class="d d${i}" cx="4" cy="${LANE_H / 2}" r="4" fill="${colour}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT_PX}" height="${LANE_H}" viewBox="0 0 ${DOT_PX} ${LANE_H}"><style>`
    + (lit.length
      ? `.d{opacity:0;animation:dl ${period}s ease-in-out infinite${isHeld ? ' paused' : ''}}${delays}@keyframes dl{0%{opacity:0}${at(0.3)}%{opacity:1}${at(0.8)}%{opacity:1}${at(1.2)}%{opacity:0}100%{opacity:0}}`
        + '@media (prefers-reduced-motion: reduce){.d{animation:none}.d0{opacity:1}}'
      : '')
    + `${fadeIn(shownMs)}</style><g class="fi"><circle cx="4" cy="${LANE_H / 2}" r="4" fill="${dark}"/>${lit.join('')}</g></svg>`
}

// The running bar's dot in a terminal: dark every other second; lit the seconds between,
// each time in the next lane's colour, so with several tasks it blinks through them in turn.
export function dotColour(lanes: readonly Lane[], now: number, dark: string): string {
  const second = Math.floor(now / 1000)
  if (second % 2 === 1 || lanes.length === 0) return dark
  return lanes[Math.floor(second / 2) % lanes.length]!.colour
}

// The hover tag's words for a lane: what it is, what it is doing, how much done, and `time` (by
// default how long it has run, or, done, how long it took; '' for none); cut to `most` characters
// (whole ones), so it never runs past the row.
export function laneTag(lane: Lane, now: number, most = Infinity, time = elapsed((lane.until ?? now) - lane.since)): string {
  const kind = lane.kind === 'inline' ? 'this turn' : lane.kind === 'agent' ? 'subagent' : 'background'
  const steps = lane.steps === null ? '' : `${lane.steps} step${lane.steps === 1 ? '' : 's'}`
  const head = [...`${kind}: ${lane.title ?? lane.label}`]
  const tail = [...[lane.doing ?? '', steps, time].filter(Boolean).map(part => ` · ${part}`).join('')]
  const cut = (chars: string[], room: number) => `${whole(chars.slice(0, Math.max(0, room - 1))).join('')}…`
  if (head.length + tail.length <= most) return [...head, ...tail].join('')
  // too long: the name gives way first, so what the task runs and its time stay, while there is room
  const room = most - tail.length
  return room >= 16 ? `${cut(head, room)}${tail.join('')}` : cut([...head, ...tail], most)
}

const pillWords = (lane: Lane) => (lane.steps === null ? lane.label : `${lane.label} ${lane.steps}`)

// --- the picture of one lane (desktop) ---

export const LANE_H = 18 // px: the picture's height, two less than a row of text draws
const BAR_H = 14
const DOT = 3 // px: the trail's grid

// A fixed scatter in [0, 1), so a lane's dots stay where they are between redraws.
function scatter(c: number, r: number): number {
  const v = Math.sin(c * 127.1 + r * 311.7) * 43758.5453
  return v - Math.floor(v)
}

// A lane's pill: where the trail ends, in the lane's cells, and its words, as wide as fits a
// pill of `size.maxPx` (less its padding either side) and half the lane (a cell 8px or more). Wider
// words are cut to fit, never inside an emoji, ending '…' before the step count; a count that
// leaves no room goes, the '…' standing for it. In a lane too narrow for even one character
// and the '…' (3 cells or fewer), the shortest cut is drawn and the lane clips it. The row sits the pill at
// the trail's end, sharing out the room beside it in the same proportion, so it never passes
// the trail's end (register.tsx). A running task's trail stops a cell short of the end; one
// that has ended reaches it, and its pill sits at the lane's end.
// `name`: a running subagent's own name with its count, fitted the same way, for the moments its
// pill shows who it is (FLASH) rather than what it does.
export function lanePill(lane: Lane, cells: number, size: PillSize = PILL): { start: number; text: string; name?: string } {
  const most = Math.min(size.maxPx - 2 * size.padPx, cells * 4)
  const count = lane.steps === null ? '' : ` ${lane.steps}`
  const fit = (words: string, room = most) => (textPx(`${words}${count}`) <= room ? `${words}${count}` : fitted(words, count, room))
  const end = lane.isDone ? cells : cells - 1
  // a background task's description (one named by its command has no `doing`) too long for the pill
  // gives way to the words that say what it does
  const text = fit(lane.kind === 'shell' && lane.doing !== undefined && textPx(lane.label) > most ? keyWords(lane.label) : lane.label)
  // the name's pill never wider than the words' or a lane of 6px cells, so it always fits the lane;
  // a lane too small for even its shortest cut shows no name
  const nameRoom = Math.min(most, Math.max(textPx(text), cells * 6 - 2 * size.padPx))
  const fitName = lane.kind === 'agent' && !lane.isDone && lane.title !== undefined ? fit(lane.title, nameRoom) : undefined
  const name = fitName !== undefined && textPx(fitName) <= nameRoom ? fitName : undefined
  return { start: Math.max(0, Math.min(end, Math.round(cells * lane.reach))), text, ...(name === undefined ? {} : { name }) }
}

// A running subagent's pill, its words standing a while, shows its name for a moment and goes back:
// FLASH.after ms on the same words, then FLASH.for ms of its name, again every FLASH.every ms. Each
// swap fades the one out before the other comes in, and the pill eases between the two widths over
// EASE_S, as any change of words.
export const FLASH = { after: 7000, for: 3000, every: 10000 }
export const isNaming = (steadyMs: number) => steadyMs >= FLASH.after && (steadyMs - FLASH.after) % FLASH.every < FLASH.for

// The description cut to `most` px with its '…' and the count; with no room for even one of
// its characters beside the count, the count goes and the description alone is cut.
function fitted(label: string, count: string, most: number): string {
  const chars = [...label]
  const cut = (n: number, tail: string) => `${whole(chars.slice(0, n)).join('').trimEnd()}…${tail}`
  const fits = (tail: string) => {
    let n = chars.length
    while (n > 1 && textPx(cut(n, tail)) > most) n--
    return n
  }
  const n = fits(count)
  return textPx(cut(n, count)) <= most ? cut(n, count) : cut(fits(''), '')
}

// --- the pill (desktop): a picture of its own, as wide as its words ---

// The pill's font: JetBrains Mono (installed here as the Nerd Font Mono build), else another
// monospace; regular 12px (every weight of it advances alike). Every character it draws advances 7.2px, 0.6em (measured in Chromium,
// which the desktop app draws with: 100 'i' or 100 'W' 720.00px, '…' '✓' 'é' 7.20; Menlo,
// the fallback, 7.22). What a fallback font draws is counted a little wide, so a pill is
// never short of its words: an emoji 15.5 (it draws 15.0, whatever modifies it), what joins
// or modifies one 0, a flag's two letters 8 each (a flag draws 15), CJK and the like 12.5
// (漢 draws 12.25).
const MONO_PX = 7.2
const PILL_FONT = "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono NFM', 'JetBrains Mono', ui-monospace, Menlo, monospace"

const ZWJ = 0x200d
const isFlagLetter = (c: number) => c >= 0x1f1e6 && c <= 0x1f1ff

// The characters of a cut, so it ends on a whole one: no joiner left dangling (its emoji
// would draw as part of the '…'), and flag letters kept in pairs.
function whole(chars: string[]): string[] {
  const out = [...chars]
  while (out.length > 0 && out[out.length - 1]!.codePointAt(0) === ZWJ) out.pop()
  let flags = 0
  while (flags < out.length && isFlagLetter(out[out.length - 1 - flags]!.codePointAt(0)!)) flags++
  if (flags % 2 === 1) out.pop()
  return out
}

const EMOJI = /\p{Emoji_Presentation}/u
// What draws nothing, or nothing of its own: combining marks (a keycap's too), zero-width spaces
// and joiners, direction marks and controls, the word joiner and invisible operators, the
// Mongolian vowel separator, the byte-order mark, the soft hyphen, variation selectors, skin
// tones (drawn into the emoji before), tag characters.
const BLANK = /[\p{Mn}\p{Me}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{61c}\u{180e}\u{feff}\u{ad}\u{fe00}-\u{fe0f}\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]/u
const VS16 = 0xfe0f // asks for the emoji form of the character before it

// One character's width; `next` is the code point after it.
function glyphPx(ch: string, code: number, next: number | undefined): number {
  if (BLANK.test(ch)) return 0
  if (isFlagLetter(code)) return 8 // a flag's letter: two make one
  if (next === VS16 || EMOJI.test(ch)) return 15.5 // an emoji, as one is or as asked for
  if ((code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) return MONO_PX // the font's own icons (the Nerd Font build)
  if (code >= 0x2e80 || (code >= 0x1100 && code <= 0x115f) || (code >= 0x2460 && code <= 0x24ff)) return 12.5 // CJK, Hangul, ①
  if (code >= 0x530 && code < 0x1e00) return 9 // scripts the font lacks (Armenian to Indic): a fallback, a little wider
  return MONO_PX // Latin (Vietnamese too), Greek, Cyrillic, box drawing, symbols the font has
}

export function textPx(text: string): number {
  const chars = [...text]
  let px = 0
  let joined = false // the character after a joiner is drawn into the one before it
  chars.forEach((ch, i) => {
    const code = ch.codePointAt(0)!
    if (!joined) px += glyphPx(ch, code, chars[i + 1]?.codePointAt(0))
    joined = code === ZWJ
  })
  return Math.round(px * 100) / 100 // to the hundredth: ten 7.2s sum to 72, not 72.00000000000001
}

export const PILL_H = 16
// The pill's size, px: the widest it gets and the room either side of its words. Set by the
// mod's options (plugin.json userConfig: pillMaxWidth, pillPadding), read by pillSize.
export type PillSize = { maxPx: number; padPx: number }
export const PILL: PillSize = { maxPx: 100, padPx: 8 } // 84px of words; "thinking 99" is 79.2

// The options as a size: a number is kept to the range that draws (padding 0-24px; width
// from room for a short name and its count, 36px of words, up to 400), anything else takes
// the default.
export function pillSize(options: Readonly<Record<string, unknown>>): PillSize {
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
  const padPx = clamp(num(options.pillPadding) ?? PILL.padPx, 0, 24)
  return { padPx, maxPx: clamp(num(options.pillMaxWidth) ?? PILL.maxPx, 2 * padPx + 36, 400) }
}

// Markup-safe text: the five markup characters as references, and any character XML does
// not allow (a lone surrogate, U+FFFE, U+FFFF, control characters) dropped.
const xml = (s: string) => s
  .replace(/[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// A change eases from what was shown to what is over EASE_S, soft at both ends, placed by how
// long ago it changed (`changedMs`), so a drawing during it carries on where the last one was.
export const EASE_S = 0.35
const ease = (name: string, changedMs: number) => `animation:${name} ${EASE_S}s ease-in-out both;animation-delay:-${(Math.max(0, changedMs) / 1000).toFixed(2)}s`
// A cross-fade with no dip: the new fades in over the first half, the old out over the second, so
// whatever the two share stays whole throughout.
const fadeIns = (name: string) => `@keyframes ${name}{0%{opacity:0}50%{opacity:1}100%{opacity:1}}`
const fadeOuts = (name: string) => `@keyframes ${name}{0%{opacity:1}50%{opacity:1}100%{opacity:0}}`
// A swap with a dip, for words that do not line up: the old fade out over the first half, the new
// in over the second, so the two are never on show together.
const goesFirst = (name: string) => `@keyframes ${name}{0%{opacity:1}50%{opacity:0}100%{opacity:0}}`
const comesAfter = (name: string) => `@keyframes ${name}{0%{opacity:0}50%{opacity:0}100%{opacity:1}}`
// A pill's words that differ only in their step count, at the same length, line up character for
// character (thinking 22, thinking 23): they cross-fade. Any other change of words dips.
const linesUp = (was: string, is: string) => [...was].length === [...is].length && was.replace(/ \d+$/, '') === is.replace(/ \d+$/, '')
const hundredth = (n: number) => Math.round(n * 100) / 100
const cssPx = (n: number) => `${hundredth(n)}px`

// A pill whose words or place changed (register.tsx keeps what it was): its words, where the
// trail ends in the lane's cells, and how long ago it changed.
export type PillChange = { from: { text: string; start: number; cells: number }; start: number; cells: number; changedMs: number }
// The app does not say how many pixels a cell is (7 to 9, more where a lane has room beyond its
// cells): a move of whole cells is counted at 8, so it starts about a pixel a cell off, and ends
// exactly where the row puts the pill.
const CELL_PX = 8
const PILL_DEEP = '#2c2c2c' // the track's grey (dark), which a pill's colour leans a little toward

// The pill as its own picture, drawn at its true size (never stretched): a rounded shape in
// the lane's colour, its words and `size.padPx` either side (`size.maxPx` at most), the words
// centred in it. Given a change still easing, the old pill becomes the new one: the old words fade
// out inside the shape before the new come in (a count alone cross-fades, see linesUp), and the
// shape moves and widens or narrows to its new place, in a picture
// as wide as the move needs (up to a lane of 6px cells), placed so the new pill shows exactly
// where the plain one would: the row shares the room beside the picture in the trail's
// proportion f, so a pill w wide shows (lane − w) × f from the lane's left, whatever the
// picture's width. A lane that resized moved itself too, so there the pill eases its words and
// width where it now is.
// A running subagent's name (lanePill), how long its pill's words have stood, whether the run waits
// on the person (the cycle holds its frame), and the pill's place on its lane, in cells.
export type PillFlash = { name: string; steadyMs: number; isHeld: boolean; start: number; cells: number }
// One element's animations, listed together; a flash's is set by how long the words have stood and
// starts after them with no fill, so an ease of a change before it is never overridden.
type Run = { name: string; spec: string; delayS: number; isPaused?: boolean }
const delayOf = (s: number) => `${s <= 0 ? '-' : ''}${Math.abs(s).toFixed(2)}s` // as ease() writes it: -0.00s at the start
const animate = (runs: readonly Run[]) => (runs.length === 0 ? '' : `animation:${runs.map(r => `${r.name} ${r.spec}`).join(',')};animation-delay:${runs.map(r => delayOf(r.delayS)).join(',')}`
  + (runs.some(r => r.isPaused) ? `;animation-play-state:${runs.map(r => (r.isPaused ? 'paused' : 'running')).join(',')}` : ''))
export function pillSvg(lane: Lane, text: string, size: PillSize = PILL, shownMs = Infinity, change?: PillChange, flash?: PillFlash): { source: string; width: number } {
  // exact, not rounded up to a whole pixel: the padding either side is the padding set, no more
  const widthOf = (words: string) => Math.min(size.maxPx, Math.round((textPx(words) + 2 * size.padPx) * 10) / 10)
  const width = widthOf(text)
  // Solid, the lane's colour a little deeper toward the track; the words a light tint of it, not white.
  const fill = blend(lane.colour, PILL_DEEP, 0.18)
  const words = (s: string, x: number, cls = '') => `<text${cls && ` class="${cls}"`} x="${x}" y="${LANE_H / 2}" dominant-baseline="central" text-anchor="middle" font-family="${PILL_FONT}" font-size="12" fill="${lighten(lane.colour, 0.85)}">${xml(s)}</text>`
  const svg = (w: number, style: string, body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LANE_H}" viewBox="0 0 ${w} ${LANE_H}"><style>${style}</style><g class="fi">${body}</g></svg>`
  const isResized = change !== undefined && change.from.cells !== change.cells
  const isEasing = change !== undefined && change.changedMs < EASE_S * 1000
    && (change.from.text !== text || (!isResized && change.from.start !== change.start))
  if (!isEasing && !flash) {
    return {
      width,
      source: svg(width, fadeIn(shownMs),
        `<rect y="${(LANE_H - PILL_H) / 2}" width="${width}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${fill}"/>${words(text, width / 2)}`),
    }
  }
  // The picture is P wide and lies on the lane by its own width (its left at (lane − P) × f), so the
  // pill inside it sits at (P − its width) × f: where a picture of the pill's own width would lie.
  let f = flash ? flash.start / Math.max(1, flash.cells) : 0
  let was = width
  let offset = 0
  let P = width
  if (isEasing) {
    // A lane narrowed past the old pill: the old pill starts no wider than the lane now allows, so it
    // stays in place, its words clipped to the shape.
    was = isResized ? Math.min(widthOf(change.from.text), Math.max(width, change.cells * 6)) : widthOf(change.from.text)
    f = change.start / Math.max(1, change.cells)
    const fWas = isResized ? f : change.from.start / Math.max(1, change.from.cells)
    const cellsMoved = isResized ? 0 : change.from.start - change.start
    offset = cellsMoved * CELL_PX - (was * fWas - width * f) // where the old pill showed, from the new one
    // Room for the old pill on the side it comes from, never wider than a lane of 6px cells, so the
    // row's room beside it never runs out; past that, the old pill starts a little nearer.
    const room = Math.max(was, width, offset < 0 && f > 0 ? width - offset / f : 0, f < 1 ? (offset + was - width * f) / (1 - f) : 0)
    P = Math.min(room, Math.max(width, change.cells * 6))
  }
  const named = flash ? widthOf(flash.name) : width
  P = hundredth(Math.max(P, named))
  const at = (P - width) * f
  const atName = (P - named) * f
  const old = Math.min(Math.max(0, at + offset), P - was)
  const t = change?.changedMs ?? 0
  const isWidening = isEasing && was !== width
  const isMoving = isEasing && hundredth(old) !== hundredth(at)
  const isCrossFade = isEasing && linesUp(change.from.text, text)
  // The flash: the words fade out over the first half of a swap as the pill eases to its width and
  // place, then the name fades in over the second; and back after FLASH.for, the same way.
  const pct = (ms: number) => +((ms / FLASH.every) * 100).toFixed(3)
  const [half, swap, hold, back, done] = [EASE_S * 500, EASE_S * 1000, FLASH.for, FLASH.for + EASE_S * 500, FLASH.for + EASE_S * 1000].map(pct)
  const flashes = (name: string): Run => ({ name, spec: `${FLASH.every / 1000}s ease-in-out infinite`, delayS: (FLASH.after - (flash?.steadyMs ?? 0)) / 1000, isPaused: flash?.isHeld })
  const eases = (name: string): Run => ({ name, spec: `${EASE_S}s ease-in-out both`, delayS: -Math.max(0, t) / 1000 })
  const isReshaped = flash !== undefined && (named !== width || hundredth(atName) !== hundredth(at))
  const rect = (cls: string, attrs = '') => `<rect class="${cls}" y="${(LANE_H - PILL_H) / 2}" width="${width}" height="${PILL_H}" rx="${PILL_H / 2}"${attrs}/>`
  const moves = [...(isMoving ? [eases('pm')] : []), ...(isReshaped ? [flashes('fm')] : [])]
  const widens = [...(isWidening ? [eases('pw')] : []), ...(isReshaped ? [flashes('fw')] : [])]
  const fades = [...(isEasing ? [eases('pn')] : []), ...(flash ? [flashes('fa')] : [])]
  const style = `.pm{transform:translateX(${cssPx(at)})${moves.length > 0 ? `;${animate(moves)}` : ''}}`
    + (isMoving ? `@keyframes pm{from{transform:translateX(${cssPx(old)})}to{transform:translateX(${cssPx(at)})}}` : '')
    + (widens.length > 0 ? `.pw{${animate(widens)}}` : '')
    + (isWidening ? `@keyframes pw{from{width:${cssPx(was)}}to{width:${cssPx(width)}}}` : '')
    + `.pc{transform:translateX(${cssPx(width / 2)})${isWidening ? `;${ease('pc', t)}}@keyframes pc{from{transform:translateX(${cssPx(was / 2)})}to{transform:translateX(${cssPx(width / 2)})}}` : '}'}`
    + (isEasing ? `.po{opacity:0;${ease('po', t)}}${isCrossFade ? fadeOuts('po') : goesFirst('po')}` : '')
    + (fades.length > 0 ? `.pn{${animate(fades)}}` : '')
    + (isEasing ? (isCrossFade ? fadeIns('pn') : comesAfter('pn')) : '')
    + (flash
      ? `.fn{opacity:0;${animate([flashes('fn')])}}`
        + `@keyframes fn{0%{opacity:0}${half}%{opacity:0}${swap}%{opacity:1}${hold}%{opacity:1}${back}%{opacity:0}100%{opacity:0}}`
        + `@keyframes fa{0%{opacity:1}${half}%{opacity:0}${back}%{opacity:0}${done}%{opacity:1}100%{opacity:1}}`
        + (isReshaped
          ? `@keyframes fm{0%{transform:translateX(${cssPx(at)})}${swap}%{transform:translateX(${cssPx(atName)})}${hold}%{transform:translateX(${cssPx(atName)})}${done}%{transform:translateX(${cssPx(at)})}100%{transform:translateX(${cssPx(at)})}}`
            + `@keyframes fw{0%{width:${cssPx(width)}}${swap}%{width:${cssPx(named)}}${hold}%{width:${cssPx(named)}}${done}%{width:${cssPx(width)}}100%{width:${cssPx(width)}}}`
          : '')
      : '')
    + `@media (prefers-reduced-motion: reduce){.pm,.pw,.pc,.po,.pn${flash ? ',.fn' : ''}{animation:none}}`
    + fadeIn(shownMs)
  return {
    width: P,
    source: svg(P, style,
      `<defs><clipPath id="pk">${rect('pw')}</clipPath></defs>`
      + `<g class="pm">${rect('pw', ` fill="${fill}"`)}`
      + `<g clip-path="url(#pk)"><g class="pc">${isEasing ? words(change.from.text, 0, 'po') : ''}${words(text, 0, 'pn')}</g>`
      + `${flash ? words(flash.name, named / 2, 'fn') : ''}</g></g>`),
  }
}

// --- the row's figures (desktop): pictures in the pills' font, as wide as their characters ---

// A picture that fades in over FADE_S where it first appears; `shownMs`, how long it has been on
// show, places the fade, so a later drawing of one already shown draws it whole, never again faint.
const FADE_S = 0.2
function fadeIn(shownMs: number): string {
  if (!(shownMs < FADE_S * 1000)) return ''
  return `.fi{animation:fi ${FADE_S}s ease-out both;animation-delay:-${(Math.max(0, shownMs) / 1000).toFixed(2)}s}@keyframes fi{from{opacity:0}}`
    + '@media (prefers-reduced-motion: reduce){.fi{animation:none}}'
}

// The figures' inks, light and dark: the app's own ink, and its dimmed ink for what is secondary.
const INK = '.ink{fill:#141413}.dim{fill:#73726c}@media (prefers-color-scheme: dark){.ink{fill:#f5f4ee}.dim{fill:#9c9a92}}'
const TRACK = '.k{fill:#e4e4e2}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}}'
const tenth = (px: number) => Math.round(px * 10) / 10
const figure = (width: number, style: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LANE_H}" viewBox="0 0 ${width} ${LANE_H}"><style>${style}</style><g class="fi">${body}</g></svg>`
const glyph = (text: string, x: number, y: number, tone: string, anchor = 'start') =>
  `<text x="${x}" y="${y}" dominant-baseline="central" text-anchor="${anchor}" font-family="${PILL_FONT}" font-size="12" class="${tone}">${xml(text)}</text>`

// The tags' grey: the app's own chip grey, as its branch bar draws the diff.
export const CHIP_GREY = '#373737'
// The branch diff as the app draws its own, and a hover tag drawn as it is: a rounded chip in the
// tags' grey (16px tall, corners a fifth of its height as the app's own), its words at its right end
// with 6px either side, each part its own colour; the diff fades in where it first appears
// (`shownMs`), as every picture in the row's flow does, and a hover tag, given none, shows at once.
const TAG_CHIP = { h: 16, r: 3.2, pad: 6 }
export const tagWidth = (words: string) => tenth(textPx(words) + 2 * TAG_CHIP.pad)
export function tagSvg(parts: readonly { text: string; colour: string }[], shownMs = Infinity): { source: string; width: number } {
  const width = tagWidth(parts.map(p => p.text).join(''))
  const spans = parts.map(p => `<tspan fill="${p.colour}">${xml(p.text)}</tspan>`).join('')
  return {
    width,
    source: figure(width, fadeIn(shownMs),
      `<rect y="${(LANE_H - TAG_CHIP.h) / 2}" width="${width}" height="${TAG_CHIP.h}" rx="${TAG_CHIP.r}" fill="${CHIP_GREY}"/>`
      + `<text x="${tenth(width - TAG_CHIP.pad)}" y="${LANE_H / 2}" dominant-baseline="central" text-anchor="end" font-family="${PILL_FONT}" font-size="12" style="white-space:pre">${spans}</text>`),
  }
}

// A clear picture `width` px wide: it holds the diff's room in the row's flow while the diff lies
// over that room, free to move out of sight.
export const clearSvg = (width: number) => ({ width, source: figure(width, '', '') })

// Words as a picture, exactly their own width: the reset countdown, the share, the +N.
// Words that changed (register.tsx keeps what they were) and how long ago.
export type TextChange = { from: string; changedMs: number }
// Given a change still easing, the old words fade out as the new fade in, with no dip. They are
// held at the end the row holds the picture by (`anchor`: the countdown by its start, the share
// and the +N, at the row's end, by theirs), so what old and new share stays put; the picture is
// the new words' width, so longer old words lose their far end at its edge as they fade.
export function textSvg(text: string, tone: 'ink' | 'dim', shownMs = Infinity, change?: TextChange, anchor: 'start' | 'end' = 'start'): { source: string; width: number } {
  const width = tenth(textPx(text))
  const x = anchor === 'end' ? width : 0
  const words = (s: string) => glyph(s, x, LANE_H / 2, tone, anchor)
  if (change === undefined || !(change.changedMs < EASE_S * 1000) || change.from === text) {
    return { width, source: figure(width, INK + fadeIn(shownMs), words(text)) }
  }
  return {
    width,
    source: figure(width, INK + crossFade(change.changedMs) + fadeIn(shownMs), `<g class="to">${words(change.from)}</g><g class="tn">${words(text)}</g>`),
  }
}
// The old part (.to) out, the new (.tn) in, placed by how long ago the change was.
const crossFade = (changedMs: number) => `.to{opacity:0;${ease('to', changedMs)}}${fadeOuts('to')}.tn{${ease('tn', changedMs)}}${fadeIns('tn')}`
  + '@media (prefers-reduced-motion: reduce){.to,.tn{animation:none}}'

// The weekly quota: its digits are its meter, in its band's colour from the bottom up to the share
// used and pale above, nothing behind them; exactly as wide as the digits: it starts and ends
// with them. The band's colour is the GYR colour transition (REFS/palette.html), a step each 10%
// of the number shown, red from 90.
const GYR = ['#00E676', '#32E35A', '#76D83E', '#A8D02A', '#D4C520', '#F0B418', '#F59312', '#F06910', '#E8400E', '#E01616'] as const
export const gyrOf = (percent: number) =>
  GYR[Number.isFinite(percent) ? Math.min(GYR.length - 1, Math.max(0, Math.floor(Math.round(percent) / 10))) : 0]!
// The digits' ink in the picture, set centred on its middle row: from 13.12 (the baseline at 13,
// the round digits 0.12 below it) up to 4.12, 9px tall. Measured in Chromium, which the app
// draws with: JetBrains Mono 12px, central baseline at y 9 → alphabetic 13, digits' ink ascent
// 8.76 (flat) to 8.88 (round), descent 0 to 0.12; Menlo, the fallback, sets its baseline at 13 too.
const INK_BOTTOM = 13.12
const INK_H = 9
// A weekly number that changed (register.tsx keeps what it was) and how long ago.
export type MeterChange = { from: number; changedMs: number }
// Given a change still easing, the old number fades out as the new fades in, the new one's lit
// part rising or falling from the old level to its own. The picture is the new number's width:
// an old number that is narrower stays where it was (the picture's left edge does not move), one
// that is wider would not fit, so then the new number fades in alone.
export function chipSvg(percent: number, shownMs = Infinity, change?: MeterChange): { source: string; width: number } {
  const shownOf = (p: number) => Math.max(0, Math.round(p))
  const shown = shownOf(percent)
  const text = String(shown)
  const width = tenth(text.length * MONO_PX)
  const topOf = (n: number) => hundredth(INK_BOTTOM - INK_H * Math.min(100, n) / 100) // the lit part's top: n% of the way up the digits
  const top = topOf(shown)
  // Above the lit part: the colour pale on a dark app; faint on a light one, where pale would vanish.
  const inks = (n: number, tag = '') => {
    const colour = gyrOf(n)
    return `.lo${tag}{fill:${colour};opacity:0.45}@media (prefers-color-scheme: dark){.lo${tag}{fill:${lighten(colour, 0.6)};opacity:1}}.hi${tag}{fill:${colour}}`
  }
  const number = (s: string, x: number, tag = '') => glyph(s, x, LANE_H / 2, `lo${tag}`, 'middle')
  const lit = (s: string, x: number, clip: string, tag = '') => `<g clip-path="url(#${clip})">${glyph(s, x, LANE_H / 2, `hi${tag}`, 'middle')}</g>`
  const isEasing = change !== undefined && Number.isFinite(percent) && Number.isFinite(change.from)
    && change.changedMs < EASE_S * 1000 && shownOf(change.from) !== shown
  if (!isEasing) {
    return {
      width,
      source: figure(width, `${inks(shown)}${fadeIn(shownMs)}`,
        number(text, width / 2)
        + (shown > 0
          ? `<defs><clipPath id="m"><rect y="${top}" width="${width}" height="${hundredth(LANE_H - top)}"/></clipPath></defs>${lit(text, width / 2, 'm')}`
          : '')),
    }
  }
  const was = shownOf(change.from)
  const old = String(was)
  const oldWidth = tenth(old.length * MONO_PX)
  const keepsOld = oldWidth <= width
  const t = change.changedMs
  const style = (keepsOld ? inks(was, '0') + `.mo{opacity:0;${ease('mo', t)}}${fadeOuts('mo')}` : '') + inks(shown)
    + `.mn{${ease('mn', t)}}${fadeIns('mn')}`
    + `.mc{${ease('mt', t)}}@keyframes mt{from{y:${cssPx(topOf(was))}}to{y:${cssPx(top)}}}`
    + '@media (prefers-reduced-motion: reduce){.mo,.mn,.mc{animation:none}}'
    + fadeIn(shownMs)
  return {
    width,
    source: figure(width, style,
      `<defs>${keepsOld ? `<clipPath id="m0"><rect y="${topOf(was)}" width="${width}" height="${LANE_H}"/></clipPath>` : ''}`
      + `<clipPath id="m"><rect class="mc" y="${top}" width="${width}" height="${LANE_H}"/></clipPath></defs>`
      + (keepsOld ? `<g class="mo">${number(old, oldWidth / 2, '0')}${lit(old, oldWidth / 2, 'm0', '0')}</g>` : '')
      + `<g class="mn">${number(text, width / 2)}${lit(text, width / 2, 'm')}</g>`),
  }
}

// The running time as a picture that ticks by itself: each digit a strip of numerals stepped by an
// animation of its own (seconds every second, tens of seconds every ten, and so on up), placed by
// the run clock, so the row is not drawn anew each second (and each drawing would start every
// picture in it over). It cannot show a digit it has no room for, so each strip runs on only to
// just before the time gains one (10:00, 1:00:00, …) and holds there: a wider picture drawn a
// moment late is a late tick, never a wrong time. Waiting on the person, or with nothing left
// running, it holds the time as it stands, dimmed.
const DIGITS: readonly (readonly [number, number])[] = [[10, 10], [60, 6], [600, 10], [3600, 6], [36000, 10], [360000, 10], [3600000, 10], [36000000, 10]] // [period s, numerals], from the right
export const WIDER_AT_MS = [600_000, 3_600_000, 36_000_000, 360_000_000, 3_600_000_000] // the time gains a character: mm:ss, h:mm:ss, hh:mm:ss, hhh:mm:ss, hhhh:mm:ss
// The clock's characters before it widened (register.tsx keeps them) and how long ago it did.
export type ClockChange = { from: number; changedMs: number }
export function clockSvg(runMs: number, isHeld = false, shownMs = Infinity, change?: ClockChange): { source: string; width: number } {
  const text = elapsed(runMs)
  const width = tenth(text.length * MONO_PX)
  const middle = (i: number) => tenth(i * MONO_PX + MONO_PX / 2)
  if (isHeld) return { width, source: figure(width, INK + fadeIn(shownMs), [...text].map((ch, i) => glyph(ch, middle(i), LANE_H / 2, 'dim', 'middle')).join('')) }
  // Just widened: the time the old picture held (9:59 before 10:00) fades out over the wider clock,
  // both held at their right end, as the row holds the clock.
  const widenedAt = change !== undefined && change.changedMs < EASE_S * 1000 && change.from < text.length
    ? WIDER_AT_MS.find(at => at <= runMs && elapsed(at - 1000).length === change.from)
    : undefined
  const easing = widenedAt === undefined
    ? undefined
    : { style: crossFade(change!.changedMs), old: `<g class="to">${glyph(elapsed(widenedAt - 1000), width, LANE_H / 2, 'ink', 'end')}</g>` }
  const seconds = runMs / 1000
  const wider = WIDER_AT_MS.find(at => at > runMs)
  const left = wider === undefined ? Infinity : (wider - runMs) / 1000 // seconds this picture's width holds
  let place = 0 // which digit, counted from the right
  const strips: string[] = []
  const rules: string[] = []
  ;[...text].reverse().forEach((ch, back) => {
    const i = text.length - 1 - back
    if (ch === ':') {
      strips.push(glyph(':', middle(i), LANE_H / 2, 'ink', 'middle'))
      return
    }
    const [period, count] = DIGITS[place]!
    const numerals = Array.from({ length: count }, (_, n) => glyph(String(n), middle(i), LANE_H / 2 + n * LANE_H, 'ink', 'middle')).join('')
    strips.push(`<g class="c${place}">${numerals}</g>`)
    const into = ((seconds % period) + period) % period
    // on to half a step before the time widens, then held on the numeral of that last step: half a step, so
    // the count is never whole (a whole count holds the strip one place past its last numeral, blank)
    const runs = left === Infinity ? 'infinite' : `${((into + left) / period - 0.5 / count).toFixed(6)} forwards`
    rules.push(`.c${place}{animation:c${place} ${period}s steps(${count}) ${runs};animation-delay:-${into.toFixed(2)}s}`
      + `@keyframes c${place}{to{transform:translateY(-${count * LANE_H}px)}}`)
    place++
  })
  const clock = `<g clip-path="url(#l)">${strips.join('')}</g>`
  return {
    width,
    source: figure(width, INK + rules.join('') + (easing?.style ?? '') + fadeIn(shownMs),
      `<defs><clipPath id="l"><rect width="${width}" height="${LANE_H}"/></clipPath></defs>${easing ? `${easing.old}<g class="tn">${clock}</g>` : clock}`),
  }
}

// One lane's picture: a rounded track, and a dotted trail to where the pill sits, sparse at the
// lane's start and denser along it, in the lane's colour; the task still running, its dots
// re-scatter in a wave from the trail's start to the pill (laneSvg). Everything that moves is
// before the pill (the pill, its own picture, sits over the trail's end); past it, the lane's
// colour lies light over the track, still. No pill and no words.
//
// It is drawn on the lane's own grid (UNIT a cell) and stretched to whatever box it is
// given: its own width is far wider than any lane, the box takes a picture's own width up
// to its slot, so it always takes the whole slot (measured in Chromium: no lane short of
// its box at 70 or 104 columns). The grid's unit is close to a cell's width, so a dot
// stays near square.
export const LANE_IMAGE_PX = 4000
const UNIT = 10 // grid units a cell
const MAX_UNITS = 1600 // a wide lane is drawn on a coarser grid, keeping the picture small

// The wave: one scatter of dots on show; a front crosses the trail from its start to the pill
// once every WAVE_S, and each stretch it passes fades its dots across to the next of WAVE_SETS
// scatters (a soft cross-fade, long enough that neighbours blend into one front), then the
// next crossing starts over at the beginning. All in the lane's colour: only where the dots are
// changes. The stretches widen as the front goes (waveStretches), a path per scatter in each, so
// it is pure CSS: a short rule per stretch and per path, some 150 at the widest trail. Placed by the run clock, so a picture drawn anew (the
// trail grew) carries on where the last one was, and one drawn while the work waits on the person
// holds still at that very frame.
const WAVE_S = 4.8 // seconds a crossing unless the options say: brisk enough to be seen moving, not raced
const WAVE_SETS = 4 // scatters in turn: the fifth crossing brings the first back

// The wave's seconds a crossing, from the mod's options (plugin.json userConfig: waveSeconds): a
// number kept between 2 and 30, to a tenth of a second; anything else the default.
export function waveSeconds(options: Readonly<Record<string, unknown>>): number {
  const value = options.waveSeconds
  if (typeof value !== 'number' || !Number.isFinite(value)) return WAVE_S
  return Math.round(Math.min(30, Math.max(2, value)) * 10) / 10
}
const FRONT_COLS = 4 // the front's first stretch, in columns of dots; each next one a column wider
// Each stretch cross-fades over three times the time the front takes to cross it, soft at both
// ends, so two or three neighbouring stretches are mid-fade together and the change sweeps on as
// one soft front (at twice the time only about one stretch was, measured in Chromium); 0.6s at
// least, half a crossing at most (a stretch that is most of a short trail).
const fadeOf = (cols: number, trailCols: number, waveS: number) => Math.min(waveS / 2, Math.max(0.6, ((3 * cols) / trailCols) * waveS))
const WASH = 0.2 // the lane's colour past its trail, over the track

// Where the wave's stretches start, in columns of dots: the first FRONT_COLS wide, each next one a
// column wider, so the front starts narrow and widens toward the pill. By place, not by share of
// the trail, so a trail that grows keeps its stretches where they were.
export function waveStretches(trailCols: number): number[] {
  const starts: number[] = []
  for (let at = 0, width = FRONT_COLS; at < trailCols; at += width, width++) starts.push(at)
  return starts
}
const secondsInto = (ms: number, period: number) => Math.round((((ms / 1000) % period) + period) % period * 100) / 100

// A lighter step of a colour, `toward` of the way to white (anything but #rrggbb comes back
// as it came): the hover glow (register.tsx) and the weekly meter's pale part (chipSvg).
export function lighten(hex: string, toward: number): string {
  return blend(hex, '#ffffff', toward)
}

// A colour `toward` of the way to another (anything but #rrggbb comes back as it came).
export function blend(hex: string, other: string, toward: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex) || !/^#[0-9a-f]{6}$/i.test(other)) return hex
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - toward) + parseInt(other.slice(i, i + 2), 16) * toward)
  return `#${[1, 3, 5].map(i => mix(i).toString(16).padStart(2, '0')).join('')}`
}

// `clockMs`: the run clock when the picture is drawn, which places the wave (0, its start).
export function laneSvg(lane: Lane, cells: number, clockMs = 0, { isHeld = false, shownMs = Infinity, waveS = WAVE_S, grown }: Look = {}): string {
  const cycleS = waveS * WAVE_SETS
  const n = Math.max(3, Math.round(cells))
  const unit = Math.min(UNIT, MAX_UNITS / n)
  const W = Math.round(n * unit)
  const rows = Math.floor(BAR_H / DOT)
  // The trail ends where the pill sits; the pill, laid over, starts at or before that point,
  // so no track shows between the two.
  const trailCells = lanePill(lane, n).start
  const trailX = trailCells * unit
  const trailCols = Math.floor(trailX / DOT)
  // Each dot a 2px square, drawn as path steps: a dozen characters a dot, so even the widest
  // lane with all its scatters stays inside the picture's size limit.
  const dot = (c: number, r: number) => `M${c * DOT + 1} ${r * DOT + 1}h2v2h-2z`
  // Sparse at the lane's start, denser along it: by place in the lane, not in the trail, so a
  // trail that grows keeps every dot it had and only adds at its end. The first scatter is the
  // one a task that ended keeps, still.
  const laneCols = Math.max(1, Math.floor(W / DOT))
  const isWaving = !lane.isDone && trailCols > 0
  const starts = isWaving ? waveStretches(trailCols) : [0]
  const stretchOf = (c: number) => { let j = 0; while (j + 1 < starts.length && starts[j + 1]! <= c) j++; return j }
  const paths: string[] = []
  const delays: string[] = []
  for (let k = 0; k < (isWaving ? WAVE_SETS : 1); k++) {
    const bands: string[][] = starts.map(() => [])
    for (let c = 0; c < trailCols; c++) {
      const density = 0.3 + 0.6 * Math.pow(c / laneCols, 1.3)
      const j = stretchOf(c)
      for (let r = 0; r < rows; r++) if (scatter(c + 97 * k, r + 13 * k) < density) bands[j]!.push(dot(c, r))
    }
    bands.forEach((d, j) => {
      if (d.length === 0) return
      if (!isWaving) return void paths.push(`<path d="${d.join('')}"/>`)
      paths.push(`<path class="b${j} s${k}b${j}${k === 0 ? ' z' : ''}" d="${d.join('')}"/>`)
      const reached = (k + starts[j]! / trailCols) * waveS // when, in a cycle, the front reaches this stretch for this scatter
      delays.push(`.s${k}b${j}{animation-delay:-${secondsInto(clockMs - reached * 1000, cycleS).toFixed(2)}s}`)
    })
  }
  // Each stretch's own fade, its scatter on show for one crossing: in as the front reaches it,
  // out as the next front does. The delay rules come after, so theirs is the delay that holds.
  const quarter = 100 / WAVE_SETS
  const frames = isWaving
    ? starts.map((start, j) => {
      const f = +((fadeOf((starts[j + 1] ?? trailCols) - start, trailCols, waveS) / cycleS) * 100).toFixed(3)
      return `.b${j}{opacity:0;animation:f${j} ${+cycleS.toFixed(2)}s ease-in-out infinite${isHeld ? ' paused' : ''}}`
        + `@keyframes f${j}{0%{opacity:0}${f}%{opacity:1}${quarter}%{opacity:1}${+(quarter + f).toFixed(3)}%{opacity:0}100%{opacity:0}}`
    }).join('')
    : ''
  const stretches = starts.map((_, j) => `.b${j}`).join(',')
  // A trail that grew: the stretch it gained wears its old look (the track and the wash) over the
  // new dots and lets it go, so they fade in rather than appear.
  const isGrowing = grown !== undefined && grown.changedMs < EASE_S * 1000 && grown.from < trailCells
  const fromX = isGrowing ? grown.from * unit : trailX
  const veil = isGrowing
    ? `<g class="gv"><rect class="k" x="${hundredth(fromX)}" width="${hundredth(trailX - fromX)}" height="${BAR_H}"/>`
      + `<rect x="${hundredth(fromX)}" width="${hundredth(trailX - fromX)}" height="${BAR_H}" opacity="${WASH}"/></g>`
    : ''
  const style = [
    TRACK,
    frames,
    delays.join(''),
    isWaving ? `@media (prefers-reduced-motion: reduce){${stretches}{animation:none}.z{opacity:1}}` : '',
    isGrowing ? `.gv{opacity:0;${ease('gv', grown.changedMs)}}@keyframes gv{from{opacity:1}to{opacity:0}}@media (prefers-reduced-motion: reduce){.gv{animation:none}}` : '',
    fadeIn(shownMs),
  ].filter(Boolean).join('\n')
  const y0 = (LANE_H - BAR_H) / 2
  // Past the trail, under the pill and on to the lane's end: a light wash of the lane's colour,
  // so the work still ahead reads as the task's own.
  const wash = trailCells < n ? `<rect x="${hundredth(trailX)}" width="${hundredth(W - trailX)}" height="${BAR_H}" opacity="${WASH}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LANE_IMAGE_PX}" height="${LANE_H}" viewBox="0 0 ${W} ${LANE_H}" preserveAspectRatio="none">
<style>
${style}
</style>
<defs><clipPath id="c"><rect width="${W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<g class="fi"><rect class="k" y="${y0}" width="${W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)" transform="translate(0,${y0})" fill="${lane.colour}">${wash}${paths.join('')}${veil}</g></g>
</svg>`
}

// --- the text form of one lane (terminal) ---

// The lane's cells: its words over its width, the trail's part (on the lane's colour) and
// the rest (on the track's grey), cut at whole characters, never half of one.
export function laneCells(lane: Lane, cells: number): { lit: string; rest: string } {
  const n = Math.max(1, cells)
  const words = [...` ${pillWords(lane)}`]
  const text = words.length > n ? [...words.slice(0, Math.max(0, n - 1)), '…'] : [...words, ...Array<string>(n - words.length).fill(' ')]
  const lit = Math.max(1, Math.min(n, Math.round(n * lane.reach)))
  return { lit: text.slice(0, lit).join(''), rest: text.slice(lit, n).join('') }
}
