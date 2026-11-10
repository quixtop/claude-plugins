// (c) Shrix
// author: shrix
// The task pane: a small Tasks app over the /todo file, docked beside the transcript. todo.py is
// the only reader and writer; the pane runs it with argv and draws what it prints (spec
// ~/.agents/skills/ctxbar/docs/spec/ctxbar-task-panel.md). register.tsx calls registerTasks(on), tasksSessionStart($)
// and tasksTurnEnd($), serves /todo with todoCommand($) and the noun with toggleBadge($); another mod's icon (ctxbar's)
// reads the badge.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TasksView, TodoBadge } from '../types'
import {
  type FolderView, type Item, type PendingCount, type TaskError, type TaskOp, type TaskState, argvEdit, argvRead, bundledTodoPy,
  checkTitle, escapeStep, fieldRows, isError, matches, newestFirst, nextHue, parseResult, queryWords, shownTitle, tildePath, validHue,
} from './taskfile'

// The projects' colours (owner 6 Nov 2026): the Accent colors of REFS/palette.html. Light, so navy reads on them.
const HUES = ['#FFC799', '#99FFE4', '#FF5EB3', '#00D4FF', '#FF6B6B']

const PANE = 'todo-tasks'
const TITLE = 'Tasks'
const RUN_TIMEOUT_MS = 5_000 // spec 4.7: a todo.py run that takes longer is a `process` error
const CHECK_MS = 60_000 // spec A15: the open pane's own look at the file
const PAGE = 200 // spec A14: rows shown before "show more"
const BLANK = ' ' // a cell of a press laid over words: a no-break space is never trimmed away
const SELECTED_INK = '#000000' // the title's word, on the project's colour
const EDIT = '✏︎' // ✏ a plain pencil, tip at the lower left (owner 30 Oct 2026); its text form, never the emoji
// ◀, pointing at the chat beside the pane: puts the task into the prompt box (owner 31 Oct 2026); its text form.
const SEND = '◀︎'
// The search icon at the title row's right (owner 1 Nov 2026), the magnifier's text form; `s` opens it too (a
// Button hotkey is one letter or digit, so never `/`).
const SEARCH = '⌕' // a line lens, text-only (owner 2 Nov 2026: 🔍︎ drew a filled lens on the desktop)
const SEARCH_KEY = 's'
const SEARCH_RING = 'search' // the icon's press: where the ring rests once the bar closes
const RULE_INK = '#4A4A4A' // the line between tasks: dim grey
const RULE_CELLS = 400 // blank cells the line is underlined across, cut at the pane's edge
const SELECTED_ROW = '#2C2C2C' // the task j / k landed on: a ground one step lighter than the pane's
// The tasks' stripes, each list from its first: navy (owner 1 Nov 2026) with the title in the project's colour, then the
// project's colour with the title in navy (owner 4 Nov 2026: the colour of the title bar, in place of gold).
const NAVY = '#14213D'
// The selected task's ground (owner 4 Nov 2026): a lighter navy than either stripe, so it never matches the row beside
// it, the title in the project's colour.
const SELECTED_STRIPE = '#3A5A8C'
const TITLE_LINES = 6 // a task's title shows whole up to this many lines, then cut with an ellipsis (shownTitle)
const NO_COLOUR = '#E6E6E6' // the title bar and stripe in the moment before a project has its colour
const MTIME_SLACK_MS = 1 // todo.py's mtime (ns / 1e6) and the engine's differ in the last digits
const TOP = '(no folder)' // todo.py's label for the lines above the first heading
const LOG = 'todo: '

// The title row stays on top (owner 30 Oct 2026). A docked pane on a graphical surface draws its
// own window: the tree is the pane's room tall plus a row of scroll per list entry (a task, a field,
// a "show more", the Completed toggle) past the first. The engine scrolls it as ever (the wheel,
// its scroll bar and keys); each drawing puts the window — the title row, the list from that many
// entries down, the footer — where the engine's window stands. A tick moves a whole task: the pane
// cannot measure a task's height on screen, so the list never moves by lines.
const PAGE_ENTRIES = 5 // a page key moves the list this many entries, not a window's worth of rows
// j / k reckon a task's height high on purpose — a desktop's text lines are taller than its rows —
// so they scroll a little early rather than ever leave the selection out of view. The reckoning
// decides only when j / k scroll, never what the wheel can reach.
const LINE_ROWS = 1.5
let windowed = false // the latest drawing drew its own window (a page key's cap is for that alone)
let paneFocused = false // the latest drawing's pane held the keyboard (Esc's undo is for that alone)
let drawnTop = 0 // the list's first entry, as last drawn in the pane's own window
let landedTop: number | null = null // where the last wheel tick landed, until the engine's window is there: a flick's ticks add up
let lastAt = 0 // the engine's window as last drawn
let pins = 0 // numbers the list's places (tasksTop.n)
let droppedPin = -1 // the place a drawing saw the engine's window move off

const CLEAN = { renaming: null, adding: false, addAt: null, shape: null, selected: null, search: null }
const CLOSE_ADD = { adding: false, addAt: null, addDraft: '', editError: null, shape: null } // the add field closed: its text and its error go
const EMPTY_VIEW: TasksView = {
  result: null, editError: null, pinned: [], inFlight: [], showCompleted: false, shown: PAGE, shownDone: PAGE,
  ...CLEAN, addDraft: '', adds: 0, readAt: 0,
}

const tasksOpen = atom({ plugin: 'todo', key: 'tasksOpen' } as const, false)
const tasksPending = atom({ plugin: 'todo', key: 'tasksPending' } as const, null as PendingCount | null, { shape: 'tasks-pending-3' })
const tasksView = atom({ plugin: 'todo', key: 'tasksView' } as const, EMPTY_VIEW, { shape: 'tasks-view-13' })
const tasksColours = atom({ plugin: 'todo', key: 'tasksColours' } as const, {} as Record<string, number>, { shape: 'tasks-colours-3' })
// What the focus ring holds: written on every move, read only when a key is pressed, never
// while drawing, so moving the focus redraws nothing (A12, A14).
const tasksFocus = atom({ plugin: 'todo', key: 'tasksFocus' } as const, null as string | null)
// Where the pane draws the list from when it moved the list itself (j / k, the person's wheel tick
// or scroll key landed by the `ui.scroll` hook): its first entry, and the engine's window it was set
// against; it holds only while the engine's window still stands there, so a move the hook never
// saw (the scroll bar dragged) wins. The engine moves a plugin's own `$.ui.scroll` without handing it
// to the pane's hook (owner 31 Oct 2026, seen on the desktop), so j / k can't land the engine's
// window where they want; a write here redraws the pane even when the engine's window stays put.
const tasksTop = atom({ plugin: 'todo', key: 'tasksTop' } as const, null as { top: number; at: number; n: number } | null, { shape: 'tasks-top-2' })
// What another mod's icon reads (ctxbar's task icon), as any mod's value may be read: the pane up or not, and the
// pending count. Written whenever one of them changes, never derived by the reader. NO_BADGE until the session start
// writes it, and the noun's answer when no hook of this mod serves it.
export const NO_BADGE: TodoBadge = { available: false, open: false, pending: null }
const badge = atom({ plugin: 'todo', key: 'badge' } as const, NO_BADGE)
let badging: Promise<void> = Promise.resolve()
// The badge as this module last wrote it: the change is merged into it and compared with it, never with a read back in
// the same dispatch (a dispatch's reads may not see its own writes). Null after a reload: the session start writes anew.
let written: TodoBadge | null = null
const sameBadge = (a: TodoBadge, b: TodoBadge) => a.available === b.available && a.open === b.open && a.pending?.total === b.pending?.total
// One write at a time, the change carried in, and only when the badge changed: every write redraws its readers
// (mod-design rule 22). Never throws: a failed write leaves the icon as it was until the next change.
function syncBadge($: EngineInterface, change: Partial<TodoBadge>): Promise<void> {
  badging = badging.catch(() => undefined).then(async () => {
    const next: TodoBadge = { ...(written ?? NO_BADGE), ...change, available: true }
    if (written !== null && sameBadge(written, next)) return
    await update($, badge, () => next)
    written = next
  })
  return badging.catch(() => $.ui.log(`${LOG}badge not written`, { to: 'debug' }))
}
// The tasks loaded into the prompt box (◀ or l) since the last send; the person's next send ticks
// those whose title it holds (owner 6 Nov 2026).
let loaded: { id: string; title: string }[] = []

let check: { cancel(): void } | undefined
let queue: Promise<unknown> = Promise.resolve()
let queued = 0 // edits waiting or running: a re-read waits for them (A19)
let seq = 0 // bumped by every read and edit as it starts: a read applies only if nothing started after it
const pending = new Set<string>() // rows and folders with an edit queued: a second press is refused
let toggling: Promise<void> = Promise.resolve()
let lastChange: { at: number; token: string } | null = null // the last save that wrote, for Esc's undo
const UNDO_MS = 10_000 // owner 30 Oct 2026: Esc within 10 s of a change undoes it; later, Esc closes
const PIN_MS = 10_000 // owner 30 Oct 2026: a ticked task stays, struck, 10 s, then goes to Completed
const DD_MS = 1_000 // dd deletes: the second d within vim's default timeoutlen (1000 ms)
const pinTimers = new Map<string, { cancel(): void }>() // a held row's release, one per row
let armedD: { id: string; at: number } | null = null // the task a first d landed on
let ringAt: string | null = null // the element the focus ring is on, as the last ui.focus said

