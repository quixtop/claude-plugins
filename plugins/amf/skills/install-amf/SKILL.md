---
name: install-amf
description: Installs, starts and opens AMF — the Agent Management Framework for Claude Code agents — on this Mac, in one step. Use when the user says "install AMF", "set up AMF", "start AMF", "open AMF", "open the AMF board" or "run AMF".
---

# install-amf — AMF on this Mac, one step

AMF is the Agent Management Framework: a board for Claude Code agents that runs on your own
Mac. This skill gets it running and opens its board. Every step is safe to repeat — an installed AMF
is never reinstalled, and a running one is never restarted.

## Where the commands run

- **Claude Code Desktop with a Terminal panel:** run each command there, so the user watches
  Homebrew work, and read the output from the panel.
- **Otherwise:** the Bash tool. The user approves each command.
- Homebrew needs the network and writes outside the project. If a sandboxed command is refused, say
  so in one line and run it in the Terminal panel — or hand the user the exact command.

## Steps

1. **macOS only.** `uname -s` must print `Darwin`; otherwise stop: "AMF runs on macOS."
2. **Installed?** `command -v amf`. If it prints a path, go to step 4.
3. **Not installed:**
   1. `command -v brew` — missing → stop: "AMF installs with Homebrew — get it at https://brew.sh,
      then say install AMF again."
   2. `brew info quixtop/quixtop/amf` — if it fails, stop: "AMF isn't published yet — watch
      https://amf.quixtop.com." Never try another route.
   3. Run this ONE line, exactly as written. It installs AMF, sets up the launcher that starts it,
      and starts it:

      ```
      brew tap quixtop/quixtop; brew trust quixtop/quixtop; brew install amf; amf launcher install; amf up
      ```

      Then go to step 5.
4. **Start it:** `amf up` — this starts AMF only if it is not already running.
5. **Find the board.** AMF listens on 8421, or on the first free port of 8422–8428 when something
   else holds 8421. The board is on the first of those ports whose `/api/launcher` answers as AMF:

   ```
   for p in 8421 8422 8423 8424 8425 8426 8427 8428; do curl -fsS --max-time 1 "http://127.0.0.1:$p/api/launcher" | grep -Eq '"app" *: *"AMF"' && { echo "$p"; break; }; done
   ```

   Nothing yet? AMF may still be starting — try again every few seconds for about 15 seconds.
   Still nothing: tell the user to run `amf up` in Terminal and read what it prints.
6. **Open it.** In Claude Code Desktop, open `http://localhost:<port>/` in Claude's own browser. In
   the CLI, print that URL for the user to open.
7. **Report in one line:** "AMF is running — its board is at http://localhost:<port>/".

## Never

- Never write to the clipboard, and never pipe a downloaded script into a shell — Homebrew only.
- Never uninstall, reinstall or upgrade AMF unless the user asks for exactly that.
- Never stop or restart a running AMF: `amf up` leaves it be.
