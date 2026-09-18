# ♟ Chess Website

A complete, static chess website — offline vs. computer, offline two-player, and real-time
online multiplayer. Built with plain HTML/CSS/JavaScript so it runs directly on GitHub Pages
with no build step, no server, and no `npm install`.

## What's inside

```
chess-website/
├── index.html      All screens (home, how-to-play, offline setup, online setup, game)
├── style.css        All styling, fully responsive
├── script.js        All game logic
└── README.md         This file
```

No `assets/` folder — pieces are drawn with Unicode chess characters, so there are no
image files that can go missing or fail to load.

## One important deviation from a typical spec: no Stockfish.js

This build uses a **custom, self-contained minimax chess AI** (built directly on chess.js)
instead of Stockfish.js.

Why: Stockfish.js needs a WebAssembly/Web Worker build hosted somewhere reliable, configured
with the correct threading flags, and it's one of the most common sources of "the computer
opponent doesn't work" bug reports in static chess sites, because a single wrong CDN path or
missing cross-origin header silently breaks it. Since the #1 requirement here is **working
functionality**, this build trades engine strength for reliability: the built-in AI needs
nothing external, can't fail to load, and is tuned per difficulty:

- **Easy** — mostly random legal moves, occasionally a sensible one. Beatable by beginners.
- **Medium** — 2-ply minimax with alpha-beta pruning and basic positional scoring.
- **Hard** — 3-ply minimax with alpha-beta pruning. Plays solidly, but is not master-strength.

If you'd like real Stockfish-level strength later, you can swap `getAIMove()` in `script.js`
for a call into a Stockfish Web Worker — the rest of the app (board, rules, clock, UI) doesn't
need to change.

## Chess rules

All rules — legal moves, check, checkmate, stalemate, castling (both sides), en passant,
promotion, draw by insufficient material, threefold repetition, and the fifty-move rule — are
handled by **chess.js** (loaded from cdnjs), a well-established, thoroughly tested rules
engine. The board never lets a player make a move that leaves their own king in check.

## Offline mode

Works completely with no internet connection once the page and its two CDN scripts
(chess.js, and Firebase only if you configure online play) have loaded once. Includes:

- Player vs. Computer (Easy / Medium / Hard)
- Player vs. Player (same device)
- Optional chess clock with standard presets (1+0 up to 15+10)
- Move history, flip board, sound toggle, resign, draw (agreed locally), undo
- Auto-saves an unfinished offline game to `localStorage` so refreshing the page doesn't
  lose your position — "Play Offline" will offer to resume it.

## Online multiplayer (optional — requires Firebase)

Uses **Firebase Realtime Database**, which is free for small projects and works from a static
site with no server of your own. If you don't configure it, Offline mode still works fully —
"Play Online" will simply show a friendly message telling you it isn't set up yet.

### Setting up Firebase (beginner-friendly, ~5 minutes)

1. **Create a Firebase project**
   Go to <https://console.firebase.google.com>, click **"Add project,"** give it any name,
   and finish the setup wizard (you can disable Google Analytics — it's not needed).

2. **Enable the Realtime Database**
   In your new project's left sidebar, click **Build → Realtime Database → Create Database**.
   Choose any region, and start in **test mode** for now (we'll lock it down with the rules
   below in step 5).

3. **Register a Web App to get your config**
   On the project's home page, click the **`</>`** (Web) icon to add a web app. Give it any
   nickname, skip "Firebase Hosting," and click **Register app**. Firebase will show you a
   code block containing a `firebaseConfig` object like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-default-rtdb.firebaseio.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456"
   };
   ```

4. **Paste it into `script.js`**
   Open `script.js` in this project and find the `firebaseConfig` object near the very top
   (clearly marked with a big comment block). Replace the placeholder `"PASTE_YOUR_..."`
   values with the real ones from step 3. Save the file.

5. **Set Realtime Database security rules**
   In the Firebase console, go to **Realtime Database → Rules** and paste:

   ```json
   {
     "rules": {
       "rooms": {
         "$roomCode": {
           ".read": true,
           ".write": true,
           ".validate": "newData.hasChildren(['fen', 'turn', 'status'])"
         }
       }
     }
   }
   ```

   **Limitation to know about:** this app has no user accounts, so these rules can't verify
   *which* player is writing — only that a write looks like a valid game update. That's an
   unavoidable trade-off of a purely static/client-side app with no backend server. It's fine
   for casual games with friends; it is **not** suitable for a competitive or money-based
   product without adding real authentication and server-side move validation (e.g. via
   Firebase Cloud Functions).

6. **No API keys are secret here.** Firebase's client config values (the ones you pasted) are
   meant to be public in frontend code — they identify your project, not authenticate it. Your
   Realtime Database rules above are what actually control access.

### How online play works

- **Create Game** generates a random 6-character room code, creates the room in Firebase, and
  shows you the code plus a "Copy Link" button.
- **Join Game**: the other player enters that code (or opens the copied link) and is placed as
  Black automatically.
- Every move is validated locally by chess.js before being written to Firebase, and the app
  refuses to let you move when it isn't your turn or move your opponent's pieces.
- Draw offers, resignations, and the chess clock all sync through the same database record.
- If a player refreshes their browser, the app automatically finds their room via
  `localStorage` and rejoins the game in progress.

## Deployment guide (step by step)

**Step 1 — Create a GitHub repository**
Go to <https://github.com/new>, name it something like `chess-website`, set it to Public, and
click **Create repository**.

**Step 2 — Upload the files**
On your new repository's page, click **"Add file" → "Upload files,"** then drag in
`index.html`, `style.css`, `script.js`, and `README.md` (keep them at the top level of the
repo, not inside a subfolder). Click **Commit changes**.

**Step 3 — Configure Firebase (only if you want online play)**
Follow the "Setting up Firebase" section above, then re-upload your edited `script.js` (or
edit it directly on GitHub using the pencil icon) so the real config values are live.

**Step 4 — Enable GitHub Pages**
Go to your repository's **Settings → Pages**. Under "Build and deployment," set **Source** to
**"Deploy from a branch,"** set the branch to **main** (or **master**) and the folder to
**`/ (root)`**, then click **Save**.

**Step 5 — Open your website**
GitHub will show a message like *"Your site is live at `https://USERNAME.github.io/chess-website/"`*.
It can take 1–2 minutes the first time. Open that link — your chess site is now live for
anyone to play.

## Notes on mobile & responsiveness

The layout was built and checked against 320px, 375px, 414px, 768px, 1024px, and 1440px
viewport widths. The board sizes itself to fit the smaller of the viewport's width or height so
it never overflows, controls stack cleanly on narrow screens, and all interaction is
tap-based (select a square, then tap a highlighted destination) rather than drag-based, since
that's the most reliable pattern for touchscreens.

## Known limitations (by design, given a static-only architecture)

- Online move validation happens on each client, not on a trusted server — see the security
  note in step 5 of the Firebase setup above.
- Undo is available in offline games only (as specified) — it's disabled in online play since
  it would need to be agreed by both players over the network, which adds real complexity for
  little benefit in casual games.
- The built-in AI is a lightweight minimax engine, not a professional-strength engine — see
  the Stockfish note above for why, and how to upgrade it later if you want to.
