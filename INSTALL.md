# Install KUMODeck Game Studio

**For people:** you don't need to read this page. Paste this one line into Claude Code (in the Claude app or a
terminal) or Codex:

```
Install KUMODeck Game Studio for me by following https://github.com/kumodeck/game-studio/blob/main/INSTALL.md
```

Your AI installs Game Studio and opens the editor. Next time, start a new session and type `/arrange`
(Codex: `$arrange`).

---

**For the AI agent reading this:** the person asked you to install Game Studio and open it. Do the steps below in
order, without asking them anything unless a step says so. Keep them posted in short plain lines (VOICE: name the
thing, say what happened, then what to do). Don't print tokens or file contents you don't need to. The editor's URL
(with its passcode) is the one exception: give it as printed when a step says so.

## 1. Where are you running?

Look once, then pick one row. You will use it in every step.

| You are | How you can tell | Row |
|---|---|---|
| Claude Code in the **Claude app** (desktop, Code tab, local session) | You have the tool `mcp__Claude_Browser__preview_start` (it may be listed as a deferred tool) | **App** |
| Claude Code in a **terminal** or an IDE | You are Claude Code and don't have that tool | **Terminal** |
| **Codex** (CLI, app or IDE) | You are Codex | **Codex** |
| A **cloud** session (claude.ai/code, a cloud session in the app, Codex cloud) | You run on a remote machine, not on the person's computer | Stop: say "Game Studio runs on your computer, and plugins don't load in cloud sessions. Open a local session and paste the same line again." |

Only `mcp__Claude_Browser__*` counts for **App**. `mcp__remote-devices__Claude_Browser__*` means you run somewhere
else: that is a cloud session.

## 2. Check Node.js

Run `node --version`. Game Studio needs **22.13 or newer**. If `node` is missing or older, stop here (nothing has
been changed yet) and say one line:

> Game Studio needs Node.js 22.13 or later (you have 20.11.0). Get the latest LTS at https://nodejs.org, then paste the same line again.

(Without Node: "Game Studio needs Node.js 22.13 or later, and it isn't installed. …")

## 3. Install

### App and Terminal

1. Find the `claude` command: `claude --version`. If that fails and the environment variable `CLAUDE_CODE_EXECPATH`
   names a file you can run, use that file as `claude` (it is the Claude Code running this session).
2. If you have a `claude` command, install with it. It adds the plugin for this person (user scope) and needs Git
   and the network:

   ```sh
   claude plugin install game-studio --marketplace kumodeck/game-studio
   ```

   "Already installed" is fine. Then find where it went (this prints the folder; it is **PLUGIN** below):

   ```sh
   claude plugin list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(p=>p.id==="game-studio@game-studio").installPath))'
   ```
3. **No `claude` command at all** (most often in the Claude app, but it can happen in any row): add Game Studio to the person's Claude Code
   settings yourself. They asked for it, so you may, with these rules: change only these two keys, keep every other
   setting, and keep the file valid JSON. The file is `$CLAUDE_CONFIG_DIR/settings.json`, or
   `~/.claude/settings.json` when that variable isn't set. This does it (it creates the file if needed):

   ```sh
   node -e '
   const fs = require("fs"), path = require("path"), os = require("os");
   const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
   const file = path.join(dir, "settings.json");
   const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
   s.extraKnownMarketplaces = { ...s.extraKnownMarketplaces, "game-studio": { source: { source: "github", repo: "kumodeck/game-studio" } } };
   s.enabledPlugins = { ...s.enabledPlugins, "game-studio@game-studio": true };
   fs.mkdirSync(dir, { recursive: true });
   fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
   console.log(file);
   '
   ```

   If the file exists but isn't valid JSON, the command stops without writing: don't fix the file yourself, give the
   terminal line from §5. Remember to tell the person in one line what changed (it goes first in §4 step 4):
   "Added Game Studio to your Claude Code settings (`~/.claude/settings.json`: one marketplace, one plugin turned on;
   nothing else changed)." Use the path the command printed.

   Claude Code downloads the plugin when the next session starts, so to open the editor now, fetch a copy into a
   temporary folder (Git first, or the archive when Git is missing) and use that folder as **PLUGIN**:

   ```sh
   git clone --depth 1 https://github.com/kumodeck/game-studio.git "$(node -p 'require("os").tmpdir()')/kumodeck-game-studio"
   # without Git:
   mkdir -p "$(node -p 'require("os").tmpdir()')/kumodeck-game-studio" && curl -fsSL https://codeload.github.com/kumodeck/game-studio/tar.gz/refs/heads/main | tar -xz --strip-components 1 -C "$(node -p 'require("os").tmpdir()')/kumodeck-game-studio"
   ```

   If the folder is already there from an earlier try, use it as it is.