// Puts the file back as it was before the last save made here (todo.py's token: it refuses when
// anything was written since), only within 10 s of that save (Esc's undo).
function undo($: EngineInterface): boolean {
  if (!lastChange || Date.now() - lastChange.at > UNDO_MS) return false
  void edit($, { op: 'undo', token: lastChange.token }, 'undo').catch(() => undefined)
  return true
}
let painting: Promise<void> = Promise.resolve() // colour updates, one at a time
const typed = new Map<string, string>() // what each open field holds as typed, for its ✓ (no redraw per key)
// Each field's shape (`<key>:<rows>:<filled>`) as last drawn or asked for: typing redraws only when it changes, judged
// against this rather than a drawing's own view, which a second key can beat to the next drawing.
const shapes = new Map<string, string>()
type Save = (t: string) => void // a refused title leaves the field open
const SEARCH_IDLE_MS = 10_000 // owner 2 Nov 2026: a search bar left with no words closes after 10 s
// Its own timer, so a field forgetting its typing leaves it running; the pane's close stops it.
let searchIdle: { cancel(): void } | undefined

const ROW_KEY = /^[txudeps]:/ // a task row's controls: tick, delete, up, down, edit, put back, send
// Where the ring rests while a task is selected (j / k, a save): a hidden button that is never
// redrawn away, so the pane keeps the keys (a row's ✏ is redrawn as the selection moves, and the
// keys went back to the prompt with it); Enter on it edits the selected task.
const EDIT_KEY = 'k:enter'
// Each icon's colour (owner 30 Oct 2026: ✕ red everywhere, the others each their own), as theme
// keys. Looked up by the exact glyph: EDIT carries its text-form selector (U+FE0E).
// The search lens is dim grey, drawn as the others are, a size step up (owner 2 Nov 2026: as a Button it was tiny).
// A plain `x` closes a field unsaved, the task left as it was (owner 6 Nov 2026), dim grey and a size smaller.
const LEAVE = 'x'
const ICON_INK: Record<string, string> = { '✕': 'error', [EDIT]: 'warning', '↩': 'success', '✓': 'success', '↑': 'suggestion', '↓': 'suggestion', [SEND]: 'claude', [SEARCH]: 'inactive', [LEAVE]: 'inactive' }
// Each colour's bright version: an icon under the pointer, and a task row's icons, which show only while
// their row is hovered, from the start (owner 30 Oct 2026: it lights up, no ground; 8 Nov 2026: the row's too).
const ICON_BRIGHT: Record<string, string> = { error: '#FF6B6B', warning: '#FFC94D', success: '#5BE38B', suggestion: '#7DBBFF', claude: '#F4A27E', inactive: '#D0D0D0' }
const LEAVE_SAVE_MS = 400 // the ring gone to nowhere is looked at again after this, as a closing field also leaves it there

// One field's typing dropped, unsaved.
function dropTyped(key: string) {
  typed.delete(key)
}

// Every field's typing dropped: a field closed, or the pane, saves nothing (owner 8 Nov 2026: only
// a field's ✓, its x or Enter decide).
function forgetTyping() {
  typed.clear()
}

// Whether an open field holds typed text. Any other action would close it and lose the text, so it is
// refused with a toast, and the field kept as it is (owner 8 Nov 2026: only its ✓, its x or Enter decide).
async function fieldHolds($: EngineInterface): Promise<boolean> {
  if (typed.size === 0) return false
  const now = await read($, tasksView)
  const holds = [...typed.entries()].some(([key, t]) => t.trim() !== '' && fieldOpen(now, key)) // an emptied field holds nothing
  if (holds) await $.ui.toast('Finish the open field first: ✓ or x')
  return holds
}

function view($: EngineInterface, fn: (v: TasksView) => TasksView) {
  return update($, tasksView, fn)
}

const stateOf = (r: TasksView['result']): TaskState | null => (r === null ? null : isError(r) ? r.state ?? null : r)
const pinId = (folder: string, title: string, nth: number) => `${folder}\u0000${title}\u0000${nth}`

// HOME, asked once: the pane's footer reads it at every drawing.
let home: string | undefined
async function homeOf($: EngineInterface) {
  if (home !== undefined) return home
  const answer = await $.env.get('HOME')
  if (answer) home = answer // an empty answer is asked again next time
  return answer ?? ''
}

// The skill inside this mod's own folder; a root or a check that cannot answer falls back to the folder Claude Code
// links the mod from, ~/.claude/skills/todo
async function py($: EngineInterface) {
  try {
    const root = $.plugin.root
    if (typeof root === 'string' && root !== '' && (await $.fs.exists(bundledTodoPy(root)))) return bundledTodoPy(root)
  } catch {
    // the root cannot answer: the linked folder below
  }
  return bundledTodoPy(`${await homeOf($)}/.claude/skills/todo`)
}

// todo.py finds the task file from its working folder: the session's root, which a shell `cd` does not move, so the
// list stays this project's all session. No root to ask: where the engine puts it.
async function runInit($: EngineInterface) {
  const cwd = await $.session.root().catch(() => undefined)
  return { timeoutMs: RUN_TIMEOUT_MS, ...(cwd ? { cwd } : {}) }
}

