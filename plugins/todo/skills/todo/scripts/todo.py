#!/usr/bin/env python3
# (c) Shrix
# author: shrix
"""todo backend: a project's todo list manager.

The file is <project root>/.claude/todo.md: the git root of the working folder (the main
checkout's for a worktree), else the working folder itself. One flat list; any `## Name`
headings in it still read as folders.

Usage:
  todo.py                              # list
  todo.py add <text>[, <text>...]      # append one or more items
  todo.py remove <num>[, <num>...]     # remove pending OR done items
  todo.py completed <num>[, <num>...]  # mark pending items as done
  todo.py uncheck <num>[, <num>...]    # flip done items back to pending
  todo.py clear                        # wipe all done items
  todo.py search <words>               # tasks holding every word, numbered as listed
  todo.py help                        # show full help (also h, -h, --help)

Items are numbered CONTINUOUSLY: pending 1..P first, then done P+1..P+D.
All operations that take numbers (remove, completed, uncheck) use this
unified numbering. `remove N` works on any item; `completed N` errors if
N refers to an already-done item; `uncheck N` errors if N is still pending.

Any non-empty prefix of a subcommand works. Collision note: `c` resolves
to `completed` (checked first); `cl` or longer
is required to reach `clear` via prefix matching. Other canonicals have
unique first letters (a/r/h/u/s). Single-char alias: `x` → `clear`
(so `-x` is the short option for clear, since `clear`'s own letter `c`
collides with `completed`).

Flag syntax (POSIX/GNU-aligned):
  `-X`   — single dash + exactly one char (POSIX short option), e.g. `-a`
  `--X+` — double dash + one or more chars (GNU long option), e.g. `--add`
Both are stripped to their canonical form before prefix matching, so `-a`,
`--a`, and `--add` all resolve to `add`. Malformed forms like `-add`
(single dash + multi-char, looks like POSIX option clustering) and `---foo`
(excess dashes) are rejected with a usage error — this aligns with shell
muscle memory. Examples:
  /todo -a item1       → add item1
  /todo --add item1    → add item1
  /todo -r 3           → remove 3
  /todo -c 4           → completed 4
  /todo -h             → help

Batches are comma-separated. Numbers are resolved against the CURRENT display
order (pending 1..P first, then done P+1..P+D) before any mutation, so
`remove 2, 4` always targets what was #2 and #4 when you ran the command.
Batches are all-or-nothing: if any number is invalid or out of range, nothing
is mutated. Duplicate numbers are silently deduped.

Ranges: use `N-M` (inclusive, ascending) anywhere a number is valid, and mix
with singletons: `-c 1-5`, `-c 1-3, 7`, `-r 2-4, 8-10`. The echo line compresses
contiguous runs in the parsed result, so `-c 1, 2, 3, 5` echoes as `completed
1-3, 5`. Invalid ranges (e.g. `5-1`, `1-`, `1-5-7`, `1-abc`) reject with a
❌ line; batches remain all-or-nothing.

Limitation: because `,` is the batch separator, you cannot add an item whose
text contains a comma — `add Hello, world` creates two items, not one.

Output: bare `/todo` shows just the list. Mutation commands echo the resolved
full-form invocation on a `›` line above the list. Errors are a single ❌ line
with no echo, and exit 1.
"""

import argparse
import atexit
import collections
import contextlib
import datetime
import fcntl
import glob
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import unicodedata

atexit.register(lambda: sys.stdout.isatty() and print())   # trailing gap, TTY only

GIT_TIMEOUT_S = 2     # a local rev-parse takes milliseconds; a stuck one never holds the pane up
ITEM_RE = re.compile(r"^- \[( |x|X)\] (.+)$")   # `X`, as GitHub and other editors write it, is done too


def project_root(start):
    """The folder whose tasks a session in `start` shows: its git root, the main checkout's for a
    worktree, so every session of a project shares one list; `start` itself outside git."""
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR")}   # a hook's: not this folder's

    def git(*args):
        try:
            done = subprocess.run(["git", "-C", start, "rev-parse", *args],
                                  capture_output=True, text=True, timeout=GIT_TIMEOUT_S, env=env)
        except (OSError, subprocess.SubprocessError):
            return None
        return done.stdout.strip() if done.returncode == 0 else None
    common = git("--path-format=absolute", "--git-common-dir")
    if common and os.path.basename(common) == ".git":
        return os.path.dirname(common)
    return git("--show-toplevel") or start


def get_todo_path():
    """The task file of the project the working folder belongs to (absolute)."""
    return os.path.join(project_root(os.getcwd()), ".claude", "todo.md")


def display_path(path):
    """Normalize $HOME → ~ for readability."""
    home = os.path.expanduser("~")
    if path == home:
        return "~"
    if path.startswith(home + os.sep):
        return "~" + path[len(home):]
    return path


LOCK_WAIT_S = 3.0      # how long a writer waits for another one before "busy"
LOCK_POLL_S = 0.05


class Busy(Exception):
    """Another writer held the lock for LOCK_WAIT_S."""


_BOM = set()     # the files read_text found a BOM at the start of, this run


def read_text(path):
    """(lines, ends_with_newline): split on "\\n" only, so every other byte (CR,
    form feed, U+2028) stays inside its line and a write gives the same file back."""
    if not os.path.exists(path):
        return [], True
    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()
    if text.startswith("﻿"):    # a BOM some editors write: read past it, written back by write_text
        _BOM.add(path)
        text = text[1:]
    if not text:
        return [], True
    lines = text.split("\n")
    ends = text.endswith("\n")
    if ends:
        lines.pop()
    return lines, ends


def read_lines():
    """The active todo file's lines, split on `\\n` only (see read_text)."""
    return read_text(get_todo_path())[0]


