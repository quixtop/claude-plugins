---
name: todo
author: shrix
description: "(shrix) Personal todo list manager backed by a configurable file (default ~/md/todo.md, folders as ## headings). Use when the user runs /todo to view, add, remove, complete/un-complete items, clear done items, or set the file path. NOT for project task tracking (use proj-tasks)."
metadata:
  version: "2.0"
  category: status
effort: low
---

# Todo List (`/todo`)

Personal todo manager. Default file is `~/md/todo.md`; the path can be reconfigured persistently. This skill lives inside the todo mod (at its `skills/todo/`), whose task pane (ctxbar's task icon opens it) edits the same file through `todo.py --json` (its contract is ctxbar's `docs/spec/ctxbar-task-panel.md` § 4.7). That mod also registers `/todo`: typed bare it opens or closes the pane; with words it runs this script with them and shows its output itself.

## File format

The contract both `/todo` and the task pane keep (ctxbar spec § 4.4):
- A task is `- [ ] title` or `- [x] title` (`- [X]` reads as done too), plus any lines indented under it (two spaces or more, or a tab; not blank): they are the rest of its title, so a task can take several lines, and every edit moves it whole. A blank line ends a task; every other line is kept as written.
- `## Name` starts a folder that runs to the next `## `; lines above the first heading are the top folder.
- The file is read split on `\n` only, so CRLF lines and the final newline survive every edit; a BOM at the start is read past and kept.
- Every edit locks `<file>.lock`, copies the file to `<file>.prev` and writes atomically; a removed line goes to `<file>.deleted`. A write that fails leaves the file as it was and no temp file behind (`.prev` is put in place only once the new file is written, just before it replaces the old). A file that is a symlink is written through the link, which stays.
- `add` takes one line per task, 1–500 characters: text with a line break, a tab or another control character is refused.

## Commands

| Invocation | Effect |
|---|---|
| `/todo` | Print the current list |
| `/todo add <text>[, <text>...]` | Append one or more pending items |
| `/todo remove <num>[, <num>...]` | Remove one or more items (pending OR done — unified numbering) |
| `/todo completed <num>[, <num>...]` | Mark pending item(s) as done |
| `/todo uncheck <num>[, <num>...]` | Flip done item(s) back to pending |
| `/todo clear` | Wipe all done items |
| `/todo path` | Show the current todo file path |
| `/todo path <new-path>` | Set the todo file path (persistent) |
| `/todo path reset` | Restore the default `~/md/todo.md` |
| `/todo help`, `-h`, `--help` | Show help — full command listing with examples |

**Numbering:** items are **continuously numbered** — pending first (1..P), then done (P+1..P+D). All number-taking commands (`remove`, `completed`, `uncheck`) use this unified scheme. `remove N` works on any item; `completed N` errors if N is already done; `uncheck N` errors if N is still pending. Done items render with ✅ right-aligned in a straight vertical column based on the longest done-item text, so the checkmarks line up regardless of item length.

**Shorthand:** any non-empty prefix of the subcommand works — `a`/`ad`/`add`, `r`/`re`/`rem`/.../`remove`, `c`/`co`/.../`completed`, `cl`/`cle`/.../`clear`, `p`/`pa`/`pat`/`path`, `u`/`un`/.../`uncheck`. **Prefix collision note:** `c` resolves to `completed` (checked first in dispatch); to reach `clear` via prefix matching, you need at least `cl`. Other canonicals have unique first letters (a/r/p/h/u). **Single-char alias `x` → `clear`:** since `clear`'s natural letter `c` collides with `completed`, the short option `-x` is dedicated to `clear`. So `! todo -x` wipes all done items. Pass whatever the user typed through to the script unchanged; the script resolves the prefix itself.

**Flag syntax (POSIX/GNU-aligned):**
- `-X` — single dash + **exactly one character** (POSIX short option): `-a`, `-r`, `-c`, `-p`, `-h`, `-u` (uncheck), `-x` (clear)
- `--XYZ` — double dash + **one or more characters** (GNU long option): `--add`, `--remove`, `--help`, etc.
- **Rejected:** `-add`, `-rem`, or any single-dash-with-multi-char form — POSIX reads these as option clustering (`-a -d -d`), which this skill does not support. Also rejected: `---foo` (three or more dashes), bare `-`, and bare `--`.

The echo line always shows the canonical resolved form regardless of input style, so `/todo -a item1`, `/todo --add item1`, `/todo a item1`, and `/todo add item1` all produce byte-identical output.

**Configuration:** the active path is stored in `config` in this skill's own folder, beside `scripts/` (one line, just the absolute path). Absent → default (`~/md/todo.md`) is used. `path reset` deletes the config file. Installed as part of the todo plugin, that folder is the plugin's copy, so a plugin update resets a custom path to the default (`/todo path <new-path>` sets it again).

**Folders:** with a `## ` heading in the file, the list is grouped under folder names (done items carry `· folder`), `add` goes to the first named folder, and echoes name the tasks (`› completed 2 (Buy milk)`). Without one it looks and works exactly as before.

**Restore:** `~/md/todo.md.prev` is the file before the last edit; `~/md/todo.md.deleted` keeps every removed line under a timestamp.

**Batching:** use `,` to separate multiple items or numbers in one command. Examples:
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

Errors (no echo — the ❌ line is the whole response; exit 1):
```
❌ No item #99 (list has 3 items)
```
