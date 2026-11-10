---
name: todo
author: shrix
description: "(shrix) The session's project todo list, kept in <project root>/.claude/todo.md. Use when the user runs /todo to view, add, remove, complete/un-complete items, clear done items or search items. NOT the project's task docs (tasks.md, TODO.md: use proj-tasks)."
metadata:
  version: "2.0"
  category: status
effort: low
---

# Todo List (`/todo`)

Each project has its own list, in `<project root>/.claude/todo.md`, and the working folder decides which: its git root, the main checkout's for a worktree, so every session of a project shares one list; outside git, the folder itself. This skill lives inside the todo mod (at its `skills/todo/`), whose task pane (ctxbar's task icon opens it) edits the same file through `todo.py --json` (its contract is ctxbar's `docs/spec/ctxbar-task-panel.md` § 4.7). That mod also registers `/todo`: typed bare it opens or closes the pane; with words it runs this script with them and shows its output itself.

## File format

The contract both `/todo` and the task pane keep (ctxbar spec § 4.4):
- A task is `- [ ] title` or `- [x] title` (`- [X]` reads as done too), plus any lines indented under it (two spaces or more, or a tab; not blank): they are the rest of its title, so a task can take several lines, and every edit moves it whole. A blank line ends a task; every other line is kept as written.
- `## Name` starts a folder that runs to the next `## `; lines above the first heading are the top folder.
- The file is read split on `\n` only, so CRLF lines and the final newline survive every edit; a BOM at the start is read past and kept.
- Every edit locks `<file>.lock`, copies the file to `<file>.prev` and writes atomically; a removed line goes to `<file>.deleted`. A write that fails leaves the file as it was and no temp file behind (`.prev` is put in place only once the new file is written, just before it replaces the old). A file that is a symlink is written through the link, which stays.
- `add` takes one line per task, of any length: empty text, or text with a line break, a tab or another control character, is refused.

## Commands

| Invocation | Effect |
|---|---|
| `/todo` | Print the current list |
| `/todo add <text>[, <text>...]` | Append one or more pending items |
| `/todo remove <num>[, <num>...]` | Remove one or more items (pending OR done — unified numbering) |
| `/todo completed <num>[, <num>...]` | Mark pending item(s) as done |
| `/todo uncheck <num>[, <num>...]` | Flip done item(s) back to pending |
| `/todo clear` | Wipe all done items |
| `/todo search <words>` | The tasks holding every word (any case, any of a task's lines), all folders: pending first, then done struck (`~~…~~`), each as `#N` with its list number — `#N`, not `N.`, as markdown renumbers a list — so `completed N` works next; read-only |
| `/todo help`, `-h`, `--help` | Show help — full command listing with examples |

**Numbering:** items are **continuously numbered** — pending first (1..P), then done (P+1..P+D). All number-taking commands (`remove`, `completed`, `uncheck`) use this unified scheme. `remove N` works on any item; `completed N` errors if N is already done; `uncheck N` errors if N is still pending. Done items render with ✅ right-aligned in a straight vertical column based on the longest done-item text, so the checkmarks line up regardless of item length.

**Shorthand:** any non-empty prefix of the subcommand works — `a`/`ad`/`add`, `r`/`re`/`rem`/.../`remove`, `c`/`co`/.../`completed`, `cl`/`cle`/.../`clear`, `u`/`un`/.../`uncheck`, `s`/`se`/.../`search`. **Prefix collision note:** `c` resolves to `completed` (checked first in dispatch); to reach `clear` via prefix matching, you need at least `cl`. Other canonicals have unique first letters (a/r/h/u/s). **Single-char alias `x` → `clear`:** since `clear`'s natural letter `c` collides with `completed`, the short option `-x` is dedicated to `clear`. So `! todo -x` wipes all done items. Pass whatever the user typed through to the script unchanged; the script resolves the prefix itself.

**Flag syntax (POSIX/GNU-aligned):**
- `-X` — single dash + **exactly one character** (POSIX short option): `-a`, `-r`, `-c`, `-h`, `-u` (uncheck), `-x` (clear), `-s` (search)
- `--XYZ` — double dash + **one or more characters** (GNU long option): `--add`, `--remove`, `--help`, etc.
- **Rejected:** `-add`, `-rem`, or any single-dash-with-multi-char form — POSIX reads these as option clustering (`-a -d -d`), which this skill does not support. Also rejected: `---foo` (three or more dashes), bare `-`, and bare `--`.

The echo line always shows the canonical resolved form regardless of input style, so `/todo -a item1`, `/todo --add item1`, `/todo a item1`, and `/todo add item1` all produce byte-identical output.

**Folders:** the list is flat. A `## ` heading written by hand still works here: the list is grouped under folder names (done items carry `· folder`), `add` goes to the first named folder, and echoes name the tasks (`› completed 2 (Buy milk)`). The pane shows all of them as one list.

**Restore:** `.claude/todo.md.prev` is the file before the last edit; `.claude/todo.md.deleted` keeps every removed line under a timestamp.

**Batching:** use `,` to separate multiple items or numbers in one command (not in `search`, where a comma is plain text). Examples:
- `/todo add Buy milk, Call mom, Write skill`
- `/todo remove 2, 4`
- `/todo completed 1, 3`

**Ranges (remove/completed/uncheck):** use `N-M` (inclusive, ascending) anywhere a number is valid, and mix freely with singletons:
- `/todo -c 1-5` — completes items 1 through 5
- `/todo -c 1-3, 7` — completes 1, 2, 3, and 7
- `/todo -r 2-4, 8-10` — removes 2-4 and 8-10
- `/todo -u 5-7` — flips done items 5-7 back to pending

Invalid ranges (`5-1` descending, `1-` incomplete, `1-5-7` too many dashes, `1-abc` non-numeric) are rejected with a one-line error. The echo line **run-length compresses contiguous runs**, so `-c 1, 2, 3, 5` echoes as `› completed 1-3, 5`, and `-c 5, 1-3` echoes as `› completed 5, 1-3` (insertion order preserved).

For `remove`/`completed`/`uncheck`, all numbers are resolved against the **current** displayed numbering (pending 1..P, then done P+1..P+D) before any mutation happens — so `remove 2, 4` always targets what was #2 and #4 when you ran the command, not whatever ends up at those positions after #2 is gone. Batches are all-or-nothing: if any number or range is invalid, nothing is mutated.

**Known limitation:** because `,` is the batch separator, you cannot add an item whose text contains a comma — `add Hello, world` creates two items, not one.

Numbers are worked out from the file when the command runs (pending 1..P, done P+1..P+D) — the numbering a list printed now would show. If the task pane or another session changed the file since your last list, list again before using a number.

## Execution

Run the bundled script via Bash and pass the user's arguments verbatim:

```
python3 "${CLAUDE_SKILL_DIR}/scripts/todo.py" [args...]
```

Run it from the session's starting folder: the working folder picks the project, so a shell `cd` elsewhere would reach another list. In a worktree session the list is the main checkout's, outside the Bash sandbox, so an edit from here can fail with `Operation not permitted`: tell the user to type `/todo <words>` or use the pane, which run outside it.

The script's stdout **is** the response.

## CRITICAL Output Rule

When executing `/todo`, output **ONLY** the script's stdout.

- ❌ No preamble ("Here's your list:", "I'll add that:", etc.)
- ❌ No confirmation ("Added!", "Done.")
- ❌ No trailing summary
- ❌ No insight boxes (★ Insight blocks)
- ❌ No explanations of what happened
- ✅ Just the raw stdout from the script, as-is

This rule **overrides** the explanatory output style for this skill only: just the list, nothing else.

## Example outputs

Bare list (no args, no echo). Numbers are continuous; ✅ is right-aligned in a column based on the longest done-item text:
```
**ToDo** (3 items, 1 done)
1. Buy milk
2. Write skill
3. Call mom ✅
```

Mutation commands echo the resolved full-form invocation on a `›` line above the list, so shorthand (`a`/`r`/`c`) visibly expands:

```
› add Buy milk
**ToDo** (1 items, 0 done)
1. Buy milk
```

```
› remove 1
**ToDo** (0 items) — empty
```

```
› completed 2
**ToDo** (3 items, 2 done)
1. Buy milk
2. Write skill ✅
3. Call mom    ✅
```

Empty state (no echo for bare list):
```
**ToDo** (0 items) — empty
```

Search (each line but the last ends in two spaces, a markdown line break; words are typed without quotes):
```
› search milk
**ToDo** search "milk" (2 matches, 1 done)
#1 Buy milk · Home
#4 ~~Return milk~~ · Home
```

Errors (no echo — the ❌ line is the whole response; exit 1):
```
❌ No item #99 (list has 3 items)
```