def _create_new(path):
    """Open a fresh file for writing that no link or leftover can redirect."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    try:
        return os.open(path, flags, 0o600)
    except FileExistsError:
        os.remove(path)          # a leftover of ours; we hold the lock
        return os.open(path, flags, 0o600)


def write_text(path, lines, ends):
    """Write a pid-named temp file and fsync it, then copy the file to <file>.prev and
    os.replace — never a half file, never a temp name shared with another writer, and a write
    that fails leaves the file as it was, with no temp file behind (.prev too, unless only the
    final replace fails). A file that is a
    link is written through it (an Obsidian vault, a synced folder), the link kept."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pid = os.getpid()
    target = os.path.realpath(path) if os.path.islink(path) else path
    if os.path.exists(path):
        mode = stat.S_IMODE(os.stat(path).st_mode)          # the file keeps its mode
    else:
        umask = os.umask(0)
        os.umask(umask)
        mode = 0o666 & ~umask
    tmp = f"{target}.tmp.{pid}"      # beside the file it replaces: one file system, so the replace is atomic
    prev_tmp = f"{path}.prev.tmp.{pid}"
    try:
        with os.fdopen(_create_new(tmp), "w", encoding="utf-8", newline="") as f:
            f.write(("﻿" if path in _BOM else "") + "\n".join(lines) + ("\n" if lines and ends else ""))
            f.flush()
            os.fchmod(f.fileno(), mode)
            os.fsync(f.fileno())
        if not os.path.exists(path) and os.path.exists(path + ".prev"):
            # A first save leaves no .prev of some older file for an undo to put back; its lines go to
            # .deleted first, so that restore copy is never lost unlogged.
            stale, _ = read_text(path + ".prev")
            log_deleted(path, [line for line in stale if _bare(line).strip()])
            os.remove(path + ".prev")
        if os.path.exists(path):
            with open(path, "rb") as src, os.fdopen(_create_new(prev_tmp), "wb") as dst:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
            os.replace(prev_tmp, path + ".prev")
        os.replace(tmp, target)
    except BaseException:
        for leftover in (tmp, prev_tmp):
            try:
                os.remove(leftover)
            except OSError:
                pass
        raise


PID_RE = re.compile(r"[0-9]{1,7}")   # macOS pids stay below 100000; other suffixes are not ours


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@contextlib.contextmanager
def locked(path):
    """Hold an exclusive lock on <file>.lock around a read-modify-write; under it,
    remove temp files left by writers that died."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        deadline = time.monotonic() + LOCK_WAIT_S
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Busy()
                time.sleep(LOCK_POLL_S)
        target = os.path.realpath(path) if os.path.islink(path) else path    # a link's temp sits beside its file
        for tmp in {*glob.glob(glob.escape(path) + ".tmp.*"), *glob.glob(glob.escape(target) + ".tmp.*"),
                    *glob.glob(glob.escape(path) + ".prev.tmp.*")}:
            pid = tmp.rsplit(".", 1)[-1]
            if PID_RE.fullmatch(pid) and not _pid_alive(int(pid)):
                try:
                    os.remove(tmp)
                except OSError:
                    pass        # best effort: _create_new still guards the real temp names
        yield
    finally:
        os.close(fd)


def log_deleted(path, lines):
    """Append removed lines to <file>.deleted under a timestamp line — before the
    file itself is written, so no line is ever removed without being logged."""
    if not lines:
        return
    stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    fd = os.open(path + ".deleted", os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8", newline="") as f:
        f.write(f"# {stamp} deleted\n" + "".join(l + "\n" for l in lines))


def append_line(lines, ends, body):
    """Append a line ending like the file's lines, so a CRLF file stays CRLF — also
    when it has no final newline (the old last line then gets the CR it lacked)."""
    crlf = any(l.endswith("\r") for l in lines[-2:])
    if crlf and not ends and not lines[-1].endswith("\r"):
        lines[-1] += "\r"
        lines.append(body)
    else:
        lines.append(body + ("\r" if crlf else ""))


def _bare(line):
    return line.rstrip("\r")


def _more(bare):
    """The text of a task's further line, or None: a line indented two spaces or a tab, as a
    Markdown list item's, that is not blank once its spaces and tabs are trimmed. Spaces and tabs
    only — the title check trims spaces only — so what is written reads back the same."""
    if not (bare.startswith("  ") or bare.startswith("\t")):
        return None
    return bare.strip(" \t") or None


def item_end(lines, index):
    """The index just past the task that starts at `index`: its line and the further lines
    straight under it; a blank line ends it."""
    end = index + 1
    while end < len(lines) and _more(_bare(lines[end])) is not None:
        end += 1
    return end


def item_title(lines, index, first):
    """A task's title: its first line's text, then each further line's, joined by newlines."""
    return "\n".join([first] + [_more(_bare(line)) for line in lines[index + 1:item_end(lines, index)]])


def item_lines(mark, title, ending=""):
    """The file lines of a task: `- [ ] first`, then each further line indented two spaces."""
    first, *rest = title.split("\n")
    return [f"{mark}{first}{ending}"] + [f"  {line}{ending}" for line in rest]


def parse_items(lines):
    """Return list of (line_index, done:bool, text:str) for every task — text holds its further
    lines after newlines; a CRLF line is read without its CR."""
    items = []
    for i, line in enumerate(lines):
        m = ITEM_RE.match(_bare(line))
        if m:
            items.append((i, m.group(1) != " ", item_title(lines, i, m.group(2))))
    return items


HEADING_RE = re.compile(r"^## (.*)$")
TOP_LABEL = "(no folder)"
UNNAMED_LABEL = "(unnamed)"
Folder = collections.namedtuple("Folder", "name label heading items")


