// (c) Shrix
// author: shrix
// The task pane's pure helpers: the argv that runs todo.py, the check of the JSON it prints,
// the order the pane lists tasks in, and the same limits on a title and a folder name that
// todo.py applies (spec ~/.agents/skills/ctxbar/docs/spec/ctxbar-task-panel.md § 4.4, 4.7, 4.8, FR4).
import type { ErrorKind, FolderView, Item, TaskError, TaskState } from '../types'

export type { ErrorKind, FolderView, Item, TaskError, TaskState }
export const JSON_VERSION = 1
export const TITLE_MAX = 500
export const FOLDER_MAX = 60

export type TaskOp =
  | { op: 'add'; folder: string; title: string }
  | { op: 'tick' | 'untick' | 'delete' | 'up' | 'down'; folder: string; nth: number; title: string }
  | { op: 'rename'; folder: string; nth: number; title: string; to: string }
  | { op: 'insert'; folder: string; nth: number; title: string; to: string; where: 'before' | 'after' } // a new task `to` next to `title`, in file order
  | { op: 'folder-add'; name: string }
  | { op: 'folder-rename'; from: string; to: string }
  | { op: 'folder-delete'; name: string }
  | { op: 'undo'; token: string } // the last save's undo token

// The todo skill's script: the skill lives inside this mod, at skills/todo/ (owner 1Nov26: one todo, not two).
export const bundledTodoPy = (root: string): string => `${root}/skills/todo/scripts/todo.py`

// Where the focus ring goes once a field (not a rename) saves: a new task's, onto `editKey` while a
// task is selected, so Enter edits it (owner 30 Oct 2026); else, and for a folder field, onto the
// ▼. Never onto the +, where Enter would open a new task.
export const ringAfterSave = (field: string, selected: boolean, editKey: string): string =>
  field.startsWith('add:') && selected ? editKey : 'pick'

// The pending tasks at the last read: in all, and by folder label.
export type PendingCount = { total: number; by: Record<string, number> }

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
    case 'folder-add':
    case 'folder-delete':
      return [...head, '--', op.name]
    case 'folder-rename':
      return [...head, '--', op.from, op.to]
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

// What the person's Esc (or the pane's close mark) does, in order: leave an open field, question or
// folder list; else close an open search; else undo a change of the last 10 s, or close the pane.
export const escapeStep = (editOpen: boolean, search: string | null | undefined): 'edit' | 'search' | 'undo-or-close' =>
  editOpen ? 'edit' : search != null ? 'search' : 'undo-or-close'

export function matches(title: string, query: string): boolean {
  const text = title.toLowerCase()
  return queryWords(query).every(word => text.includes(word))
}

// The pre-check mirrors todo.py's (`_text_ok`, `_check_folder_text`) so the pane never sends
// text todo.py would refuse; todo.py stays the authority. Known limit: names compare with
// toLowerCase here and casefold there (ß), so todo.py may still refuse a rare name.
const BREAKS = [' ', ' '] // line breaks that are not control characters
const C0_END = 0x20
const C1 = [0x7f, 0x9f] // DEL and the C1 controls, Unicode category Cc with C0
const isControl = (c: string) => {
  const n = c.codePointAt(0)!
  return n < C0_END || (n >= C1[0]! && n <= C1[1]!)
}
const isLoneSurrogate = (c: string) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff
// Python's str.strip() whitespace: what todo.py refuses at a folder name's edges.
const EDGE_SPACE = /^[\s\u001c-\u001f\u0085]|[\s\u001c-\u001f\u0085]$/u
const RESERVED = ['(no folder)', '(unnamed)']

function spaceTrimmed(s: string, limit: number): string | null {
  const t = s.replace(/^ +| +$/g, '')
  const chars = [...t] // code points, as todo.py counts
  const ok = chars.length >= 1 && chars.length <= limit &&
    !chars.some(c => BREAKS.includes(c) || isControl(c) || isLoneSurrogate(c))
  return ok ? t : null
}

export const TITLE_MESSAGE = `A task needs 1–${TITLE_MAX} characters, its first line not blank`
export const FOLDER_MESSAGE = `A folder name needs 1–${FOLDER_MAX} characters on one line, not All or an existing name`

// A title may take several lines (todo.py's `_check_title`): each trimmed of spaces, blank ones
// dropped, the first not blank, each as a one-line title is, TITLE_MAX code points in all.
export function checkTitle(s: string): string | null {
  const [first = '', ...rest] = s.split('\n')
  const kept = [spaceTrimmed(first, TITLE_MAX), ...rest.filter(line => line.replace(/ /g, '') !== '').map(line => spaceTrimmed(line, TITLE_MAX))]
  if (kept.includes(null)) return TITLE_MESSAGE
  return [...kept.join('\n')].length > TITLE_MAX ? TITLE_MESSAGE : null
}

// `existing` holds every folder's name and label; `keep` is the folder being renamed, so a
// change of case of its own name passes.
export function checkFolder(s: string, existing: string[], keep?: string): string | null {
  const name = spaceTrimmed(s, FOLDER_MAX)
  if (name === null || EDGE_SPACE.test(name) || name.toLowerCase() === 'all' || RESERVED.includes(name)) return FOLDER_MESSAGE
  const taken = existing.filter(e => e !== keep).map(e => e.toLowerCase())
  return taken.includes(name.toLowerCase()) ? FOLDER_MESSAGE : null
}

// A folder's colour is kept by name, compared as todo.py compares names (A11).
export const colourKey = (name: string): string => name.trim().toLowerCase()

// The colour each folder in `names` (file order) keeps: its own while it has a valid one, else
// the least used of `hues` (the first on a tie), so new folders differ while colours are free.
// A gone folder frees its colour; `rename` (folder names) carries one across a rename made in the
// pane, and a folder still holding the old name keeps it too. Prototype-free maps: a folder may be
// called `constructor` or `__proto__`.
export function assignColours(was: Record<string, number>, names: string[], hues: number, rename?: { from: string; to: string }): Record<string, number> {
  const kept: Record<string, number> = Object.assign(Object.create(null), was)
  const from = rename ? colourKey(rename.from) : ''
  if (rename && from !== colourKey(rename.to) && from in kept) kept[colourKey(rename.to)] = kept[from]!
  const next: Record<string, number> = Object.create(null)
  const uses = new Array<number>(hues).fill(0)
  const keys = [...new Set(names.map(colourKey))]
  for (const k of keys) {
    const hue = kept[k]
    if (Number.isInteger(hue) && hue! >= 0 && hue! < hues) {
      next[k] = hue!
      uses[hue!]! += 1
    }
  }
  for (const k of keys) {
    if (k in next) continue
    const hue = uses.indexOf(Math.min(...uses))
    next[k] = hue
    uses[hue]! += 1
  }
  return next
}