async function runTodo($: EngineInterface, argv: string[]): Promise<TaskState | TaskError> {
  try {
    const done = await $.process.run(argv, await runInit($))
    const r = parseResult(done.stdout, done.isStdoutTruncated)
    if (done.exitCode !== 0 && !isError(r)) return { kind: 'process', error: `Couldn't run /todo: exit ${done.exitCode}` }
    return r
  } catch (e) {
    return { kind: 'process', error: `Couldn't run /todo: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// Called before the view takes `r`, so a project is drawn in its colour from its first frame: the
// icon's pending count, then the project's colour. Never throws — a failed colour step is logged and
// the edit it follows still stands.
async function remember($: EngineInterface, r: TaskState | TaskError) {
  const state = isError(r) ? r.state : r
  if (!state) return
  try {
    const counts = { total: state.folders.reduce((n, f) => n + f.pending, 0) }
    await update($, tasksPending, () => counts)
    await syncBadge($, { pending: counts })
    await paint($, state.path)
  } catch {
    $.ui.log(`${LOG}colours failed`, { to: 'debug' })
  }
}

// The stored colours; null when the store cannot answer, so no write can replace what it holds.
async function storedColours($: EngineInterface): Promise<Record<string, number> | null> {
  try {
    const stored = await $.store.get('projectColours')
    return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored as Record<string, number> : {}
  } catch {
    $.ui.log(`${LOG}colours not read`, { to: 'debug' })
    return null
  }
}

// Gives the project (its task file's path) a colour the first time the pane reads it, kept in
// $.store across sessions and shared by them: the store is read here, so a colour another session
// took counts. The session's map says it is done; the store is written behind it, one write at a time.
async function paint($: EngineInterface, path: string) {
  if (Object.hasOwn(await read($, tasksColours), path)) return
  const stored = await storedColours($)
  const kept = stored?.[path]
  const hue = validHue(kept, HUES.length) ? kept : nextHue(Object.values(stored ?? {}), HUES.length, Math.random())
  const next = { ...stored, [path]: hue }
  await update($, tasksColours, () => next)
  if (stored === null) return
  painting = painting.then(() => $.store.set('projectColours', next)).catch(() => $.ui.log(`${LOG}colours not saved`, { to: 'debug' }))
}

// Fields that point at a row no longer there are dropped, so a stale field or rename never
// outlives its target; the rest (an open rename) survives a re-read.
function stillThere(v: TasksView, state: TaskState | null): Pick<TasksView, 'renaming' | 'selected' | 'pinned' | 'addAt'> {
  const keys = new Set(state?.folders.flatMap(f => f.items.map(i => i.key)) ?? [])
  const done = new Map(state?.folders.flatMap(f => f.items.map(i => [pinId(f.label, i.title, i.nth), i.done] as const)) ?? []) // a task's identity, and its state
  const ids = new Set(done.keys()) // the selection's identity
  return {
    renaming: v.renaming && keys.has(v.renaming.key) ? v.renaming : null,
    selected: v.selected && ids.has(v.selected) ? v.selected : null,
    // A held row stays held across a re-read until its 10 s are up — unless its task is gone or
    // changed state again (an undo, another writer), which lets it go to where it now belongs.
    pinned: v.pinned.filter(p => done.get(p.id) === p.done),
    addAt: v.addAt && ids.has(v.addAt.id) ? v.addAt : null, // its task gone: the field adds at the top
  }
}

// Reads the file into the view; skipped while an edit is queued, whose answer is newer, and
// dropped when another read or an edit started after it (I2).
async function reload($: EngineInterface): Promise<void> {
  if (queued > 0) return
  const mine = ++seq
  const started = Date.now()
  const r = await runTodo($, argvRead(await py($)))
  if (mine !== seq || queued > 0) return
  await remember($, r)
  if (mine !== seq || queued > 0) return // an edit started meanwhile: its answer is newer
  await view($, v => ({ ...v, ...stillThere(v, stateOf(r)), result: r, readAt: Date.now() }))
  $.ui.log(`${LOG}read ${Date.now() - started} ms`, { to: 'debug' }) // FR8: no title, ever
}

// A row's lock key: its folder and title, which stay put while other edits shift the lines (a
// line-index key would not); copies of one title share it, so they wait for each other.
const rowKey = (folder: string, title: string) => `row:${folder}\u0000${title}`

// A renamed task's identity: the task whose first line is where the old one's was (a key's
// `index:` part, which a rename keeps) — its copy number may differ under the new title.
function renamedTo(before: TaskState | null, after: TaskState, op: { folder: string; title: string; nth: number }): string | null {
  const index = keyOf(before, pinId(op.folder, op.title, op.nth))?.split(':')[0]
  const f = after.folders.find(one => one.label === op.folder)
  const item = index === undefined ? undefined : f?.items.find(i => i.key.split(':')[0] === index)
  return item ? pinId(op.folder, item.title, item.nth) : null
}

// The row key of the task with this identity.
const keyOf = (state: TaskState | null, id: string | null) =>
  state?.folders.flatMap(f => f.items.map(i => ({ id: pinId(f.label, i.title, i.nth), key: i.key }))).find(one => one.id === id)?.key

// Whether the ring is nowhere or still on the field that saved (`from`, or its ✓): a save may then
// select its task and put the ring on it — never away from a control or another field the person
// chose meanwhile.
const ringFree = (from: string | undefined) => from !== undefined && (ringAt === null || ringAt === from || ringAt === `ok:${from}`)

// The ring onto EDIT_KEY, for the selected task.
async function park($: EngineInterface, from: string | undefined) {
  if (!ringFree(from)) return
  const v = await read($, tasksView)
  const key = keyOf(stateOf(v.result), v.selected)
  if (key !== undefined) await $.ui.focus({ requestId: PANE, key: EDIT_KEY }).catch(() => undefined)
}

// One edit at a time, in the order pressed (A19). `key` names the row: from the press, a second
// edit of it is refused and the row is drawn dim, taking no press. Resolves true only when the edit
// ran and succeeded. `from`: the key of the task field that saved.
function edit($: EngineInterface, op: TaskOp, key: string, pin?: { folder: string; title: string; nth: number }, from?: string): Promise<boolean> {
  if (pending.has(key)) return Promise.resolve(false)
  pending.add(key)
  queued++
  seq++
  const started = Date.now()
  let ok = false
  let stale = false
  void view($, v => ({ ...v, inFlight: [...v.inFlight, key] })).catch(() => undefined)
  const run = queue.then(async () => {
    const r = await py($).then(p => runTodo($, argvEdit(p, op)), (e): TaskError => ({ kind: 'process', error: `Couldn't run /todo: ${e instanceof Error ? e.message : String(e)}` }))
    const failed = isError(r)
    await remember($, r)
    const pid = pin ? pinId(pin.folder, pin.title, pin.nth) : null
    let held = false // the edit holds its row (a tick or untick of a row not already held)
    await view($, v => {
      const inFlight = v.inFlight.filter(k => k !== key)
      if (!failed) {
        const state = r as TaskState
        const added = op.op === 'add' || op.op === 'insert' ? { addDraft: '', adds: v.adds + 1, adding: false, addAt: null } : {} // saved: the field closes; + opens a fresh one
        // A field saved with the ring still on it (Enter, ✓) selects its task — a new one too, as vi's o
        // leaves the cursor on the new line; one whose save finishes after a click elsewhere leaves the
        // selection as that click left it.
        // A new task is not selected (owner 30 Oct 2026): selecting it and moving the ring onto its
        // ✏ left the desktop pane blank.
        const made = !ringFree(from) || op.op !== 'rename' ? null : renamedTo(stateOf(v.result), state, op)
        const next = { ...v, ...(made ? { selected: made } : {}) }
        const kept = stillThere(next, state)
        // A tick or untick holds its row where it was; a second one on a held row lets it go
        // back, as it was before the first.
        const done = pid === null ? undefined : state.folders.flatMap(f => f.items.map(i => [pinId(f.label, i.title, i.nth), i.done] as const)).find(([id]) => id === pid)?.[1]
        held = pid !== null && done !== undefined && !v.pinned.some(p => p.id === pid)
        const pinned = [...kept.pinned.filter(p => p.id !== pid), ...(held ? [{ id: pid!, done: done! }] : [])]
        return { ...next, ...kept, result: r, editError: null, inFlight, pinned, readAt: Date.now(), ...added }
      }
      const e = r as TaskError
      const what = op.op === 'rename' || op.op === 'insert' ? `'${op.to}'` : 'title' in op ? `'${op.title}'` : ''
      const message = e.kind === 'write' ? `Couldn't save ${what}: ${e.error.replace(/^Couldn't save: /, '')}` : e.error
      const state = e.state ?? stateOf(v.result)
      return { ...v, ...stillThere(v, state), result: e.state ?? v.result, editError: message, inFlight,
        ...(op.op === 'add' && v.adding ? { addDraft: op.title } : op.op === 'insert' && v.adding ? { addDraft: op.to } : {}) }
    })
    ok = !failed
    // A ticked (or unticked) row is held, struck, where it was for 10 s, then goes to its section.
    if (!failed && pid !== null) {
      pinTimers.get(pid)?.cancel()
      pinTimers.delete(pid)
      if (held) pinTimers.set(pid, $.clock.after(PIN_MS, () => {
        pinTimers.delete(pid)
        void view($, x => ({ ...x, pinned: x.pinned.filter(p => p.id !== pid) })).catch(() => undefined)
      }))
    }
    // A saved rename leaves the ring on EDIT_KEY (so Enter edits it again, never adds), unless
    // the person has put the ring somewhere else meanwhile. Not awaited: the next edit waits on none.
    if (!failed && op.op === 'rename') void park($, from).catch(() => undefined)
    // The last change, for an undo: only a save that wrote hands a token. A failed edit, an undo
    // done or refused, and a no-change save all leave nothing to undo (a busy file: try again).
    if (!failed && op.op !== 'undo') lastChange = (r as TaskState).undo ? { at: Date.now(), token: (r as TaskState).undo! } : null
    else if (!(failed && (r as TaskError).kind === 'busy')) lastChange = null
    if (!failed && op.op === 'undo') $.ui.toast('Undone')
    stale = failed && !(r as TaskError).state // a timeout may still have written: read again once idle
    if (failed) $.ui.log(`${LOG}${op.op} failed: ${(r as TaskError).kind}`, { to: 'debug' })
    $.ui.log(`${LOG}${op.op} ${Date.now() - started} ms`, { to: 'debug' }) // FR8: press to drawn answer, no title
  })
  queue = run.catch(() => undefined).finally(() => {
    queued--
    pending.delete(key)
    if (stale && queued === 0) void reload($).catch(() => undefined)
  })
  return run.then(() => ok, () => false)
}

// The tasks a sent prompt held go done at once (owner 6 Nov 2026), as a tick does: held, struck, for
// 10 s. One after the other, as copies of a title share a lock. A task ticked, renamed or gone since
// it was loaded is left alone, and so is one not on the list as last read.
async function tickSent($: EngineInterface, sent: { id: string }[]) {
  for (const { id } of sent) {
    const folders = stateOf((await read($, tasksView)).result)?.folders ?? []
    const folder = folders.find(f => f.items.some(i => !i.done && pinId(f.label, i.title, i.nth) === id))
    const item = folder?.items.find(i => !i.done && pinId(folder.label, i.title, i.nth) === id)
    if (!folder || !item) continue
    const at = { folder: folder.label, nth: item.nth, title: item.title }
    await edit($, { op: 'tick', ...at }, rowKey(at.folder, at.title), at)
  }
}

function startCheck($: EngineInterface) {
  check?.cancel()
  check = $.clock.every(CHECK_MS, async () => {
    if (!(await read($, tasksOpen))) return stopCheck()
    if (!(await paneUp($))) return closed($) // dropped by the engine, its close hook never ran
    const state = stateOf((await read($, tasksView)).result)
    if (!state || state.mtimeMs === null) return reload($)
    const st = await $.fs.stat(state.path).catch(() => null)
    if (!st || Math.abs(st.mtimeMs - state.mtimeMs) >= MTIME_SLACK_MS || st.size !== state.size) await reload($)
  })
}

function stopCheck() {
  check?.cancel()
  check = undefined
}