def parse(lines):
    """Folders in file order — spec 4.4: a folder runs from its `## ` heading to
    the next; the lines above the first heading are the top folder, listed only
    while it holds an item; a name seen again (trimmed, case-blind) is labelled
    `<name> (2)`. Labels are as written, so a literal `## Done` or `## x (2)`
    heading reads the same as the made-up ones."""
    folders, seen = [], {}
    current = Folder("", TOP_LABEL, None, [])
    for i, line in enumerate(lines):
        bare = _bare(line)
        heading = HEADING_RE.match(bare)
        if heading:
            if current.heading is not None or current.items:
                folders.append(current)
            name = heading.group(1).strip()
            seen[name.casefold()] = seen.get(name.casefold(), 0) + 1
            label = name or UNNAMED_LABEL
            if seen[name.casefold()] > 1:
                label = f"{label} ({seen[name.casefold()]})"
            current = Folder(name, label, i, [])
        else:
            item = ITEM_RE.match(bare)
            if item:
                current.items.append((i, item.group(1) != " ", item_title(lines, i, item.group(2))))
    if current.heading is not None or current.items:
        folders.append(current)
    return folders


def has_headings(folders):
    """True when the file has a `## ` heading, so lists are grouped and echoes name tasks."""
    return any(f.heading is not None for f in folders)


def section_end(lines, heading_index):
    """Index just past a folder's last non-blank line (its heading if empty)."""
    end = heading_index + 1
    while end < len(lines) and not HEADING_RE.match(_bare(lines[end])):
        end += 1
    while end > heading_index + 1 and not _bare(lines[end - 1]).strip():
        end -= 1
    return end


def add_to_first_folder(lines, ends, bodies):
    """Append to the file when it has no heading; else at the end of the first
    named folder's section (spec A8)."""
    first = next((f for f in parse(lines) if f.heading is not None), None)
    if first is None:
        for body in bodies:
            append_line(lines, ends, body)
        return
    pos = section_end(lines, first.heading)
    if pos == len(lines):
        for body in bodies:
            append_line(lines, ends, body)
        return
    cr = "\r" if lines[pos - 1].endswith("\r") else ""     # the ending of the line above
    lines[pos:pos] = [body + cr for body in bodies]


def _partition(lines):
    """Split the items into pending/done.
    Returns (pending, done, num_pending, total) — the shared setup used
    by cmd_rem, cmd_completed, and cmd_uncheck. Centralizes "how do we partition
    items" so the three commands only differ in their validation + mutation logic.
    """
    items = parse_items(lines)
    pending = [it for it in items if not it[1]]
    done = [it for it in items if it[1]]
    return pending, done, len(pending), len(items)


def render(lines):
    """The printed list. Numbers run pending first, then done, in file order —
    the order every number-taking command resolves against. A file with a `## `
    heading is shown grouped: each folder's label over its pending items, then
    "Done" with each done item's folder after a ·."""
    folders = parse(lines)
    items = [it for f in folders for it in f.items]
    total = len(items)
    done = sum(1 for it in items if it[1])
    if total == 0:
        return "**ToDo** (0 items) — empty"

    headed = has_headings(folders)
    out = [f"**ToDo** ({total} items, {done} done)"]
    n = 0
    # pending first, numbered 1..num_pending
    for f in folders:
        pending = [text for _, is_done, text in f.items if not is_done]
        if pending and headed:
            out.append(f.label)
        for text in pending:
            n += 1
            mark = f"{n}. "
            out.append(mark + text.replace("\n", "\n" + " " * len(mark)))   # further lines under its text
    # completed below, continuous numbering, ✅ right-aligned column
    # (longest done text gets 1 space before ✅; shorter ones padded to match)
    # (a task's first line carries the folder and ✅; its further lines follow, indented)
    done_texts = [(f"{text.split(chr(10))[0]} · {f.label}" if headed else text.split("\n")[0], text.split("\n")[1:])
                  for f in folders for _, is_done, text in f.items if is_done]
    if done_texts:
        if headed:
            out.append("Done")
        max_len = max(len(t) for t, _ in done_texts)
        for text, rest in done_texts:
            n += 1
            pad = " " * (max_len - len(text) + 1)
            mark = f"{n}. "
            out.append(f"{mark}{text}{pad}✅" + "".join("\n" + " " * len(mark) + line for line in rest))
    return "\n".join(out)


def query_words(query):
    """The search words, lower case — str.lower(), never casefold(), to agree with the pane's
    toLowerCase() (ctxbar docs/spec/todo-search.md FR1)."""
    return query.lower().split()


def search_matches(title, words):
    """True when every word is in the title, any of its lines, case-blind."""
    text = title.lower()
    return all(word in text for word in words)


def cmd_search(args):
    """Print the tasks holding every word, numbered as the list numbers them, pending first and
    then done struck (FR3). `#N`, never `N.`: markdown renumbers an ordered list. Each line but
    the last ends in a hard break (two spaces) so no renderer joins them. Reads only."""
    query = " ".join(args).strip()
    if len(query) >= 2 and query[0] == query[-1] == '"':     # the mod passes quotes on as typed
        query = query[1:-1].strip()
    words = query_words(query)
    if not words:
        usage()
    folders = parse(read_lines())
    headed = has_headings(folders)
    numbered = [(f, done, text) for want in (False, True) for f in folders for _, done, text in f.items if done == want]
    hits = [(n, f, done, text) for n, (f, done, text) in enumerate(numbered, 1) if search_matches(text, words)]
    out = [f"› search {query}"]
    if not hits:
        out.append(f'**ToDo** search "{query}" — no matches')
    else:
        out.append(f'**ToDo** search "{query}" ({len(hits)} matches, {sum(1 for h in hits if h[2])} done)')
        for n, f, done, text in hits:
            first, *rest = text.split("\n")
            # A tilde inside a struck line is escaped: `~~~` would open a code fence, an inner `~~` end the strike.
            strike = (lambda s: "~~" + s.strip().replace("~", "\\~") + "~~") if done else (lambda s: s)
            mark = f"#{n} "
            out.append(mark + strike(first) + (f" · {f.label}" if headed else ""))
            out.extend(" " * len(mark) + strike(line) for line in rest)
    print("  \n".join(out))


