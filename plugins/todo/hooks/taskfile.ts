// (c) Shrix
// author: shrix
// The task pane's pure helpers: the argv that runs todo.py, the check of the JSON it prints,
// the order the pane lists tasks in, and the same checks on a title that todo.py applies
// (spec ~/.agents/skills/ctxbar/docs/spec/ctxbar-task-panel.md § 4.4, 4.7, 4.8, FR4).
import type { ErrorKind, FolderView, Item, TaskError, TaskState } from '../types'

export type { ErrorKind, FolderView, Item, TaskError, TaskState }
export const JSON_VERSION = 1

export type TaskOp =
  | { op: 'add'; folder: string; title: string }
  | { op: 'tick' | 'untick' | 'delete' | 'up' | 'down'; folder: string; nth: number; title: string }
  | { op: 'rename'; folder: string; nth: number; title: string; to: string }
  | { op: 'insert'; folder: string; nth: number; title: string; to: string; where: 'before' | 'after' } // a new task `to` next to `title`, in file order
  | { op: 'undo'; token: string } // the last save's undo token

// The todo skill's script: the skill lives inside this mod, at skills/todo/ (owner 1Nov26: one todo, not two).
export const bundledTodoPy = (root: string): string => `${root}/skills/todo/scripts/todo.py`

// The pending tasks at the last read.
export type PendingCount = { total: number }

// A path as the pane shows it: the home folder as `~`.
export const tildePath = (path: string, home: string): string =>
  home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

export const argvRead = (py: string): string[] => ['python3', py, '--json']

// Every user value goes after `--`, so one that starts with '-' is never read as an option.
export function argvEdit(py: string, op: TaskOp): string[] {
  const head = ['python3', py, '--json', op.op]
  switch (op.op) {
    case 'add':
      return [...head, `--folder=${op.folder}`, '--', op.title]
    case 'tick':
    case 'untick':
    case 'delete':
    case 'up': // one place earlier in the file, among the folder's tasks of the same state
    case 'down':
      return [...head, `--folder=${op.folder}`, `--nth=${op.nth}`, '--', op.title]
    case 'rename':
      return [...head, `--folder=${op.folder}`, `--nth=${op.nth}`, '--', op.title, op.to]
    case 'insert':
      return [...head, `--folder=${op.folder}`, `--nth=${op.nth}`, `--where=${op.where}`, '--', op.title, op.to]
    case 'undo':
      return [...head, `--token=${op.token}`]
  }
}

export const isError = (r: TaskState | TaskError): r is TaskError => 'kind' in r

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const count = (v: unknown, from: number) => Number.isInteger(v) && (v as number) >= from
const finite = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

function isItem(v: unknown): v is Item {
  return isObject(v) && typeof v.key === 'string' && v.key !== '' && typeof v.title === 'string' &&
    typeof v.done === 'boolean' && count(v.nth, 1)
}

function isFolder(v: unknown): v is FolderView {
  return isObject(v) && typeof v.name === 'string' && typeof v.label === 'string' && count(v.pending, 0) &&
    count(v.done, 0) && Array.isArray(v.items) && v.items.every(isItem)
}

function asState(v: Record<string, unknown>): TaskState | null {
  const ok = v.version === JSON_VERSION && typeof v.path === 'string' &&
    (v.state === 'list' || v.state === 'nofile') && finite(v.mtimeMs) && finite(v.size) &&
    Array.isArray(v.folders) && v.folders.every(isFolder)
  if (!ok) return null
  const { version, path, state, mtimeMs, size, folders } = v as unknown as TaskState
  // A save that wrote hands an undo token (todo.py `undo_token`); a read or a no-change save none.
  return { version, path, state, mtimeMs, size, folders, ...(typeof v.undo === 'string' && v.undo !== '' ? { undo: v.undo } : {}) }
}

const KINDS: ErrorKind[] = ['input', 'read', 'write', 'busy', 'conflict', 'internal']

// What todo.py printed: its state, its own error (with the state when it gave one), or the
// pane's `process` / `version` error when the output cannot be trusted.
export function parseResult(stdout: string, truncated: boolean): TaskState | TaskError {
  if (truncated) return { kind: 'process', error: "Couldn't run /todo: list too large" }
  let v: unknown
  try {
    v = JSON.parse(stdout.trim())
  } catch {
    return { kind: 'process', error: "Couldn't run /todo: no answer it could read" }
  }
  if (!isObject(v)) return { kind: 'process', error: "Couldn't run /todo: no answer it could read" }
  if ('version' in v && v.version !== JSON_VERSION) {
    const shown = typeof v.version === 'number' && Number.isInteger(v.version) ? String(v.version) : '?'
    return { kind: 'version', error: `Update /todo (JSON version ${shown})` }
  }
  if (typeof v.kind === 'string') {
    const kind = (KINDS as string[]).includes(v.kind) ? (v.kind as ErrorKind) : 'internal'
    const state = 'folders' in v ? asState(v) : null
    return { kind, error: typeof v.error === 'string' ? v.error : '/todo failed', ...(state ? { state } : {}) }
  }
  return asState(v) ?? { kind: 'process', error: "Couldn't run /todo: no answer it could read" }
}

