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

   Then **ask once** whether new versions should install by themselves (Claude Code leaves auto-update off for
   marketplaces other than Anthropic's, and there is no command for it). This is the only question in the install.
   In their language, with two choices (in the Claude app, a question with the two buttons):

   > Install new versions of Game Studio automatically when they come out? (You can turn it off later in /plugin.)
   > Yes / No

   **Only if they say yes**, turn it on, with these rules: change only `autoUpdate` in the `game-studio` entry that
   the install just wrote, keep every other setting, and keep the file valid JSON. Same file as step 3. If they say
   no (or don't answer), change nothing and go on.

   ```sh
   node -e '
   const fs = require("fs"), path = require("path"), os = require("os");
   const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
   const s = JSON.parse(fs.readFileSync(file, "utf8"));
   const m = s.extraKnownMarketplaces && s.extraKnownMarketplaces["game-studio"];
   if (!m) throw new Error("no game-studio entry");
   if (m.autoUpdate !== true) { m.autoUpdate = true; fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n"); }
   console.log("auto-update on");
   '
   ```

   If it fails (no file, not valid JSON, no `game-studio` entry), don't fix anything: carry on. Say "New versions
   arrive by themselves" in §4 step 4 only when they said yes and this printed `auto-update on`. (Turning it off later: `/plugin` → Marketplaces →
   game-studio → Disable auto-update. Uninstalling removes the entry with it.)
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
   nothing else changed)." Use the path the command printed. Then ask the auto-update question from step 2 the same
   way, and only on yes run its command.

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

1. **Which game.** The person's own game always comes first, whatever its page is called (`neon-orb.html`,
   `game.html`, `dist/index.html`, one HTML file with all the code inside). You don't have to find it: STUDIO does.
   **GAME** is the current folder (absolute path), or the folder they named. Never copy, rename or move their game,
   and never make an `index.html` for it: the editor opens their file as it is, so what they change goes into their game.
2. **Start it.** It returns at once and the editor keeps running:

   ```sh
   node STUDIO GAME --detach                  # Terminal, Codex
   node STUDIO GAME --detach --no-open        # App
   ```

   Wait for the line `studio: ready <url> pid <n>`. Before it, `studio: entry <page> …` says which page it opened
   when the game isn't `index.html`; that is their game, opened as it is. If that line names other game pages and
   the person was clearly making one of those, run `node STUDIO GAME --stop`, then the start line again with
   `--entry <that page>`. Other lines:
   - `studio: build-first <page> …` (exit 5): the game runs from its build. Run its build (`npm install` if
     `node_modules` is missing, then `npm run build`) and the same start line again.
   - `studio: no-game …` (exit 4): there is no game here at all, so start from the sample. If GAME is empty (or
     holds only hidden files), run the start line again with `--starter 3d` (it copies the 3D sample game, Lantern
     Cove, into it). If GAME has other files, use the subfolder `GAME/game-studio-sample` with `--starter 3d`
     instead, so nothing of theirs is mixed with the sample (it is GAME from here on).
   - In Codex, `listen EPERM`: the sandbox blocks the local server. Ask for approval to run the same line outside
     the sandbox.
3. **Show it.** The URL in `studio: ready` is **the link**: the editor, on this computer only.
   - **Terminal, Codex:** it opened the person's browser by itself.
   - **App:** load `preview_start`, `tabs_context` and `tabs_select`. If a tab already shows this URL, don't open
     another. Otherwise call `preview_start` with the URL exactly as printed: the editor opens in the Browser pane
     next to the chat. Then call `tabs_context`: if it says the pane is hidden, call `tabs_select` with the editor's
     tab, and `tabs_context` again. If the pane is still hidden, the reply starts with the ⌘⇧B line (step 4). If
     `preview_start` fails, the browser is the way: "Open this link in your browser: <url>".
     If they find the pane narrow: the ↗ button at the top right of the editor ("Open large") opens the same editor
     in a large window; asking you and Save work there the same way.
4. **Tell them, in three short lines** (in the language they wrote to you in; pick the words for your row). The
   game's name is its page's `<title>` (else the file name), the link is the URL from `studio: ready`, as printed:

   > Game Studio is installed. NEON ORB is open in the editor next to this chat. Link (this computer only, don't share it): <url>
   > Click anything and drag it to move it, type a change in the box at the bottom, and click Save when you like it.
   > Next time, start a new session and type `/arrange`. New versions arrive by themselves. *(Codex: `$arrange`)*

   - "New versions arrive by themselves" only when they said yes and auto-update was turned on (App and Terminal);
     never in Codex.
   - Terminal, Codex: "…NEON ORB is open in the editor in your browser. Link (…): <url>".
   - App, pane still hidden: start the first line with "Press ⌘⇧B to see it (Ctrl+Shift+B on Windows)." right after
     "Game Studio is installed."
   - The sample (`--starter 3d`): "Here's a sample game in your folder, open in the editor …" in the first line.
   - You changed the settings file (§3, no `claude` command): its one line goes first.

   Say nothing else: not which file names the editor looks for, not why a page was picked, not the watch (step 5),
   the log, the self-check, the plugin's version or the folder's path. Never call their game a sample, and never
   offer the sample when their game is open.

5. **Right after that message, start the watch** (App and Terminal; not Codex), without saying so: run
   `node STUDIO GAME --watch` (the same GAME, and the same `--entry` if you used one) with the Monitor tool (the command itself, not `tail -f` on a log)
   and `timeout_ms: 1800000` (30 minutes, the longest). It prints one `studio:` line for each save or request the
   person sends, and while it runs the editor tells them you have it. (Between watches, the plugin's hooks wake you
   when a request comes: SKILL.md §3, "Woken by the editor". Never tell the person to type a command for it.) It ends
   on its own after 29 minutes (`studio: watch rest …`) or when Monitor expires: **start it again at once and say
   nothing about it** — not "watching again", not "no requests yet". Speak only for a request or a failure.
6. **For the rest of this session**, read `PLUGIN/skills/arrange/SKILL.md` and follow it from §3: it is what
   `/arrange` does (their saves and requests arrive in `.studio/requests/`; the watch or the plugin's hooks bring
   them to you; in Codex the editor's **Call your AI** button copies *look* for them to paste, and you read them).
   Whenever you tell them about the editor again (it is open, where it is, how to get back to it), give the link
   again in the same short form. When they are finished: `node STUDIO GAME --stop`.

## 5. If something fails

Say what happened in one line, then give the line that does the same thing in a terminal. Don't try other ways
around a blocked step.

| What failed | Say |
|---|---|
| `claude plugin install` (no Git) | "Installing needs Git. Install it from https://git-scm.com, then paste the same line again." |
| `claude plugin install` (anything else) or the settings file | "Couldn't install Game Studio: <reason>. In a terminal, run: `claude plugin install game-studio --marketplace kumodeck/game-studio`" |
| Codex install | "Couldn't install Game Studio: <reason>. In a terminal, run: `codex plugin marketplace add kumodeck/game-studio && codex plugin add game-studio@game-studio`" |
| The editor didn't start | The `studio:` line or the error as printed, then: "Game Studio is installed. Start a new session and type `/arrange` to try again." |