def named(lines, nums, display_order):
    """` (title, title)` after an echo when the file has folders (spec A9)."""
    if not has_headings(parse(lines)):
        return ""
    return " (" + ", ".join(display_order[n - 1][2].split("\n")[0] for n in nums) + ")"


def echo(resolved):
    """Print a one-line echo showing the resolved full-form command."""
    print(f"› {resolved}")


def cmd_list():
    print(render(read_lines()))


def split_csv(args):
    """Join argv tail with spaces, split on commas, strip, drop empties."""
    joined = " ".join(args)
    return [s.strip() for s in joined.split(",") if s.strip()]


def parse_num_list(args):
    """Parse a comma-separated list of numbers and/or ranges. Returns the
    deduped list (insertion order preserved); on error, prints the ❌ line and
    exits 1.

    Accepted elements:
      42        — single number
      3-7       — inclusive range, ascending (3 ≤ 7)
      5-5       — single-num range, equivalent to `5`
    Rejected:
      5-1       — descending range (rejected rather than silently flipped)
      1-        — incomplete
      -5        — empty first part
      1-5-7     — too many dashes
      1-abc     — non-numeric component
    """
    parts = split_csv(args)
    if not parts:
        usage()
    nums = []
    seen = set()
    for p in parts:
        if "-" in p:
            # range: exactly two components, both valid ints, ascending
            range_parts = p.split("-")
            if len(range_parts) != 2 or not range_parts[0] or not range_parts[1]:
                fail(f"❌ Invalid range `{p}`")
            try:
                start = int(range_parts[0])
                end = int(range_parts[1])
            except ValueError:
                fail(f"❌ `{p}` is not a valid range")
            if start > end:
                fail(f"❌ Invalid range `{p}` (start > end)")
            if end - start + 1 > 10000:
                fail(f"❌ Range `{p}` too large (max 10000 per range)")
            for n in range(start, end + 1):
                if n not in seen:
                    seen.add(n)
                    nums.append(n)
        else:
            try:
                n = int(p)
            except ValueError:
                fail(f"❌ `{p}` is not a number")
            if n not in seen:
                seen.add(n)
                nums.append(n)
    return nums


def format_num_list(nums):
    """Run-length compress a list of ints, preserving insertion order.
    Contiguous runs (consecutive ascending) collapse to range notation.

    [1,2,3,4,5]       → '1-5'
    [1,2,3,5,7,8,9]   → '1-3, 5, 7-9'
    [1,3,5]           → '1, 3, 5'
    [5,1,2,3]         → '5, 1-3'   (insertion order preserved)
    [3,3]             → '3'        (dedup happens upstream, this is just robust)
    """
    if not nums:
        return ""
    parts = []
    start = nums[0]
    end = nums[0]
    for n in nums[1:]:
        if n == end + 1:
            end = n
        else:
            parts.append(f"{start}-{end}" if end > start else str(start))
            start = end = n
    parts.append(f"{start}-{end}" if end > start else str(start))
    return ", ".join(parts)


def cmd_add(args):
    texts = split_csv(args)
    if not texts:
        usage()
    for text in texts:               # one line each: a break would write a heading or a task of its own
        if _text_ok(text) is None:
            fail(f"❌ {TITLE_MESSAGE}, on one line with no control characters")
    path = get_todo_path()          # resolved once: lock, read and write the same file
    with locked(path):
        lines, ends = read_text(path)
        before = list(lines)
        add_to_first_folder(lines, ends, [f"- [ ] {text}" for text in texts])
        if not _fits(path, lines) and _fits(path, before):
            fail(f"❌ {TOO_LARGE}")
        write_text(path, lines, ends)
    echo(f"add {', '.join(texts)}")
    print(render(lines))


def cmd_rem(args):
    nums = parse_num_list(args)
    path = get_todo_path()          # resolved once: lock, read and write the same file
    with locked(path):
        lines, ends = read_text(path)
        pending, done, _, total = _partition(lines)
        display_order = pending + done  # matches render() display sequence
        # validate all before mutating (all-or-nothing)
        for n in nums:
            if n < 1 or n > total:
                fail(f"❌ No item #{n} (list has {total} items)")
        # resolve all target line indices upfront, then rebuild without them
        target_line_idxs = {i for n in nums
                            for i in range(display_order[n - 1][0], item_end(lines, display_order[n - 1][0]))}
        names = named(lines, nums, display_order)
        log_deleted(path, [line for i, line in enumerate(lines) if i in target_line_idxs])
        lines = [line for i, line in enumerate(lines) if i not in target_line_idxs]
        write_text(path, lines, ends)
    echo(f"remove {format_num_list(nums)}{names}")
    print(render(lines))


def cmd_completed(args):
    nums = parse_num_list(args)
    path = get_todo_path()          # resolved once: lock, read and write the same file
    with locked(path):
        lines, ends = read_text(path)
        pending, _, num_pending, total = _partition(lines)
        # validate all before mutating (all-or-nothing)
        for n in nums:
            if n < 1 or n > total:
                fail(f"❌ No item #{n} (list has {total} items)")
            if n > num_pending:
                fail(f"❌ Item #{n} is already completed")
        target_line_idxs = {pending[n - 1][0] for n in nums}
        names = named(lines, nums, pending)
        for idx in target_line_idxs:
            lines[idx] = lines[idx].replace("- [ ]", "- [x]", 1)
        write_text(path, lines, ends)
    echo(f"completed {format_num_list(nums)}{names}")
    print(render(lines))