// /todo, served by the mod so it answers at once: bare, the pane opens or closes, as the icon does;
// with words, todo.py runs them (the todo skill's commands: add, remove, completed, …, split on
// spaces as the skill's shell call splits them) and its output is the answer; an open pane reads
// the file again.
export async function todoCommand($: EngineInterface, args: string): Promise<{ text: string; exitCode?: number }> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    await togglePane($)
    return { text: (await read($, tasksOpen)) ? 'Tasks pane open' : 'Tasks pane closed' }
  }
  try {
    const done = await $.process.run(['python3', await py($), ...words], await runInit($))
    // a pane edit still queued would make the read give way: read after the queue instead
    if (await read($, tasksOpen)) void queue.then(() => reload($)).catch(() => undefined)
    const out = done.stdout.trimEnd()
    const err = done.exitCode !== 0 ? done.stderr.trimEnd() : '' // a crash after an echo line still shows
    const text = [out, err].filter(Boolean).join('\n') || (done.exitCode === 0 ? '/todo: done' : `/todo: exit ${done.exitCode}`)
    return { text, exitCode: done.exitCode }
  } catch (e) {
    return { text: `Couldn't run /todo: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// One toggle at a time, so two presses never open the pane twice.
export function togglePane($: EngineInterface): Promise<void> {
  toggling = toggling.catch(() => undefined).then(() => toggle($))
  return toggling
}

// `$.todo.toggle()` for another mod's icon (ctxbar's task icon and `/ctxbar tasks`): the pane opened or closed as
// `/todo` does it; answers the badge as the toggle wrote it, never read back in the same dispatch.
export async function toggleBadge($: EngineInterface): Promise<TodoBadge> {
  await togglePane($)
  await badging.catch(() => undefined)
  return written ?? NO_BADGE
}

// Whether the pane is still up. A pane whose drawing threw is dropped with no close hook run, so
// tasksOpen alone can say open for a pane that is gone. Can't tell → up, as tasksOpen says.
async function paneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes().then(panes => panes.some(p => p.id === PANE), () => true))
}

async function toggle($: EngineInterface): Promise<void> {
  if (await read($, tasksOpen)) {
    const wasUp = await paneUp($)
    if (wasUp) await $.ui.close({ id: PANE }).catch(() => undefined)
    await closed($)
    if (wasUp) return
  }
  // `focus`: the pane asks for the keyboard as it opens (granted while the prompt is empty), so
  // keys and typing reach it, not the prompt.
  const opened = await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true, focus: true })
  if (!opened.isPlaced) {
    $.ui.toast(`Tasks pane: ${opened.reason}`)
    await $.ui.close({ id: PANE }).catch(() => undefined) // not left open and undrawn
    return
  }
  await update($, tasksOpen, () => true)
  await syncBadge($, { open: true })
  forgetTyping()
  await update($, tasksFocus, () => null) // no row control from an earlier opening
  await view($, v => ({ ...v, ...CLEAN, editError: null, pinned: [] }))
  startCheck($)
  await reload($)
}

async function closed($: EngineInterface) {
  forgetTyping() // a field open as the pane closes is left unsaved
  searchIdle?.cancel()
  searchIdle = undefined
  ringAt = null
  loaded = [] // tasks loaded into the prompt and not sent are forgotten with the pane
  await update($, tasksTop, () => null) // a pane opened again starts where the engine's window stands
  armedD = null
  await update($, tasksOpen, () => false)
  await syncBadge($, { open: false })
  stopCheck()
}

// A session start, a reload of the mod included: the pane's open state from the engine, the
// work a cut-off edit left marked dropped, and the open pane's check started again (I4). The
// badge says the mod is here from now on.
export async function tasksSessionStart($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes().catch(() => [])
  const open = panes.some(p => p.id === PANE)
  await update($, tasksOpen, () => open)
  // the counts as kept before this start (a reload keeps the session's values); none written yet here
  await syncBadge($, { open, pending: await read($, tasksPending) })
  await view($, v => ({ ...v, ...CLEAN, inFlight: [], pinned: [] }))
  if (open) {
    startCheck($)
    await reload($)
  } else stopCheck()
}

// A main turn's end, called from register.tsx's own turn.complete hook (one unmatched hook per
// event per plugin): an open pane reads the file again (A15).
export async function tasksTurnEnd($: EngineInterface): Promise<void> {
  if (await read($, tasksOpen)) await reload($)
}

type Row = { folder: FolderView; item: Item }

// The rows of one section, newest first; a row pinned by a tick or untick stays where it was (A19).
function rowsOf(folders: FolderView[], pinned: TasksView['pinned'], section: 'pending' | 'done'): Row[] {
  const rows: Row[] = []
  for (const folder of folders) {
    for (const item of newestFirst(folder.items)) {
      const held = pinned.some(p => p.id === pinId(folder.label, item.title, item.nth))
      const at = held ? (item.done ? 'pending' : 'done') : item.done ? 'done' : 'pending'
      if (at === section) rows.push({ folder, item })
    }
  }
  return rows
}

export const registerTasks = (on: Parameters<Register>[0]): void => {
  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Esc (or the close mark) while a field is open leaves it and keeps the pane: unsaved text
    // goes, nothing is written. The next one closes.
    try {
      // Esc (or the close mark) within 10 s of a change undoes it and keeps the pane — only while the
      // pane holds the keyboard: Esc at an idle prompt closes the pane too, and must never undo.
      // An open search comes after a field, and before the undo (spec todo-search 4.5).
      const now = await read($, tasksView)
      const step = escapeStep(openEdit(now), now.search)
      if (e.origin.kind === 'person' && step === 'undo-or-close' && paneFocused && undo($)) return
      if (e.origin.kind === 'person' && step === 'edit') {
        forgetTyping()
        await view($, v => ({ ...v, ...CLOSE_ADD, renaming: null }))
        return
      }
      if (e.origin.kind === 'person' && step === 'search') {
        await view($, v => ({ ...v, search: null }))
        // The bar and its ✕ are gone: the ring goes to the icon back in their place, so the pane keeps the keys.
        await $.ui.focus({ requestId: PANE, key: SEARCH_RING }).catch(() => undefined)
        return
      }
    } catch {
      // a failed look closes the pane as asked
    }
    await closed($).catch(() => undefined) // whoever closed it: the icon, the close mark, Esc, an unload (A4)
    return next(e)
  })

  // The person sends a prompt (Enter, or their phone; not a slash command): the loaded tasks whose
  // title it holds are ticked. The send empties the box, so what was loaded is forgotten either way.
  // A send from the phone leaves the desktop's box as it was, so what is loaded there and not named
  // stays loaded. `loaded` is let go before the send goes out, so a task loaded again meanwhile is
  // kept; a dropped send puts it all back.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    const was = loaded
    const named = was.filter(l => e.text.includes(l.title))
    loaded = e.origin.kind === 'composer' ? [] : was.filter(l => !named.includes(l))
    const r = await next(e)
    if ((r as { drop?: string }).drop !== undefined) {
      loaded = [...was, ...loaded.filter(l => !was.some(w => w.id === l.id))]
      return r
    }
    // Not awaited: the send never waits on the file, and a tick that fails says so on the pane.
    void tickSent($, named).catch(() => $.ui.log(`${LOG}tick on send failed`, { to: 'debug' }))
    return r
  })

  // The person's wheel and keys move the list a task a tick from where it is drawn (j / k's place
  // included); a page key moves a few tasks, not a window's worth; Home and End, and a plugin's
  // scroll, as the engine takes them. The list's place is written too, so the pane is drawn there
  // even when the engine's window does not move (it already stands there).
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const range = e.contentRows - e.bodyRows
    if (!windowed || range <= 0) return next(e)
    if (Math.abs(e.by) >= e.contentRows) {
      landedTop = null
      await update($, tasksTop, () => null).catch(() => undefined)
      return next(e)
    }
    const by = Math.abs(e.by) >= e.bodyRows ? Math.sign(e.by) * PAGE_ENTRIES : e.by
    const offset = Math.max(0, Math.min(range, (landedTop ?? drawnTop) + by))
    landedTop = offset // before the write: a tick right behind it goes on from here
    const n = ++pins
    await update($, tasksTop, () => ({ top: offset, at: offset, n })).catch(() => undefined)
    return next({ ...e, offset })
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const to = e.element ?? null
    // The ring's row control, or none; a hotkey's hidden button taking the ring (j, k …) is
    // ignored, so the next key keeps its row.
    if (!to?.startsWith('k:')) {
      ringAt = to
      await update($, tasksFocus, () => (to !== null && ROW_KEY.test(to) ? to : null))
      // Only the person's own move lets the selection go: the pane's moves (a field opening, the
      // ring parked on the hidden edit button after a save) keep it.
      if (e.origin.kind === 'person') await unselect($, to)
    }
    // Focus leaving an open field saves nothing: the field stays open with what was typed until its
    // ✓, its x or Enter (owner 8 Nov 2026). Only a field no longer open (one a re-read closed) drops its typing.
    if (typed.size > 0) {
      const now = await read($, tasksView)
      for (const key of [...typed.keys()]) if (!fieldOpen(now, key)) dropTyped(key)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    try {
      return await drawPane($, e)
    } catch (err) {
      $.ui.log(`${LOG}draw failed`, { to: 'debug' })
      return (
        <Box>
          <Text mono color="red">Tasks pane error: {err instanceof Error ? err.name : 'drawing failed'}</Text>
        </Box>
      )
    }
  })
}

// A click away from the selected task (the +, another task, out of the pane)
// lets it go: the ring on its own controls or on a task field keeps it. Leaving to nothing is
// looked at again a moment later, as a closing field also leaves the ring nowhere, just before
// its save parks it on the task.
async function unselect($: EngineInterface, to: string | null) {
  const v = await read($, tasksView)
  if (v.selected === null || (to !== null && /^(ok:|no:)?(add|rn):/.test(to))) return
  const key = keyOf(stateOf(v.result), v.selected)
  if (to !== null && key !== undefined && ROW_KEY.test(to) && to.slice(2) === key) return
  const drop = () => view($, x => (x.selected === v.selected ? { ...x, selected: null } : x)).then(() => undefined)
  if (to !== null) return drop()
  $.clock.after(LEAVE_SAVE_MS, () => { if (ringAt === null && queued === 0) void drop().catch(() => undefined) })
}

// Whether the field with this key is still open (a closed one drops its typing).
const fieldOpen = (v: TasksView, key: string) =>
  key.startsWith('add:') ? v.adding
    : key.startsWith('rn:') ? v.renaming?.key === key.slice(3)
    : false

const openEdit = (v: TasksView) => v.adding || v.renaming !== null


async function drawPane($: EngineInterface, e: any) {
  windowed = false // until this drawing draws its own window ("reading…" and errors do not)
  paneFocused = e.props?.isFocused === true
  const ui = $.ui.resolve(e) as any
  const { Box, Text, Button } = ui
  // A thin dim grey line between tasks (owner 30 Oct 2026): an underlined run of blank cells on a
  // small row, cut at the pane's edge — text, which every surface draws (a 1px picture drew
  // nothing in the desktop pane). Held in a box as wide as the row and clipped: bare, the run's own
  // width widened the list's column, and the desktop squeezed every title and the title bar to
  // nothing (the pane went blank at a list's second task).
  // Off on a graphical surface (owner 30 Oct 2026): with the line drawn, selecting a task blanked
  // the desktop pane. The terminal keeps it.
  const ruled = (rows: unknown[], key: string) => !terminal ? rows : rows.flatMap((row, i) => i === 0 ? [row] : [
    <Box key={`rule:${key}:${i}`} width="100%" minWidth={0} overflow="hidden">
      <Text mono size="caption" color={RULE_INK} underline wrap="truncate">{BLANK.repeat(RULE_CELLS)}</Text>
    </Box>,
    row,
  ])
  const Input = ui.Input as any
  const mobile = e.surface === 'mobile' || !Input
  const terminal = e.surface === 'terminal'
  // A docked pane's room: the path sits on its last row. An inline frame fits its tree, so no fill.
  const rows: number = e.props?.placement === 'dock' ? e.props?.scroll?.bodyRows ?? 0 : 0
  // A docked pane on a graphical surface draws its own window (PAGE_ENTRIES above); the terminal
  // and an inline pane scroll as one.
  const own = rows > 0 && !terminal
  windowed = own
  const v = await read($, tasksView)
  const r = v.result
  if (r === null) return <Text mono dimColor>reading…</Text>
  const state = stateOf(r)
  if (!state || (isError(r) && r.kind === 'read')) return <Text mono color="red">{(r as TaskError).error}</Text>

  const busy = (k: string) => v.inFlight.includes(k)
  const lockOf = (row: Row) => rowKey(row.folder.label, row.item.title)
  // One list (owner 6 Nov 2026): a file with `##` headings shows all their tasks, and an add goes to the first heading,
  // as todo.py refuses the top of a file that has them.
  const addTarget = state.folders.find(f => f.label !== TOP)?.label ?? TOP

  // Every press and key is refused while an open field holds typed text (`fieldHolds`); only a field's own ✓ and x
  // (`ownPress`) act then.
  const ownPress = (fn: () => unknown) => () => void Promise.resolve(fn()).catch(() => undefined)
  const press = (fn: () => unknown) => ownPress(async () => (await fieldHolds($)) ? undefined : fn())
  // A row's own buttons: shown on the pointer's hover over the (keyed, visible) row; a terminal,
  // which has no hover, draws them always (A12).
  const onHover = (...buttons: unknown[]) => <Box flexDirection="row">{buttons}</Box>
  // An icon with a colour of its own (ICON_INK) is coloured Text with a blank press laid over it, as
  // a desktop Button draws its label, and any Text in it, in its own
  // colour. The + has none and stays a dim Button. `lit`: a task row's icon, shown only while its row is
  // hovered, so drawn bright from the start (owner 8 Nov 2026).
  const icon = (key: string, glyph: string, onPress: () => void, lit = false) => {
    const ink = ICON_INK[glyph]
    if (!ink) return <Button key={key} plain dimColor label={glyph} onPress={onPress} />
    // The app's face a step up, as a Button's label drew it (owner 30 Oct 2026: the old size), bold;
    // under the pointer, its bright version (the nearest keyed Box is the icon's own).
    const size = glyph === LEAVE ? 'footnote' : 'heading'
    // A terminal paints a press's label as cells over whatever lies under it, so there the words are the press's own
    // children (Text it draws in place, in its colour). No pointer there.
    if (terminal) return <Button key={key} plain onPress={onPress}><Text size={size} bold color={ink}>{glyph}</Text></Button>
    const words = <Text size={size} bold color={lit ? ICON_BRIGHT[ink] : ink} hover={{ color: ICON_BRIGHT[ink] }}>{glyph}</Text>
    return (
      <Box key={`${key}:at`} position="relative" paddingX="xs" paddingY="xs">
        {words}
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          <Button key={key} plain label={BLANK.repeat(2)} onPress={onPress} />
        </Box>
      </Box>
    )
  }
  // A task's tick circle, first in its row, the smallest step from the stripe's edge (owner 2 Nov 2026: nearer the
  // edge, img 99) and a cell from the title, in a box that never shrinks, so a long title cannot squeeze it. On a graphical surface it is in its title's colour (owner 2 Nov 2026:
  // the app's white was faint on gold, img 31) — coloured Text with a blank press laid over it, as the row icons are
  // (the press anchored on all four sides and short, so it is never cut to an ellipsis, img 20). A terminal and a phone
  // keep the plain Button.
  const tickMark = (k: string, glyph: string, ink: string | undefined, dim: boolean, onPress: () => void) => terminal || mobile ? (
    <Box key={`tk:${k}`} flexShrink={0}>
      <Button key={`t:${k}`} plain label={glyph} dimColor={dim} onPress={onPress} />
    </Box>
  ) : (
    <Box key={`tk:${k}`} position="relative" flexShrink={0} alignSelf="center" paddingLeft="xs" paddingRight={1}>
      <Text mono bold dimColor={dim} {...(ink ? { color: ink } : {})}>{glyph}</Text>
      <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
        <Button key={`t:${k}`} plain label={BLANK.repeat(2)} onPress={onPress} />
      </Box>
    </Box>
  )
  const colours = await read($, tasksColours)
  const colour = HUES[colours[state.path] ?? -1] ?? NO_COLOUR // the project's, one for the title bar and the stripes
  const spacer = (key: string) => <Box key={key} flexGrow={1} />
  // Every field the same way: as wide as its row (a column that grows stretches its one child), the
  // cursor in it; Enter or the ✓ at its right saves what is typed — nothing else does (owner 8 Nov 2026).
  // `cancel`: an `x` after the ✓, shown from the start (owner 31 Oct 2026: a way out before a key is
  // typed; Esc may never reach the pane), that closes the field unsaved. The ✓ shows whenever the field
  // holds text (owner 4 Nov 2026), so an edit opened and left as it was closes with it too.
  // Two rows tall or more, so Shift+Enter types a new line in it. It shows its next line 10 cells
  // before the current one ends (owner 6 Nov 2026; never a scroll inside it, owner 4 Nov 2026),
  // reckoned in mono cells less its icons' room — high on purpose, the app's font is narrower.
  // Its height also places the list's window (`growRows`), so the lines being typed stay in view.
  const fieldColumns = Math.max(10, (e.props?.bodyColumns ?? 80) - 10)
  const growRows = (text: string) => fieldRows(text, fieldColumns)
  const field = (key: string, shown: { value?: string; placeholder?: string }, save: Save, cancel: () => unknown) => {
    const shapeOf = (t: string) => ({ rows: growRows(t), filled: t.trim() !== '' })
    const signature = (s: { rows: number; filled: boolean }) => `${key}:${s.rows}:${s.filled}`
    const drawn = shapeOf(typed.get(key) ?? shown.value ?? '')
    shapes.set(key, signature(drawn))
    // What was typed stays in `typed` until the field really closes (the focus sweep drops a closed field's,
    // a reopened rename starts clean): a refused title or a failed save keeps it in the field, guard and all.
    const commit = (t: string) => {
      // The field closed: a rename's save parks the ring on EDIT_KEY (`park`), a new task's once its
      // save is done (a failed one keeps the field open and the ring in it). Refused (a bad title), the
      // field stays open and keeps the focus to be fixed.
      save(t)
    }
    return (
      <Box key={`${key}:row`} flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          {/* A redraw while typing (the ✓ showing) draws what was typed, never the old text back. */}
          <Input key={key} autoFocus {...shown} rows={drawn.rows} value={typed.get(key) ?? shown.value}
            onInput={(t: string) => {
              typed.set(key, t)
              // Typing that changes the field's height, or whether it holds text, redraws it: its rows, its ✓.
              const shape = signature(shapeOf(t))
              if (shapes.get(key) !== shape) {
                shapes.set(key, shape)
                void view($, x => ({ ...x, shape })).catch(() => undefined)
              }
            }}
            onSubmit={(t: string) => commit(t)} />
        </Box>
        {drawn.filled && icon(`ok:${key}`, '✓', ownPress(() => commit(typed.get(key) ?? shown.value ?? '')))}
        {icon(`no:${key}`, LEAVE, ownPress(() => (dropTyped(key), cancel())))}
      </Box>
    )
  }
  const allRows = () => [...rowsOf(state.folders, v.pinned, 'pending'), ...rowsOf(state.folders, v.pinned, 'done')]
  // A key acts on the row the focus ring holds, read when pressed; never inside a field or on a
  // row with an edit running (A12, A19).
  // t r i a dd o b act on the selected task (j / k), else on the row whose control holds the focus ring.
  const idOf = (row: Row) => pinId(row.folder.label, row.item.title, row.item.nth)
  // ◀ or l: the task into the prompt box (owner 31 Oct 2026) — the draft when the box is empty, else on
  // a line after what is typed there. Once the person sends a prompt holding it, it is ticked.
  const load = async (row: Row) => {
    const { title } = row.item
    try {
      const box = await $.prompt.read()
      const typed = box.text.trimEnd()
      // Already the draft's last line(s) (Enter on the ◀ or l the ring still holds, or put there
      // before the mod reloaded): nothing to add, and it still counts as loaded.
      if (typed.split('\n').slice(-title.split('\n').length).map(line => line.trim()).join('\n') !== title) {
        const done = await $.prompt.fill(box.text.trim() === '' ? { text: title }
          : { text: `${box.text.endsWith('\n') ? '' : '\n'}${title}`, mode: 'append' })
        if (!done.isFilled) throw new Error('not filled')
      }
    } catch {
      return view($, x => ({ ...x, editError: "Couldn't put the task into the prompt box" }))
    }
    const id = idOf(row)
    if (!loaded.some(l => l.id === id)) loaded = [...loaded, { id, title }]
  }
  const send = (row: Row) => press(() => load(row))
  const keyPress = (fn: (row: Row) => unknown, isD = false) => press(async () => {
    if (!isD) armedD = null // dd is two d in a row: any other key between them breaks the pair
    const id = (await read($, tasksView)).selected
    const k = (await read($, tasksFocus))?.replace(ROW_KEY, '')
    // The selected task only while it is drawn: one a search or a collapsed Completed hides takes no key.
    const row = id !== null ? shownRows.find(one => idOf(one) === id) : allRows().find(one => one.item.key === k)
    return row && !busy(lockOf(row)) ? fn(row) : undefined
  })
  const tick = (row: Row) => edit($, { op: row.item.done ? 'untick' : 'tick', folder: row.folder.label, nth: row.item.nth, title: row.item.title },
    lockOf(row), { folder: row.folder.label, title: row.item.title, nth: row.item.nth })
  // A field just opened takes the focus ring, so what is typed reaches it and not the prompt (the
  // engine awaits its drawing; refused only while the pane does not hold the keys).
  const into = (key: string) => $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
  // A field in the list is kept in view by the drawing (the window starts at it if need be); one at
  // the top sits under the title row, always in view.
  const startRename = (row: Row) => {
    dropTyped(`rn:${row.item.key}`) // a reopened rename starts clean
    return view($, x => ({ ...x, renaming: { key: row.item.key, draft: row.item.title }, shape: null })).then(() => into(`rn:${row.item.key}`))
  }
  const openAdd = () => view($, x => ({ ...x, adding: true, addAt: null, shape: null })).then(now => into(`add:${now.adds}`))
  // vi's o and O (b here: a hotkey can't tell Shift+o from o): a new task under or over the
  // selected one; on a completed task, at the top as + does.
  const openAt = (where: 'below' | 'above') => keyPress(row => row.item.done ? openAdd()
    : (forgetTyping(), view($, x => ({ ...x, adding: true, addAt: { id: idOf(row), where }, renaming: null, shape: null, addDraft: '' })).then(now => into(`add:${now.adds}`))))
  // vi's dd: a second d on the same task within a second deletes it.
  const dd = keyPress(async row => {
    const id = idOf(row)
    const now = await $.clock.now()
    const again = armedD?.id === id && now - armedD.at <= DD_MS
    armedD = again ? null : { id, at: now }
    return again ? edit($, { op: 'delete', folder: row.folder.label, nth: row.item.nth, title: row.item.title }, lockOf(row)) : undefined
  }, true)

  const count = (key: string, n: number) => <Text key={key} mono dimColor tabular>{` ${n}`}</Text>

  // `shaded`: every second row of its list, on the project's colour; the others on the navy (not in a
  // terminal, whose ground may be light).
  const rowView = (row: Row, place = -1, shaded = false) => {
    const k = row.item.key
    const struck = row.item.done
    const dim = busy(lockOf(row))
    if (v.renaming?.key === k && !mobile) {
      return (
        <Box key={`row:${k}`} flexDirection="row">
          {field(`rn:${k}`, { value: row.item.title }, t => {
            const bad = checkTitle(t)
            if (bad) { void view($, x => ({ ...x, editError: bad })).catch(() => undefined); return }
            // Left as it was (its ✓ pressed, owner 4 Nov 2026): closed, nothing written. Spaces trimmed and blank lines
            // dropped, as checkTitle and todo.py do — no other white space.
            const same = t.split('\n').map(line => line.replace(/^ +| +$/g, '')).filter(Boolean).join('\n') === row.item.title
            void view($, x => ({ ...x, renaming: null, shape: null })).then(async () => {
              if (same) await into(EDIT_KEY)
              else await edit($, { op: 'rename', folder: row.folder.label, nth: row.item.nth, title: row.item.title, to: t }, lockOf(row), undefined, `rn:${k}`)
            }).catch(() => undefined)
          }, () => view($, x => ({ ...x, renaming: null, shape: null })).then(() => into(EDIT_KEY)))}{/* x: closed unsaved, the ring back on the task */}
        </Box>
      )
    }
    const at = { folder: row.folder.label, nth: row.item.nth, title: row.item.title }
    // A pending task moves one place up or down its folder's list (newest first, so ↑ is later in
    // the file: todo.py's `down`). A hidden arrow leaves a blank of its width, so the icons stay put.
    // The title is JBM text that wraps and shows its line breaks; a desktop draws any press in the
    // app's own font, on one line, so the title is not one — `✏` (or Enter on the selected task,
    // or `r`) opens it for editing.
    // Shown only while the pane holds the keyboard: a click out of it lets the task go.
    const chosen = e.props?.isFocused !== false && v.selected === pinId(row.folder.label, row.item.title, row.item.nth)
    // Its stripe, the title in the other stripe's colour; a done one keeps them, struck (owner 1 Nov 2026).
    // The second stripe is the project's colour, as the title bar.
    // The selected task sits on a ground of its own (owner 4 Nov 2026: swapped stripes matched the row beside it);
    // a terminal, with no stripes, keeps the grey.
    const striped = !terminal
    const onStripe = shaded && !chosen // on the project's colour, the title in navy
    const ground = striped ? (chosen ? SELECTED_STRIPE : onStripe ? colour : NAVY) : chosen ? SELECTED_ROW : undefined
    const ink = striped ? (onStripe ? NAVY : colour) : undefined
    // One step under body (owner 30 Oct 2026: a touch smaller); a long one cut after TITLE_LINES lines.
    const title = (
      <Text mono size="footnote" bold dimColor={dim || (struck && !striped)} strikethrough={struck} {...(ink ? { color: ink } : {})}>
        {shownTitle(row.item.title, wrapAt, TITLE_LINES)}
      </Text>
    )
    const gap = (key: string) => <Text key={key} mono>{' '}</Text>
    // No ↑ ↓ while a search is on: a place among the matches is no place in the folder.
    const order = struck || searching ? [] : [
      place > 0 ? icon(`u:${k}`, '↑', press(() => edit($, { op: 'down', ...at }, lockOf(row))), true) : gap(`u0:${k}`),
      place >= 0 && place < lastPlace ? icon(`d:${k}`, '↓', press(() => edit($, { op: 'up', ...at }, lockOf(row))), true) : gap(`d0:${k}`),
    ]
    // A completed task has no ◀ or ✏ (owner 30 Oct 2026): a ↩ that puts it back among the tasks, and its ✕.
    const icons = [
      ...order,
      ...(struck ? [] : [icon(`s:${k}`, SEND, send(row), true)]),
      struck ? icon(`p:${k}`, '↩', press(() => tick(row)), true) : icon(`e:${k}`, EDIT, press(() => startRename(row)), true),
      icon(`x:${k}`, '✕', press(() => edit($, { op: 'delete', ...at }, lockOf(row))), true),
    ]
    // On a graphical surface the icons float over the row's right end while it is hovered (the
    // selected row too: shown always they would hide its title's end), on its own ground, so
    // showing them never rewraps the title (owner 30 Oct 2026); a terminal keeps them in line.
    // Centred on the row, with no ground of their own: the title shows through around them
    // (owner 30 Oct 2026: a ground behind them looked blotchy, then too dark).
    const floating = () => (
      <Box position="absolute" top={0} bottom={0} right={0} flexDirection="row" alignItems="center" display="none" hover={{ display: 'flex' }}>
        <Box flexDirection="row" alignItems="center" columnGap="xs">{icons}</Box>
      </Box>
    )
    return (
      <Box key={`row:${k}`} flexDirection="row" {...(terminal ? {} : { position: 'relative' })} {...(ground ? { backgroundColor: ground } : {})}>
        {tickMark(k, struck ? '●' : '○', ink, dim, dim ? () => undefined : press(() => tick(row)))}
        <Box key={`tt:${k}`} flexShrink={1} minWidth={0}>{title}</Box>
        {spacer(`rs:${k}`)}
        {!mobile && !dim && (!terminal ? floating() : chosen ? <Box flexDirection="row">{icons}</Box> : onHover(...icons))}
      </Box>
    )
  }

  // Search (spec todo-search.md FR2): the tasks holding every word; Completed's matches open.
  const searchOpen = !mobile && v.search != null
  const searching = searchOpen && queryWords(v.search!).length > 0
  // A task whose rename is open stays drawn, its field's ✓ and x with it (owner 8 Nov 2026: only they close it).
  const keep = (row: Row) => !searching || matches(row.item.title, v.search!) || v.renaming?.key === row.item.key
  const showDone = v.showCompleted || searching
  const pendingRows = rowsOf(state.folders, v.pinned, 'pending').filter(keep)
  const doneRows = rowsOf(state.folders, v.pinned, 'done').filter(keep)
  // Places count the tasks still pending: a row a tick holds in place takes none.
  const ordered = pendingRows.filter(row => !row.item.done)
  const lastPlace = ordered.length - 1
  // o / b: the add field under or over its task (the list is newest first, so under is earlier in
  // the file: `before`); a save inserts the task there.
  const addKey = `add:${v.adds}`
  const addField = () => field(addKey, { placeholder: 'Add a task', value: v.addDraft }, t => {
    const bad = checkTitle(t)
    if (bad) { void view($, x => ({ ...x, editError: bad, addDraft: t })).catch(() => undefined); return }
    const at = v.addAt && allRows().find(row => idOf(row) === v.addAt!.id)
    void (at
      ? edit($, { op: 'insert', folder: at.folder.label, nth: at.item.nth, title: at.item.title, to: t, where: v.addAt!.where === 'below' ? 'before' : 'after' }, `add:${t}`, undefined, addKey)
      : edit($, { op: 'add', folder: addTarget, title: t }, `add:${t}`, undefined, addKey))
      // Saved: the ring leaves the closed field for EDIT_KEY, so Enter edits the selected task and the pane
      // keeps the keys (never onto the +, where Enter would open a new task); failed, it stays in the open one.
      .then(async ok => { if (ok && !mobile) await into(EDIT_KEY) })
      .catch(() => undefined)
  }, () => view($, x => ({ ...x, ...CLOSE_ADD })).then(now => { // x: closed unsaved, the ring back on the selected task
    const key = keyOf(stateOf(now.result), now.selected)
    return key === undefined ? undefined : into(EDIT_KEY)
  }))
  const near = (row: Row, where: 'below' | 'above') => !mobile && v.adding && v.addAt?.id === idOf(row) && v.addAt.where === where
    ? [<Box key={`addb:${row.item.key}`} flexDirection="row">{addField()}</Box>] : []
  const shownPending = pendingRows.slice(0, v.shown)
  // The list as entries, each with the rows it is reckoned to take, high on purpose (LINE_ROWS):
  // only j / k and an open field use it, to decide where the window starts. `field`: it holds an
  // open field, which the window keeps in view.
  type Entry = { el: unknown; rows: number; id?: string; field?: true }
  const wrapAt = Math.max(10, (e.props?.bodyColumns ?? 80) - 6)
  const tall = (title: string, least = 1) =>
    LINE_ROWS * Math.max(least, title.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / wrapAt)), 0))
  // An open field as tall as it is drawn (growRows, from what is typed); a task as its title is shown, at most TITLE_LINES.
  const addRows = () => LINE_ROWS * growRows(typed.get(addKey) ?? v.addDraft)
  const fieldAt = (row: Row, where: 'below' | 'above'): Entry[] => near(row, where).map(el => ({ el, rows: addRows(), field: true as const }))
  const rowEntry = (row: Row, el: unknown): Entry => !mobile && v.renaming?.key === row.item.key
    ? { el, rows: LINE_ROWS * growRows(typed.get(`rn:${row.item.key}`) ?? row.item.title), id: idOf(row), field: true }
    : { el, rows: tall(shownTitle(row.item.title, wrapAt, TITLE_LINES)), id: idOf(row) }
  const pendingEntries: Entry[] = shownPending.flatMap((row, i) => [
    ...fieldAt(row, 'above'), rowEntry(row, rowView(row, ordered.indexOf(row), i % 2 === 1)), ...fieldAt(row, 'below'),
  ])
  const listed = pendingEntries.map(x => x.el)
  // An o / b field whose task is not in the pending list as drawn (held in Completed, or past
  // "show more") sits at the top instead, still saving next to its task.
  const addOnTop = v.adding && !shownPending.some(row => idOf(row) === v.addAt?.id)

  const shownPath = tildePath(state.path, await homeOf($))
  const readAt = new Date(v.readAt)
  const hh = readAt.getHours() % 12 || 12
  const time = `${hh}.${String(readAt.getMinutes()).padStart(2, '0')}${readAt.getHours() < 12 ? 'a' : 'p'}`

  const headerCount = state.folders.reduce((n, f) => n + f.pending, 0)
  const canAdd = !mobile
  // j / k (Gmail's next / previous): the selection moves to the next or previous task shown (kept
  // in the view, so a hotkey's own button taking the ring never loses it), the task is
  // highlighted, and the ring rests on EDIT_KEY, so Enter edits it.
  const shownRows = [...pendingRows.slice(0, v.shown), ...(showDone ? doneRows.slice(0, v.shownDone) : [])]

  const moreButton = <Button key="more" plain dimColor label={`show ${PAGE} more`} onPress={press(() => view($, x => ({ ...x, shown: x.shown + PAGE })))} />
  const completedButton = (
    <Button key="completed" plain label={`${v.showCompleted ? '▼' : '▶'} Completed (${doneRows.length})`}
      onPress={press(() => view($, x => ({ ...x, showCompleted: !x.showCompleted, renaming: null, ...(x.showCompleted ? { selected: null } : {}) })))} />
  )
  const moreDoneButton = <Button key="more-done" plain dimColor label={`show ${PAGE} more`} onPress={press(() => view($, x => ({ ...x, shownDone: x.shownDone + PAGE })))} />
  const doneEntries: Entry[] = showDone ? doneRows.slice(0, v.shownDone).map((row, i) => rowEntry(row, rowView(row, -1, i % 2 === 1))) : []
  const segments = {
    pending: pendingEntries,
    more: pendingRows.length > v.shown ? [{ el: moreButton, rows: 1 }] : [],
    completed: doneRows.length > 0 && !searching ? [{ el: completedButton, rows: 1 }] : [], // searching: the matches show open
    done: doneEntries,
    moreDone: showDone && doneRows.length > v.shownDone ? [{ el: moreDoneButton, rows: 1 }] : [],
  }
  const entries: Entry[] = [...segments.pending, ...segments.more, ...segments.completed, ...segments.done, ...segments.moreDone]
  // The engine's window: a row of scroll per entry past the first, so the wheel reaches every one.
  const maxTop = Math.max(0, entries.length - 1)
  const at0 = own ? Math.max(0, Math.min(e.props?.scroll?.offset ?? 0, maxTop)) : 0
  const pin = own ? await read($, tasksTop) : null
  // the pane's own place, while it holds
  const pinned = pin !== null && pin.at === at0 && pin.n !== droppedPin ? Math.min(pin.top, maxTop) : null
  // A place the engine's window has moved off (the scroll bar dragged) is let go for good, so dragging
  // back never brings it back (a drawing may not write, so it is remembered here, by its number); one a
  // wheel tick just wrote lands when the window arrives, and draws the same.
  if (pin !== null && pinned === null) droppedPin = pin.n
  if (own && at0 !== lastAt) landedTop = null // the engine's window moved: it arrived, or was dragged
  if (own) lastAt = at0
  const base = own ? pinned ?? at0 : 0
  // The rows the list has under what stays put (the title row, a top field, an error, the path),
  // reckoned low as the entries are reckoned high.
  // What sits between the title row and the list.
  const above = (state.state === 'nofile' ? 1 : 0) + (addOnTop ? addRows() : 0) + (v.editError !== null ? 1 : 0)
  const room = rows - 3 - above
  // The window's first entry that keeps entry `at` whole in view, moving from `from` as little as
  // it can.
  const topFor = (from: number, at: number) => {
    if (at < from) return at
    let first = from
    while (first < at && entries.slice(first, at + 1).reduce((n, x) => n + x.rows, 0) > room) first++
    return first
  }
  // Where the list starts: where j / k left it, else where the engine's window stands, moved so an
  // open field (a new task's, an edit's) is never out of sight while it is typed in.
  const opened = entries.findIndex(x => x.field)
  const top = !own ? 0 : opened >= 0 ? topFor(base, opened) : base
  if (own) drawnTop = top
  // Each segment's entries from the window's first on.
  let seen = 0
  const fromTop = (list: Entry[]) => {
    const first = seen
    seen += list.length
    return list.filter((_, i) => first + i >= top).map(x => x.el)
  }
  const shown = {
    pending: fromTop(segments.pending), more: fromTop(segments.more), completed: fromTop(segments.completed),
    done: fromTop(segments.done), moreDone: fromTop(segments.moreDone),
  }

  const step = (by: number) => press(async () => {
    armedD = null
    if (shownRows.length === 0) return
    const id = (await read($, tasksView)).selected
    const at = shownRows.findIndex(row => idOf(row) === id)
    const to = shownRows[at === -1 ? (by > 0 ? 0 : shownRows.length - 1) : Math.min(shownRows.length - 1, Math.max(0, at + by))]!
    // The list moves just enough to show the task whole, from where it stands (a second press may
    // come before the redraw), set before the selection so the redraw draws both.
    const index = entries.findIndex(x => x.id === idOf(to))
    if (own && index >= 0) {
      const now = await read($, tasksTop)
      const from = now !== null && now.at === at0 ? Math.min(now.top, maxTop) : top
      const want = topFor(from, index)
      if (want !== from) {
        landedTop = null // j / k's place is where the next tick goes on from
        const n = ++pins
        await update($, tasksTop, () => ({ top: want, at: at0, n })).catch(() => undefined) // the selection moves all the same
      }
    }
    await view($, x => ({ ...x, selected: idOf(to) }))
    await $.ui.focus({ requestId: PANE, key: EDIT_KEY }).catch(() => undefined)
  })

  // The search bar opens on the title row with the cursor in it; the selection goes, so no key acts on a task the
  // search hides. Open already: the cursor goes back into it.
  // An open rename with nothing typed closes (one holding text refuses the lens): its row may not match.
  // A bar holding no words closes itself after 10 s, back to the normal look (owner 2 Nov 2026): timed from its opening,
  // and again from each time it is emptied; words stop it.
  const idleSearch = () => {
    searchIdle?.cancel()
    const timer = $.clock.after(SEARCH_IDLE_MS, () => void (async () => {
      if (searchIdle !== timer) return
      searchIdle = undefined
      let shut = false
      await view($, x => (x.search != null && queryWords(x.search).length === 0 ? (shut = true, { ...x, search: null }) : x))
      // The ring comes back to the lens only from the bar itself: a field the person moved on to keeps it, and what
      // is typed there.
      if (shut && ringAt === 'search:in') await into(SEARCH_RING)
    })().catch(() => undefined))
    searchIdle = timer
  }
  const stopIdleSearch = () => {
    searchIdle?.cancel()
    searchIdle = undefined
  }
  const openSearch = press(() => view($, x => ({ ...x, search: x.search ?? '', selected: null, renaming: null }))
    .then(() => (idleSearch(), into('search:in'))))
  // A new query: the list starts at its top, so no match sits above the window; an input
  // landing after the bar closed opens nothing.
  const narrow = (t: string) => (queryWords(t).length === 0 ? idleSearch() : stopIdleSearch(), view($, x => (x.search == null ? x : { ...x, search: t, selected: null })))
    .then(() => update($, tasksTop, () => null))
    .then(() => $.ui.scroll({ to: 'start', in: PANE, block: 'start' }))
    .catch(() => undefined)

  const body = (
    <Box key="window" flexDirection="column" {...(own ? { height: rows } : { minHeight: rows > 0 ? rows : undefined })}>
      <Box flexDirection="row" flexGrow={1} minHeight={0}>
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          {/* The title row: `Tasks`, the free gap, the ⌕, the count, the +. The search opens at the gap's start — the
              title, the count and the + stay — the rest of the gap free, its ✕ in the ⌕'s place (owner 2 Nov 2026): a
              one-row Input draws at the desktop's own width whatever its box or label (img 29, 33), and only the
              two-row form, 74 px tall, filled it (img 30). */}
          <Box key="head" flexDirection="row">
            {/* Bold black on the project's colour, the colour behind the letters only (owner 2 Nov 2026). */}
            <Text key="title" mono bold color={SELECTED_INK} backgroundColor={colour}>{TITLE}</Text>
            {searchOpen && (
              // No `value` while open: a redraw must never put back an older text over what was typed since. A terminal
              // draws a field across its box, so there the bar keeps all of the gap.
              <Box key="search:row" flexDirection="row" minWidth={0} {...(terminal ? { flexGrow: 1 } : {})}>
                <Text mono> </Text>
                <Box key="search:col" flexDirection="column" {...(terminal ? { flexGrow: 1 } : {})}>
                  <Input key="search:in" autoFocus placeholder="search tasks"
                    onInput={(t: string) => void narrow(t)}
                    onSubmit={(t: string) => void (async () => {
                      // Enter's own text decides, not the last drawing's: the first match, else the cursor stays.
                      const first = allRows().find(row => matches(row.item.title, t))
                      await view($, x => ({ ...x, search: t, selected: first ? idOf(first) : null }))
                      await into(first ? EDIT_KEY : 'search:in')
                    })().catch(() => undefined)} />
                </Box>
              </Box>
            )}
            {!(terminal && searchOpen) && spacer('h:sp')}
            {/* The ✕ takes the lens's place while the bar is open (owner 2 Nov 2026). */}
            {searchOpen
              ? icon('search:x', '✕', press(() => view($, x => ({ ...x, search: null })).then(() => into(SEARCH_RING))))
              : canAdd && icon('search', SEARCH, openSearch)}
            {count('h:n', searchOpen ? ordered.length : headerCount)}
            {canAdd && <Text mono> </Text>}
            {canAdd && icon('new-task', '+', press(() => {
              forgetTyping()
              return v.adding ? view($, x => ({ ...x, ...CLOSE_ADD })) : openAdd()
            }))}
          </Box>
          {state.state === 'nofile' && <Text mono dimColor>No task file yet — created on first add: {shownPath}</Text>}
          {canAdd && addOnTop && <Box key="addb" flexDirection="row">{addField()}</Box>}
          {v.editError !== null && <Text mono color="red">{v.editError}</Text>}
          {/* The list, from the window's first entry, clipped under what stays put. No gap between
              tasks on a graphical surface (owner 30 Oct 2026): the stripes part them. */}
          <Box key="scroll" flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow={own ? 'hidden' : 'visible'}>
            <Box key="pending" flexDirection="column" rowGap={terminal ? 'xs' : 0}>{terminal ? ruled(listed, 'p') : shown.pending}</Box>
            {shown.more}
            {shown.completed}
            {showDone && <Box key="done" flexDirection="column" rowGap={terminal ? 'xs' : 0}>{terminal ? ruled(segments.done.map(x => x.el), 'd') : shown.done}</Box>}
            {shown.moreDone}
          </Box>
        </Box>
      </Box>
      {!mobile && (
        // Gmail-style keys: buttons kept for their hotkeys, never drawn. c opens the add field (only
        // opens, as Gmail's compose); j / k step through the tasks; t r i a dd o b act on the selected task; s opens the
        // search.
        // A pressed hotkey takes the ring onto its button: hidden by `display: none` the button could
        // not hold it and the keyboard went back to the prompt, so on a graphical surface they are
        // drawn in a box of no height instead (owner 30 Oct 2026: the pane keeps the keys).
        <Box key="keys" flexDirection="row" {...(terminal ? { display: 'none' } : { height: 0, overflow: 'hidden' })}>
          {canAdd && <Button key="k:c" plain hotkey="c" label="new task" onPress={press(() => ((armedD = null), openAdd()))} />}
          <Button key="k:t" plain hotkey="t" label="tick" onPress={keyPress(row => tick(row))} />
          <Button key="k:r" plain hotkey="r" label="rename" onPress={keyPress(row => startRename(row))} />
          {/* vi's i and a: edit the selected task (where the cursor lands is the field's own) */}
          <Button key="k:i" plain hotkey="i" label="edit" onPress={keyPress(row => startRename(row))} />
          <Button key="k:a" plain hotkey="a" label="append" onPress={keyPress(row => startRename(row))} />
          {/* vi: dd deletes; o / b open a new task under / over the selected one */}
          <Button key="k:d" plain hotkey="d" label="delete (dd)" onPress={dd} />
          {canAdd && <Button key="k:o" plain hotkey="o" label="new task below" onPress={openAt('below')} />}
          {canAdd && <Button key="k:b" plain hotkey="b" label="new task above" onPress={openAt('above')} />}
          <Button key="k:j" plain hotkey="j" label="next task" onPress={step(1)} />
          <Button key="k:k" plain hotkey="k" label="previous task" onPress={step(-1)} />
          {/* l: the selected task into the prompt box, as its ◀ does */}
          <Button key="k:l" plain hotkey="l" label="load into the prompt" onPress={keyPress(row => (row.item.done ? undefined : load(row)))} />
          <Button key={`k:${SEARCH_KEY}`} plain hotkey={SEARCH_KEY} label="search" onPress={openSearch} />
          <Button key={EDIT_KEY} plain label="edit selected" onPress={keyPress(row => (row.item.done ? undefined : startRename(row)))} />
        </Box>
      )}
      {/* The file and when it was read: nothing more (owner 30 Oct 2026). */}
      <Text mono dimColor size="caption">{shownPath} · {time}</Text>
    </Box>
  )
  // The window sits where the engine's window stands: as many blank rows above as it has scrolled,
  // the rest of its range below.
  return !own ? body : (
    <Box flexDirection="column">
      <Box key="above" height={at0} />
      {body}
      <Box key="below" height={maxTop - at0} />
    </Box>
  )
}