### Codex

```sh
codex plugin marketplace add kumodeck/game-studio && codex plugin add game-studio@game-studio
```

"Already added" is fine. The last line says `Installed plugin root: <folder>`: that folder is **PLUGIN**. Both
commands need the network and write to `$CODEX_HOME` (`~/.codex`); if your sandbox blocks them, ask for approval to
run them, or give the terminal line from §5.

## 4. Open the editor now

The plugin's skill only loads in a new session, so this time you start the editor yourself. **STUDIO** is
`PLUGIN/skills/arrange/bin/studio.mjs`. Always pass absolute paths.

1. **Which folder.** Look in the current folder and its subfolders (not `node_modules`) for a game's `index.html`.
   - One game: use its folder.
   - Several: ask once which one.
   - None, and the folder is empty (or holds only hidden files): use the folder itself with `--starter 3d` (it
     copies the 3D sample game, Lantern Cove, into it).
   - None, but the folder has other files: make the subfolder `game-studio-sample` and use it with `--starter 3d`,
     so nothing of theirs is mixed with the sample.
2. **Start it.** It returns at once and the editor keeps running:

   ```sh
   node STUDIO /absolute/game/folder --detach                  # Terminal, Codex
   node STUDIO /absolute/game/folder --detach --no-open        # App
   ```

   Add `--starter 3d` when step 1 says so. Wait for the line `studio: ready <url> pid <n>`. In Codex, if it fails
   with `listen EPERM`, the sandbox blocks the local server: ask for approval to run the same line outside the
   sandbox.
3. **Show it.**
   - **Terminal, Codex:** it opened the person's browser by itself. Give them the URL exactly as printed.
   - **App:** load `preview_start` and `tabs_context`. If a tab already shows this URL, don't open another. Otherwise
     call `preview_start` with the URL exactly as printed: the editor opens next to the chat. If the pane is hidden,
     add "Press ⌘⇧B to show it (Ctrl+Shift+B on Windows)." If `preview_start` fails, give the URL instead: "Open
     this link in your browser: <url>".
4. **Tell them, in three short lines** (in the language they wrote to you in; pick the words for your row):

   > Game Studio is installed. The editor is open next to this chat. *(Terminal, Codex: "…open in your browser: <url>")*
   > Click anything and drag it to move it, type a change in the box at the bottom, and click Save when you like it.
   > Next time, start a new session and type `/arrange`. *(Codex: `$arrange`)*

   If you used `--starter 3d`, start the second line with "Here's a sample game in your folder." If you changed the
   settings file (§3, no `claude` command), put its one line first. Say nothing else: not the watch (step 5), the
   log, the self-check, the plugin's version or the folder's path.

5. **Right after that message, start the watch** (App and Terminal; not Codex), without saying so: run
   `node STUDIO /absolute/game/folder --watch` with the Monitor tool (the command itself, not `tail -f` on a log).
   It prints one `studio:` line for each save or request the person sends, and while it runs the editor tells them
   you have it. Without it, the first thing they type in the editor answers "Your AI isn't watching", which is how
   the dogfood of 2026-10-17 met every new person. Start it again whenever it ends.
6. **For the rest of this session**, read `PLUGIN/skills/arrange/SKILL.md` and follow it from §3: it is what
   `/arrange` does (their saves and requests arrive in `.studio/requests/`; in Codex, or when no watch runs, they
   type "look" and you read them). When they are finished: `node STUDIO /absolute/game/folder --stop`.

## 5. If something fails

Say what happened in one line, then give the line that does the same thing in a terminal. Don't try other ways
around a blocked step.

| What failed | Say |
|---|---|
| `claude plugin install` (no Git) | "Installing needs Git. Install it from https://git-scm.com, then paste the same line again." |
| `claude plugin install` (anything else) or the settings file | "Couldn't install Game Studio: <reason>. In a terminal, run: `claude plugin install game-studio --marketplace kumodeck/game-studio`" |
| Codex install | "Couldn't install Game Studio: <reason>. In a terminal, run: `codex plugin marketplace add kumodeck/game-studio && codex plugin add game-studio@game-studio`" |
| The editor didn't start | The `studio:` line or the error as printed, then: "Game Studio is installed. Start a new session and type `/arrange` to try again." |