def cmd_uncheck(args):
    nums = parse_num_list(args)
    path = get_todo_path()          # resolved once: lock, read and write the same file
    with locked(path):
        lines, ends = read_text(path)
        pending, done, num_pending, total = _partition(lines)
        # validate all before mutating (all-or-nothing)
        for n in nums:
            if n < 1 or n > total:
                fail(f"❌ No item #{n} (list has {total} items)")
            if n <= num_pending:
                fail(f"❌ Item #{n} is still pending")
        # done index: n in [num_pending+1, total] → done[n - num_pending - 1]
        target_line_idxs = {done[n - num_pending - 1][0] for n in nums}
        names = named(lines, nums, pending + done)
        for idx in target_line_idxs:
            lines[idx] = "- [ ]" + lines[idx][5:]          # `- [x]` or `- [X]`
        write_text(path, lines, ends)
    echo(f"uncheck {format_num_list(nums)}{names}")
    print(render(lines))


def cmd_clear(args):
    # `clear` takes no args; any extra args → usage error
    if args:
        usage()
    path = get_todo_path()          # resolved once: lock, read and write the same file
    with locked(path):
        lines, ends = read_text(path)
        done_line_idxs = {i for it in parse_items(lines) if it[1] for i in range(it[0], item_end(lines, it[0]))}
        if done_line_idxs:          # nothing to clear: no write, so .prev keeps the last edit
            log_deleted(path, [line for i, line in enumerate(lines) if i in done_line_idxs])
            lines = [line for i, line in enumerate(lines) if i not in done_line_idxs]
            write_text(path, lines, ends)
    echo("clear")
    print(render(lines))


def cmd_help():
    current = get_todo_path()
    print("""**/todo** — the project's todo manager

Commands:
  /todo                                 show list
  /todo add <text>[, <text>...]         add item(s)
  /todo remove <num>[, <num>...]        remove pending OR done items
  /todo completed <num>[, <num>...]     mark pending item(s) done
  /todo uncheck <num>[, <num>...]       flip done item(s) back to pending
  /todo clear                           wipe all done items
  /todo search <words>                  find tasks (pending, then done struck)
  /todo help | -h | --help              show this help

Numbering: items are numbered CONTINUOUSLY — pending first (1..P), then
done (P+1..P+D). All number-taking commands use this unified scheme.
Done items render with ✅ right-aligned in a column based on the longest
done item, so the checkmarks form a straight vertical line.

Shorthand: any non-empty prefix works —
  a / ad / add
  r / re / rem / remo / remov / remove
  c / co / ... / completed           ← `c` stays mapped to completed
  cl / cle / clea / clear             ← `clear` via prefix starts at `cl`
  u / un / unc / ... / uncheck
  h / he / hel / help
  s / se / sea / ... / search

Flag syntax (POSIX/GNU-aligned):
  -X     single dash + one char       e.g. -a, -r, -c, -h, -u, -x, -s
  --XYZ  double dash + multi-char     e.g. --add, --remove, --clear
Multi-char forms with a single dash (e.g. `-add`, `-rem`) are rejected
because POSIX reads them as option clustering. Special: `-x` is the
dedicated short option for `clear` (because `clear`'s natural letter `c`
collides with `completed`). Examples:
  /todo -a item1
  /todo -r 3               (works on pending OR done — continuous nums)
  /todo -c 4               (pending only; errors if item is already done)
  /todo -u 5               (done only; errors if item is still pending)
  /todo -x                 (wipe all done items)
  /todo -h

Batching: separate items or numbers with `,` — e.g.
  /todo add Buy milk, Call mom, Write skill
  /todo remove 2, 4
  /todo completed 1, 3
All-or-nothing: if any item in the batch is invalid, nothing is mutated.

Ranges: for remove/completed/uncheck, use `N-M` (inclusive, ascending)
anywhere a number is valid, mixed freely with singletons. E.g.
  /todo -c 1-5           (completes items 1 through 5)
  /todo -r 2-7           (removes items 2 through 7 — pending+done mixed)
  /todo -u 5-7           (flips done items 5-7 back to pending)
Invalid ranges (`5-1`, `1-`, `1-abc`, etc.) are rejected. The echo line
compresses contiguous runs, so `-c 1, 2, 3` echoes as `completed 1-3`.

Notes:
  • Pending and done items share one number space; `remove N` works on any.
  • `completed N` errors if N is already done; `uncheck N` errors if N is still pending.
  • `add Hello, world` creates TWO items (comma is the batch separator).
""")
    print(f"📍 {display_path(current)}")


def fail(msg):
    """Print the single ❌ error line and exit 1 — nothing is mutated after it."""
    print(msg)
    sys.exit(1)


def usage():
    fail("❌ Usage: see `/todo -h`")


def normalize_sub(raw):
    """Strip leading dashes per POSIX/GNU conventions, or return None if malformed.
    Then apply single-char aliases for canonicals that don't start with their own letter.

    Accepted forms:
      '-X'    → 'X'      (POSIX short option: one dash + exactly one char)
      '--XYZ' → 'XYZ'    (GNU long option: two dashes + one or more chars)
    Rejected forms (return None):
      '-XYZ'  (one dash + multi-char looks like POSIX clustering; not supported)
      '---X'  (three or more leading dashes; malformed)
      '-'     (dash only)
      '--'    (double dash only)
    Non-dash input passes through unchanged.

    Single-char aliases (applied after dash stripping, before prefix matching):
      'x' → 'clear'  (clear's canonical `c` collides with completed; `x` is its
                      dedicated short option. Works as `-x`, `--x`, or bare `x`.)
    """
    if not raw.startswith("-"):
        sub = raw
    elif raw.startswith("---"):
        return None
    elif raw.startswith("--"):
        sub = raw[2:] or None
        if sub is None:
            return None
    else:
        # single dash: accept only if exactly one char follows
        rest = raw[1:]
        if len(rest) != 1:
            return None
        sub = rest
    # Single-char aliases for canonicals with no unique prefix
    ALIASES = {"x": "clear"}
    return ALIASES.get(sub, sub)