// File order is age order; the pane lists the newest first.
export const newestFirst = (items: Item[]): Item[] => [...items].reverse()

// Search (spec todo-search.md FR1): every word of the query, lower case, somewhere in the title, all
// its lines. toLowerCase, never the locale's, to agree with todo.py's str.lower() (search_matches).
export const queryWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

// What the person's Esc (or the pane's close mark) does, in order: leave an open field; else close
// an open search; else undo a change of the last 10 s, or close the pane.
export const escapeStep = (editOpen: boolean, search: string | null | undefined): 'edit' | 'search' | 'undo-or-close' =>
  editOpen ? 'edit' : search != null ? 'search' : 'undo-or-close'

export function matches(title: string, query: string): boolean {
  const text = title.toLowerCase()
  return queryWords(query).every(word => text.includes(word))
}

// The pre-check mirrors todo.py's (`_text_ok`) so the pane never sends text todo.py would refuse;
// todo.py stays the authority.
const BREAKS = [' ', ' '] // line breaks that are not control characters
const C0_END = 0x20
const C1 = [0x7f, 0x9f] // DEL and the C1 controls, Unicode category Cc with C0
const isControl = (c: string) => {
  const n = c.codePointAt(0)!
  return n < C0_END || (n >= C1[0]! && n <= C1[1]!)
}
const isLoneSurrogate = (c: string) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff
// A task's line has no length limit (owner 4 Nov 2026).
function spaceTrimmed(s: string): string | null {
  const t = s.replace(/^ +| +$/g, '')
  const chars = [...t] // code points, as todo.py counts
  const ok = chars.length >= 1 && !chars.some(c => BREAKS.includes(c) || isControl(c) || isLoneSurrogate(c))
  return ok ? t : null
}

export const TITLE_MESSAGE = 'A task needs some text, its first line not blank'

// A title may take several lines (todo.py's `_check_title`): each trimmed of spaces, blank ones
// dropped, the first not blank, each as a one-line title is.
export function checkTitle(s: string): string | null {
  const [first = '', ...rest] = s.split('\n')
  const kept = [spaceTrimmed(first), ...rest.filter(line => line.replace(/ /g, '') !== '').map(line => spaceTrimmed(line))]
  return kept.includes(null) ? TITLE_MESSAGE : null
}

// The lines `text` takes in a column `width` cells wide: each of its lines wrapped, at least one each.
export const wrappedLines = (text: string, width: number): number =>
  text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / width)), 0)

const LINE_MARGIN = 10 // owner 6 Nov 2026: a field shows its next line this many cells before the current one ends

// How tall a task field is drawn: a row for every line `text` takes `width` wide, counting LINE_MARGIN more at its
// end, and never under two: only two rows or more hold several lines, and a desktop's one-row field is narrower.
export const fieldRows = (text: string, width: number): number =>
  Math.max(2, wrappedLines(text + ' '.repeat(LINE_MARGIN), width))

// A task's title as the list shows it: whole while it takes at most `most` lines `width` wide, else cut
// there with an ellipsis (its field shows all of it). The pane draws one tree of at most 100,000
// characters, so a task with no length limit can never be drawn whole.
export function shownTitle(title: string, width: number, most: number): string {
  if (wrappedLines(title, width) <= most) return title
  const kept: string[] = []
  let left = most
  for (const line of title.split('\n')) {
    const chars = [...line]
    const takes = Math.max(1, Math.ceil(chars.length / width))
    if (takes < left) {
      kept.push(line)
      left -= takes
      continue
    }
    kept.push(`${chars.slice(0, left * width - 1).join('')}…`) // the last line left: cut, the ellipsis in its last cell
    break
  }
  return kept.join('\n')
}

export const validHue = (hue: unknown, hues: number): hue is number => Number.isInteger(hue) && (hue as number) >= 0 && (hue as number) < hues

// A new project's colour: one of the least used of `hues`, picked at random (`roll`, 0 to below 1), so
// every colour goes round once before any repeats (owner 6 Nov 2026). `taken`: the colours projects hold.
export function nextHue(taken: number[], hues: number, roll: number): number {
  const uses = new Array<number>(hues).fill(0)
  for (const hue of taken) if (validHue(hue, hues)) uses[hue]! += 1
  const fewest = Math.min(...uses)
  const free = uses.flatMap((n, hue) => (n === fewest ? [hue] : []))
  return free[Math.floor(roll * free.length)]!
}
