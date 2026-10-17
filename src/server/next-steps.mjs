// "Next step" hand-offs (the menu in the editor that points at KUMODeck).
//
// What happens when the user picks one: the local server writes the instructions below to
// .studio/next-step.md and prints one line ("studio: next-step <id> .studio/next-step.md").
// Nothing else. The server never contacts KUMODeck, never uploads, never edits code. The user's AI
// agent notices the line, reads the file, and asks the user before doing anything (the skill says
// so). That keeps the local tool fully usable without an account, and makes every action that
// touches an account or money an explicit, agent-mediated choice by the user.
//
// The wording is a first draft; the plugin's skill owns the final text. Prices are never written
// here (they change); the text points at the pricing page, whose URL lives in one constant.

export const KUMODECK_URL = 'https://kumodeck.com';
export const KUMODECK_PRICING_URL = `${KUMODECK_URL}/pricing/`;

const CONNECT = `## Connect KUMODeck (only if the user agrees)

KUMODeck needs an account and works on prepaid credit: you pay what the services cost, with no fee
on top. Pricing: ${KUMODECK_PRICING_URL}

Pick one way to connect:
- Claude Code: \`/plugin install kumodeck@kumodeck\`
- Codex: \`codex plugin add kumodeck@kumodeck\`
- Any agent with a terminal: \`npx kumodeck login\`

After connecting, follow the KUMODeck skills that come with that plugin.`;

const STEPS = {
  publish: {
    title: 'Publish to KUMODeck',
    body: `The user asked to put this game online as a private test version on KUMODeck.

1. Ask the user to confirm: "Publish this game to KUMODeck as a test version? It needs a KUMODeck
   account." Do nothing if they say no.
2. If KUMODeck is not connected yet, see "Connect KUMODeck" below.
3. Use the KUMODeck deploy skill (or \`npx kumodeck deploy\`) on this game folder. A test version gets
   its own URL that only the user can open until they publish it.`,
  },
  multiplayer: {
    title: 'Add online multiplayer',
    body: `The user asked to add online multiplayer (rooms, quick match, invite links and QR codes).

1. Ask the user to confirm before changing any code, and which kind of multiplayer they want.
2. If KUMODeck is not connected yet, see "Connect KUMODeck" below.
3. Follow the KUMODeck multiplayer skill.`,
  },
  'save-data': {
    title: 'Add save data or a leaderboard',
    body: `The user asked to add save data (progress stored per player) or a leaderboard.

1. Ask the user to confirm before changing any code.
2. If KUMODeck is not connected yet, see "Connect KUMODeck" below.
3. Follow the KUMODeck user-data skill for saves, or the functions-d1 and leaderboard skills for a
   leaderboard on the user's own Functions and database.`,
  },
  'ai-assets': {
    title: 'Make 3D models or images with AI',
    body: `The user asked to create new 3D models or images with AI.

1. Ask the user what they want to make and confirm before spending credit.
2. If KUMODeck is not connected yet, see "Connect KUMODeck" below. The 3D tools (model3d_create,
   blender_run) are available through the KUMODeck Preview connector.
3. Save the results into this folder's assets/ so they show up in the library.`,
  },
};

// Not a KUMODeck step: the Library's "Delete" on files marked unused. Handed over the same way
// (one stdout line + .studio/next-step.md) because the editor never deletes files itself: the
// agent confirms with the creator first. No "Connect KUMODeck" part.
function deleteFilesMarkdown(files, now) {
  const list = files.map((f) => `- \`${f}\``).join('\n');
  return `# Next step: Delete unused files

Written by the game studio at ${now.toISOString()} because the user pressed "Delete" on these files in the
editor's Library, where they were marked unused (in the folder, but not named in the code and not
loaded while the game ran). The studio itself deleted nothing.

${list}

1. Ask the user to confirm before deleting anything, listing the files above ("Delete these N
   files from the game folder?"). Do nothing if they say no; delete only the ones they agree to.
2. Before deleting each file, search the code once more for its name (also without the folder and
   the extension: games often build paths like \`'assets/' + name + '.png'\`). If something still
   uses it, keep the file and tell the user why.
3. Delete the files (move them to the trash if the system has one), then tell the user which ones
   are gone. The Library lists the folder again the next time it opens.
`;
}

export const NEXT_STEP_IDS = Object.freeze([...Object.keys(STEPS), 'delete-files']);

/**
 * Markdown for .studio/next-step.md, or null for an unknown id.
 * `detail.files` (delete-files only): the checked list of files.
 */
export function nextStepMarkdown(id, now = new Date(), detail = {}) {
  if (id === 'delete-files') return Array.isArray(detail.files) && detail.files.length ? deleteFilesMarkdown(detail.files, now) : null;
  const s = Object.hasOwn(STEPS, id) ? STEPS[id] : null;
  if (!s) return null;
  return `# Next step: ${s.title}

Written by the game studio at ${now.toISOString()} because the user picked this in the editor.
The studio itself did nothing else: no upload, no code change, no network access.

${s.body}

${CONNECT}
`;
}