def main(argv):
    if len(argv) == 1:
        cmd_list()
        return
    if argv[1] in ("-h", "--help"):
        cmd_help()
        return
    sub = normalize_sub(argv[1])
    if not sub:  # catches None (malformed dash form) and empty string
        usage()
    rest = argv[2:]
    # Shorthand: any non-empty prefix of add/remove/completed/clear/uncheck/help/search.
    # Seven canonicals, six unique first letters: a/r/c/u/h/s (c is shared —
    # completed is checked before clear so `c` → completed;
    # `cl`+ reaches clear via prefix matching, and `-x` reaches it via alias).
    if "add".startswith(sub):
        if not rest:
            usage()
        cmd_add(rest)
    elif "remove".startswith(sub):
        if not rest:
            usage()
        cmd_rem(rest)
    elif "completed".startswith(sub):
        # Note: `c` matches here (completed is checked before clear), so `-c`
        # → completed. `cl`/`clear` routes to cmd_clear.
        if not rest:
            usage()
        cmd_completed(rest)
    elif "clear".startswith(sub):
        cmd_clear(rest)  # takes no args; bare `clear` wipes all done items
    elif "uncheck".startswith(sub):
        if not rest:
            usage()
        cmd_uncheck(rest)
    elif "help".startswith(sub):
        cmd_help()
    elif "search".startswith(sub):
        cmd_search(rest)
    else:
        usage()


# ── JSON mode: the task pane's contract (ctxbar spec 4.4, 4.7) ─────────────────
JSON_VERSION = 1
MAX_READ_BYTES = 3 * 1024 * 1024     # a bigger file is refused before it is parsed
MAX_OUTPUT_BYTES = 4 * 1024 * 1024 - 64 * 1024   # the pane reads at most 4 MiB of stdout
TOO_LARGE = f"That would make the task file too large to read back (over {MAX_READ_BYTES // 2**20} MiB) — nothing saved"


def _fits(path, lines):
    """A task has no length limit, but the file does: false when `lines`, written, would be past
    MAX_READ_BYTES, or the list past MAX_OUTPUT_BYTES as JSON — a file the pane could not read back."""
    if sum(len(line.encode("utf-8")) + 2 for line in lines) > MAX_READ_BYTES:   # + a CRLF at most
        return False
    return len(json.dumps(json_state(path, lines))) <= MAX_OUTPUT_BYTES


BREAKS = (   # line breaks that are not control characters: U+2028, U+2029 (written raw)
" ", " ")
EXIT = {"input": 1, "read": 2, "write": 2, "busy": 2, "conflict": 3, "internal": 4}
TITLE_MESSAGE = "A task needs some text, its first line not blank"


class Refused(Exception):
    """An edit or read that ends with {error, kind} on stdout."""
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


class _Args(argparse.ArgumentParser):
    def error(self, message):
        raise Refused("input", message)


def _nth(text):
    if not re.fullmatch(r"[1-9][0-9]{0,6}", text):
        raise argparse.ArgumentTypeError("nth must be a whole number from 1")
    return int(text)


def _text_ok(value):
    """The value trimmed of spaces when it is at least one code point on one line with no
    control character and encodes as UTF-8; else None."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return None
    value = value.strip(" ")
    if not value or any(c in BREAKS or unicodedata.category(c) == "Cc" for c in value):
        return None
    return value


def _check_title(value):
    """A title of one or more lines (joined by `\\n`): each line trimmed of spaces, blank ones
    dropped, the first not blank, each as `_text_ok` asks; no length limit (owner 4 Nov 2026)."""
    first, *rest = value.split("\n")
    kept = [_text_ok(first)] + [_text_ok(line) for line in rest if line.strip(" ")]
    if None in kept:
        raise Refused("input", TITLE_MESSAGE)
    return "\n".join(kept)


def _read_for_json(path):
    try:
        if os.path.exists(path) and os.path.getsize(path) > MAX_READ_BYTES:
            raise Refused("read", f"Can't read {display_path(path)}: larger than {MAX_READ_BYTES // 2**20} MiB")
        return read_text(path)
    except UnicodeDecodeError:
        raise Refused("read", f"Can't read {display_path(path)}: not UTF-8 text")
    except OSError as e:
        raise Refused("read", f"Can't read {display_path(e.filename or path)}: {e.strerror or e}")


def json_state(path, lines):
    """The pane's view of the file (spec 4.4)."""
    try:
        st = os.stat(path)
    except FileNotFoundError:
        st = None
    folders = []
    for f in parse(lines):
        seen = {}
        items = []
        for index, done, title in f.items:
            seen[title] = seen.get(title, 0) + 1
            block = "\n".join(lines[index:item_end(lines, index)])   # all its lines: a change below the first is seen
            key = f"{index}:{hashlib.sha1(block.encode('utf-8')).hexdigest()[:8]}"
            items.append({"key": key, "title": title, "done": done, "nth": seen[title]})
        folders.append({"name": f.name, "label": f.label, "pending": sum(not i["done"] for i in items),
                        "done": sum(i["done"] for i in items), "items": items})
    return {"version": JSON_VERSION, "path": path, "state": "list" if st else "nofile",
            "mtimeMs": st.st_mtime_ns / 1e6 if st else None, "size": st.st_size if st else None,
            "folders": folders}


def _folder(folders, label):
    """The one folder with this label; none when no folder, or more than one, has it."""
    hits = [f for f in folders if f.label == label]
    return hits[0] if len(hits) == 1 else None


def _target(folders, label, title, nth):
    """The line index of the nth item titled `title` in folder `label`, or a conflict."""
    f = _folder(folders, label)
    hits = [index for index, _, t in f.items if t == title] if f else []
    if nth > len(hits):
        raise Refused("conflict", "This task changed elsewhere — list refreshed")
    return hits[nth - 1]


def _ending(line):
    return line[len(line.rstrip("\r")):]


def _crlf(lines):
    """True when the file's lines end in CRLF (most of them, the last line aside)."""
    body = lines[:-1]
    return bool(body) and sum(line.endswith("\r") for line in body) * 2 > len(body)


def _insert_in(lines, ends, folder, bodies):
    """Append a task's lines at the end of a folder's section (after the top folder's last
    task in a file without headings), each ending like the line above them."""
    pos = item_end(lines, folder.items[-1][0]) if folder.heading is None else section_end(lines, folder.heading)
    if pos == len(lines):
        for body in bodies:
            append_line(lines, ends, body)
    else:
        lines[pos:pos] = [body + _ending(lines[pos - 1]) for body in bodies]


def _edit(op, args, lines, ends, path):
    """Apply one edit to lines, in place."""
    last = lines[-1] if lines else None
    folders = parse(lines)
    if op == "add":
        title = _check_title(args.values[0])
        if not folders:              # no file, or no task in it yet: `--folder` is not read
            for body in item_lines("- [ ] ", title):
                append_line(lines, ends, body)
            return
        folder = _folder(folders, args.folder)
        if folder is None:
            raise Refused("input", f"No folder '{args.folder}'")
        if folder.heading is None and has_headings(folders):
            raise Refused("input", "Add to a named folder")
        _insert_in(lines, ends, folder, item_lines("- [ ] ", title))
    elif op == "insert":
        # A new task next to another: `before` its line or `after` its whole block (file order).
        index = _target(folders, args.folder, args.values[0], args.nth)
        title = _check_title(args.values[1])
        pos = index if args.where == "before" else item_end(lines, index)
        if pos == len(lines):
            for body in item_lines("- [ ] ", title):
                append_line(lines, ends, body)
        else:
            # A CR like the line above's (the file's last line may lack one); at the top, the next line's.
            lines[pos:pos] = item_lines("- [ ] ", title, _ending(lines[pos - 1] if pos > 0 else lines[pos]))
    elif op in ("up", "down"):
        # One place earlier or later in file order, past blank and other lines, swapping with the
        # nearest task of the same state in the same folder (each task whole, its lines and their
        # endings with it); at the folder's edge nothing changes.
        index = _target(folders, args.folder, args.values[0], args.nth)
        items = _folder(folders, args.folder).items
        state = next(done for i, done, _ in items if i == index)
        mates = [i for i, done, _ in items if done == state]
        at = mates.index(index) + (-1 if op == "up" else 1)
        if 0 <= at < len(mates):
            first, second = sorted((index, mates[at]))
            first_end, second_end = item_end(lines, first), item_end(lines, second)
            crlf = _crlf(lines)
            was_last = second_end == len(lines)
            lines[first:second_end] = lines[second:second_end] + lines[first_end:second] + lines[first:first_end]
            if crlf and was_last:    # only the file's last line, moved up, takes the file's ending
                moved = first + (second_end - second) - 1
                lines[moved] = _bare(lines[moved]) + "\r"
                lines[-1] = _bare(lines[-1]) + (_ending(lines[-1]) if ends else "")
    elif op in ("tick", "untick", "rename", "delete"):
        index = _target(folders, args.folder, args.values[0], args.nth)
        end = item_end(lines, index)
        line = lines[index]
        if op in ("tick", "untick"):
            lines[index] = ("- [x] " if op == "tick" else "- [ ] ") + line[6:]
        elif op == "rename":
            ending = _ending(line) or ("\r" if _crlf(lines) and len(args.values[1].split("\n")) > 1 else "")
            new = item_lines(line[:6], _check_title(args.values[1]), ending)
            old = lines[index:end]
            for k in range(1, min(len(new), len(old))):     # a further line it keeps stays as written
                if _more(_bare(old[k])) == _more(_bare(new[k])):
                    new[k] = old[k]
            if end == len(lines) and not ends:              # the file's last line keeps no ending
                new[-1] = _bare(new[-1])
            # A further line the rename drops or changes is a removal: logged, as every removal is.
            log_deleted(path, [old[k] for k in range(1, len(old)) if k >= len(new) or new[k] is not old[k]])
            lines[index:end] = new
        else:
            block = lines[index:end]
            del lines[index:end]
            log_deleted(path, block)
    # A removed last line leaves no bare CR at the end; one the edit never touched keeps its bytes.
    # CPython shares one object for each one-character string, so a lone "\r" can't be told apart.
    if not ends and lines and (lines[-1] is not last or len(lines[-1]) == 1):
        lines[-1] = _bare(lines[-1])


def _parser():
    parser = _Args(prog="todo.py --json", add_help=False)
    subs = parser.add_subparsers(dest="op")
    for op, nvalues, has_nth in (
            ("add", 1, False), ("tick", 1, True), ("untick", 1, True), ("rename", 2, True),
            ("delete", 1, True), ("up", 1, True), ("down", 1, True)):
        sp = subs.add_parser(op, add_help=False)
        sp.add_argument("--folder", required=True)
        if has_nth:
            sp.add_argument("--nth", type=_nth, required=True)
        sp.add_argument("values", nargs=nvalues)
    insert = subs.add_parser("insert", add_help=False)    # a new task next to TITLE: -- TITLE NEW
    insert.add_argument("--folder", required=True)
    insert.add_argument("--nth", type=_nth, required=True)
    insert.add_argument("--where", choices=("before", "after"), required=True)
    insert.add_argument("values", nargs=2)
    undo = subs.add_parser("undo", add_help=False)    # the token the last save's JSON gave
    undo.add_argument("--token", required=True)
    return parser


def _precheck(opts):
    """The checks that need no file run before the lock, so bad input touches nothing."""
    if opts.op == "add":
        _check_title(opts.values[0])
    elif opts.op in ("rename", "insert"):
        _check_title(opts.values[1])


def _emit(obj, saved=False):
    """Print the answer; one too large for the pane is a small `read` error instead (the list
    left out), which says so when the edit it answers was saved, so it is not tried again."""
    out = json.dumps(obj)      # ASCII-escaped: a U+2028 in a title never splits the line
    if len(out) > MAX_OUTPUT_BYTES:
        error = f"{'Saved, but c' if saved else 'C'}an't read {display_path(obj['path'])}: the list is too large to show"
        print(json.dumps({"error": error, "kind": "read"}))
        sys.exit(EXIT["read"])
    print(out)


def _digest(path):
    """The sha1 of a file's bytes, or "none" when there is no such file."""
    try:
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except FileNotFoundError:
        return "none"


def undo_token(path):
    """What a save hands the pane for an undo: the digests of the file and of `.prev` as the
    save left them. The undo runs only while both are still so — nothing written since, by
    anyone, and `.prev` still this save's copy."""
    return f"{_digest(path)}:{_digest(path + '.prev')}"


def _undo(path, token):
    """Put back the file as it was before the last save (its `.prev`; no file at all when that
    save created it), only while the file and `.prev` are exactly as that save left them. Every
    line it takes away goes to `.deleted`, as any removal does."""
    try:
        with locked(path):
            if not os.path.exists(path) or undo_token(path) != token:
                raise Refused("conflict", "The task file changed since — nothing undone")
            now, _ = read_text(path)
            if token.endswith(":none"):          # that save created the file: undone, there is none
                log_deleted(path, [line for line in now if _bare(line).strip()])
                os.remove(os.path.realpath(path))    # a link's file goes, the link stays
                return json_state(path, [])
            lines, ends = read_text(path + ".prev")
            gone = collections.Counter(now) - collections.Counter(lines)   # lines the undo takes away
            removed = []
            for line in now:
                if gone[line] > 0:
                    gone[line] -= 1
                    if _bare(line).strip():
                        removed.append(line)
            log_deleted(path, removed)
            if path + ".prev" in _BOM:   # put back as it was, its BOM or none
                _BOM.add(path)
            else:
                _BOM.discard(path)
            write_text(path, lines, ends)
    except Busy:
        raise Refused("busy", "The task file is busy — try again")
    except UnicodeDecodeError:
        raise Refused("read", f"Can't read {display_path(path)}: not UTF-8 text")
    except OSError as e:
        raise Refused("write", f"Couldn't save: {e.strerror or e} ({display_path(e.filename or path)})")
    return json_state(path, lines)


def json_main(args):
    """`todo.py --json [sub …]`: one JSON object on stdout on every path."""
    state = None
    saved = False
    try:
        path = get_todo_path()
        opts = _parser().parse_args(args)
        if opts.op is None:
            lines, _ = _read_for_json(path)
            state = json_state(path, lines)
        elif opts.op == "undo":
            state = _undo(path, opts.token)
            saved = True
        else:
            _precheck(opts)
            try:
                with locked(path):
                    lines, ends = _read_for_json(path)
                    state = json_state(path, lines)
                    before = list(lines)
                    _edit(opts.op, opts, lines, ends, path)
                    token = None
                    if lines != before:          # no change: no write, so .prev keeps the last edit
                        if not _fits(path, lines) and _fits(path, before):   # one already past it can still shrink
                            raise Refused("input", TOO_LARGE)
                        try:
                            write_text(path, lines, ends)
                        except OSError as e:
                            raise Refused("write", f"Couldn't save: {e.strerror or e} ({display_path(e.filename or path)})")
                        saved = True
                        token = undo_token(path)  # only a save that wrote arms an undo
            except Busy:
                raise Refused("busy", "The task file is busy — try again")
            except OSError as e:     # the lock or the .deleted log
                raise Refused("write", f"Couldn't save: {e.strerror or e} ({display_path(e.filename or path)})")
            state = dict(json_state(path, lines), **({"undo": token} if token else {}))
        _emit(state, saved)
    except Refused as e:
        out = json.dumps(dict(state or {}, error=str(e), kind=e.kind))
        if len(out) > MAX_OUTPUT_BYTES:      # a list too large for the pane: the error alone
            out = json.dumps({"error": str(e), "kind": e.kind})
        print(out)
        sys.exit(EXIT[e.kind])
    except (Exception, KeyboardInterrupt) as e:   # the pane must always get JSON, a bug included
        print(json.dumps({"error": f"/todo failed: {e.__class__.__name__}: {e}", "kind": "internal"}))
        sys.exit(EXIT["internal"])


def run(argv):
    """main() with the file errors turned into the one ❌ line."""
    if argv[1:2] == ["--json"]:
        json_main(argv[2:])
        return
    try:
        main(argv)
    except Busy:
        fail("❌ The task file is busy — try again")
    except OSError as e:
        where = display_path(e.filename) if e.filename else "the todo file"
        fail(f"❌ Couldn't use {where}: {e.strerror or e}")
    except UnicodeDecodeError:
        fail("❌ The todo file is not UTF-8 text — nothing was changed")
    except UnicodeEncodeError:
        fail("❌ That text is not valid UTF-8 — nothing was changed")


if __name__ == "__main__":
    run(sys.argv)
