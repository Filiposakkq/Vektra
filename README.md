# Vektra

Vektra is an independent browser extension that provides Stockfish move
suggestions, optional live move ratings, and full-game analysis on supported
Chess.com game and analysis pages. Optional autoplay is off by default.

Hints, live move ratings and autoplay work only in games against Chess.com's
bots. Games against people stay untouched while they are in progress and open
for analysis only once they have finished (see [Where Vektra runs](#where-vektra-runs)).

> [!IMPORTANT]
> **Use Vektra responsibly.** Engine assistance and automated move input may be
> restricted by Chess.com, tournament organizers, or other applicable rules.
> Check the rules that apply to you before using
> these features. You are responsible for your use of the extension, moves
> submitted through autoplay, and any resulting account or game consequences.
> Autoplay can make a move you did not intend; keep it off unless you are
> actively supervising it.

Vektra is not affiliated with, endorsed by, or sponsored by Chess.com. Move
ratings, accuracy, win chances, Elo presets, and engine evaluations are
estimates for guidance and study; they are not official Chess.com ratings,
guarantees of playing strength, or a substitute for your own review.

## Contents

- [Install and development](#install-load-unpacked)
- [Updates](#updates)
- [Important notices](#important-notices)
- [Settings](#settings)
- [Project layout](#layout)
- [Where Vektra runs](#where-vektra-runs)
- [Position detection](#how-the-position-is-read)
- [Game analysis](#game-analysis)
- [Engine](#engine)
- [Chess.com selectors](#updating-selectors)
- [Known limitations](#known-limitations)
- [Third-party licenses](#third-party-licenses)

## Install (load unpacked)

To use a released version, download `vektra-<version>.zip` from the
[releases page](https://github.com/Filiposakkq/Vektra/releases), unzip it into
a folder you will keep, and load that folder as in step 3. To build it
yourself:

1. `npm ci` (or `npm install` if you are changing dependencies)
2. `npm run build`
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and choose the `dist` folder.
4. Open a supported Chess.com game, review, or analysis page. Click the Vektra
   toolbar icon to open settings. In games, the board can show up to three
   normal engine arrows (blue for the best move, then saffron and slate), an
   evaluation bar, and controls for autoplay and weaker alternatives. With
   autoplay off, an eligible weaker alternative is shown as a dim violet second
   arrow while the best move stays visible. If autoplay selects that
   alternative, it is shown in violet. Hints in bot games appear only on the bottom-side player's turn.
   When live ratings are enabled, your moves receive estimated classifications;
   hover a badge for details.

For development, `npm run dev` rebuilds on save. `npm test` runs the unit tests
(including Stockfish integration tests under Node), `npm run typecheck` checks
types, and `npm run e2e` (after `npm run build`) loads the built extension in
Chromium against captured Chess.com markup. `npm run calibrate:strength` checks
the Elo settings on fixed tactical positions; it is not a real-world rating
test. The browser checks can also be run individually with `npm run e2e:board`,
`npm run e2e:games`, `npm run e2e:analysis`, and `npm run e2e:settings`.
Each production build records a fingerprint of its sources in
`dist/vektra-build.json`; the browser checks stop with a list of changed files
if `dist` is missing that file or was built from different sources (including
`npm run dev` output), so run `npm run build` again first.

## Updates

Chrome doesn't update an extension loaded unpacked on its own, so Vektra
checks its [GitHub releases](https://github.com/Filiposakkq/Vektra/releases)
itself: when Chrome starts and when the settings open, at most every six
hours. The check sends nothing about you; it is a plain request for the latest
release. Turn it off under **Updates** at the bottom of the settings.

- **One click (Windows):** run `updater\install-updater.bat` in your Vektra
  folder once. It registers a small helper with Chrome, Brave, Edge and
  Chromium for your Windows user (no admin rights). Vektra can then install a new version itself: with
  **Update automatically** on (the default) it does so as soon as it finds one;
  otherwise the settings show **Update now**. The helper downloads the release
  zip, checks its SHA-256 checksum, and copies it over the folder. Vektra then
  reloads itself, waiting until no bot game is in progress; open Chess.com tabs
  ask to be reloaded afterwards. Run `install-updater.bat -Uninstall` to remove
  the helper, and run the installer again if you move the folder. The helper
  logs to `updater\update.log`.
- **By hand:** without the helper, the settings show a **Download** link when a
  new version is out. Unzip it over your Vektra folder (the same folder, so
  nothing is lost); Vektra notices the new files and reloads itself.

Vektra has a fixed extension ID (`omhnocnlghbmiboddipdodbdikbgdabb`, from the
`key` in `manifest.config.ts`), so its settings don't depend on the folder it
is loaded from, and the helper accepts requests from that extension only.

To publish a version: `npm version minor` (or `patch`), then
`git push --follow-tags` on `bot-only`. The release workflow
(`.github/workflows/release.yml`) checks that the tag matches `package.json`
and is on `bot-only`, runs every check, and attaches the zip and its checksum
to a GitHub release.

## Important notices

- **Bot games only:** engine suggestions, live ratings and autoplay run only
  in games against Chess.com's bots. Autoplay submits moves through the board's
  input handlers. The rules for engine assistance and automation vary by platform,
  event, and context; verify that your use is permitted. Vektra does not
  determine whether a particular game allows assistance.
- **Review every move:** Stockfish strength settings are approximate, searches
  have configurable limits, and engine evaluations can change with depth or
  position reconstruction. Autoplay checks legality and turn/position state,
  but it cannot guarantee a good move or protect against every site UI change.
  Autoplay is off by default; supervise it and turn it off if behavior is
  unexpected. Promotions use Chess.com's promotion picker (see Autoplay below).
- **No official ratings:** Move labels, accuracy, win chances, opening names,
  and Elo values are Vektra estimates. They can differ from Chess.com's Game
  Review and are not official ratings or guaranteed results.
- **Privacy and storage:** Vektra analyzes the board and move list locally in
  the extension. Settings are saved using Chrome Sync storage; analysis results
  and the optional full engine are stored in the browser's local extension
  storage/cache. The extension does not define a Vektra analytics or gameplay
  upload service. If you request the full engine, its WASM file is downloaded
  from the stockfish.js GitHub release after the browser requests optional
  download permissions. Exported JSON includes the current page URL and game
  moves/evaluations; review it before sharing.
- **Compatibility and warranty:** Vektra is designed for supported Chess.com
  pages in Chrome/Chromium-based browsers. Chess.com can change its page
  structure without notice, which may break detection or controls. The
  extension is provided as-is, without a guarantee of uninterrupted operation
  or suitability for a particular purpose.

## Settings

Click the Vektra icon in the toolbar (pin it from the puzzle-piece menu) to
open settings in a content-sized window over Chess.com. Drag its title bar to
move it and use the close button to dismiss it. On other sites the icon is
greyed out and opens nothing. Settings are saved in `chrome.storage.sync`
and apply to open tabs straight away. Settings have three tabs: **Hints**
(presets and bot-game controls), **Engine** (engine choice, strength and search
limits) and **Analysis** (full-game analysis depth). Less-used engine and timing
options are grouped under clearly labeled expandable sections.

- **Engine strength**: Stockfish Skill Level 0-20, or an approximate Elo
  target (1320-3190) via `UCI_LimitStrength`. Elo is not a rating guarantee;
  strength presets provide quick starting points. Strength does not change the
  configured search depth or time. With reduced strength, a provisional line
  appears while the engine searches, then updates to its final choice. Enable
  **Hints → Move suggestions → Show additional candidate moves** to show the
  best engine lines at full or reduced strength, including alongside a weaker
  selection.
- **Occasional alternatives**: optionally choose a legal move from the engine's
  other lines. Configure it under **Hints → Move suggestions**: the default
  chance is 50% per eligible turn, and **How much weaker** defaults to 2.00
  pawns. A weaker move aims to give up between half of that and all of it, so
  a higher setting gives clearly worse moves; when no move is that much worse,
  the closest one within the limit is used. Candidates come from a quick,
  wide search (ten lines, up to depth 10 or 0.4 s) that runs before the main
  one and draws the first arrows, the violet one included, within moments;
  the main search then refines the normal arrows. Autoplay waits for both.
  Positions without a suitable legal alternative keep the engine's first
  choice. With autoplay off, the engine's
  best move stays first and an eligible weaker alternative is always shown as
  the second, dim violet arrow; the chance setting does not hide this preview.
  With autoplay on, the chance setting controls whether the weaker alternative
  is played automatically. The board control and settings toggle stay synchronized.
- **Search**: fixed depth (1-30) or a time per move.
- **Board display**: move arrows use consistent colours, alongside the
  evaluation bar. Each arrow shows its score (White's point of view) at its
  target square; turn this off with **Show scores on arrows**. Alternatives
  get fainter the more win chance they give up against the best move, and
  ones that give up more than the **Hide alternatives** limit (10 points by
  default) are not drawn (unless **Show
  additional candidate moves** is on). Arrows stay dim until the search
  finishes, and the eval bar shows the search depth (for example `d14`).
- **Board look**: arrows are solid once the engine has finished and dashed
  while it is still searching. Both squares of the best move get an even tint
  in the arrow's colour, drawn under the pieces like Chess.com's own
  highlights; the target a little stronger. While the engine searches, the shown best
  move only changes when a new one leads two updates in a row or is more
  than 0.3 pawns better, so the arrows don't flicker between close moves;
  the final result is always shown as it is. A suggested promotion shows the piece's
  letter (Q, R, B, N) in the corner of the target square. The eval bar's
  score rides on the edge between White's and Black's share, in the colours
  of the side ahead. Move badges are rounded tiles in the usual category
  colours, with drawn glyphs that stay sharp at move-list size. The board
  control shows only its switches until you point at it.
- **Speed**: the engine never asks for more lines than there are legal
  moves, so arrows show while it searches even in check. Finished searches
  are kept for the last 300 requests, so stepping back to a position shows
  its arrows at once. The weaker-move and threat passes run on two extra
  engine workers alongside the main search, so they never hold it up. While
  the bot thinks, Vektra searches the positions after its two most likely
  replies, each on its own worker; when the bot plays it, the arrows appear
  right away. Hint searches use 64 MB of engine memory, so each search can
  reuse more of the last. Arrows that don't change stay put, and changed
  ones fade rather than blink (no fading with reduced motion).
- **Analysed positions**: the engine's line is drawn as numbered steps in one
  colour (1 = the move now, 2 = the reply, 3 = the next move), not as
  alternatives.
- **Hints in bot games**: show recommendations immediately (default) or only
  when you press the "show hint" shortcut. With **Show the piece first** (on by
  default), the first press highlights only the piece to move and the second
  shows the move; with autoplay on, one press shows the move. Analysis and
  review pages always show hints immediately.
- **Bot threats**: on your turn, a red arrow shows what the bot would play if
  you passed, when allowing it would cost at least the chosen amount of win
  chance (12 points by default).
  It comes from a quick search (up to depth 10 or 0.3 s) next to the main one,
  so it shows within moments. Turn it off with **Show the bot's threats**.
  When it would run along the same line as a move arrow, it is drawn a
  little to the side so neither hides the other.
- **Draws**: every search gets the game's moves since the last capture or
  pawn move, so the engine knows the repetitions so far and counts a third
  repetition as a draw. With **Avoid draws** (on by default), when the best
  move would draw at once (repetition, stalemate, the 50-move rule or too
  little material), Vektra shows and plays the best other move instead, as
  long as it gives up at most a pawn and leaves you no worse than about
  level; a weaker move that would draw isn't played either.
- **Light mode**: Vektra normally runs three engine workers (the main search,
  weaker moves and threats side by side). **Light mode** in the Engine tab uses
  one, saving about 150 MB, at the cost of the extra searches waiting their
  turn and thinking ahead about only one bot reply.
- **Engine connection**: if the connection to the engine drops while a search
  is waiting (the engine page restarted or its worker crashed), Vektra
  reconnects once and sends the search again before reporting an error.
- **Autoplay**: off by default and available only in games against bots. The
  board control in the top-left corner has Autoplay and Weaker moves switches
  and a Details section with the chosen move, engine think time and the
  delay before it is played, which stay until the next pick, plus your last
  six picks with their think times and delays. If the hints for a position
  are worked out again before autoplay moves, it plays the newest choice,
  the one on the board. It stays faint over the board until
  you point at it, open Details, or turn autoplay on. Set minimum and maximum
  delays in the popup; Vektra picks a delay in that range after choosing a move. The
  existing Skill Level/Elo controls determine move strength. Vektra checks the
  turn and position, submits at most one move per position, stops after the
  game ends. For a promotion it moves the pawn, then clicks the engine's piece
  in Chess.com's promotion picker; if the picker does not appear (for example
  with Chess.com's "always promote to queen" setting), Chess.com promotes to a
  queen and Vektra logs a warning when it wanted another piece. A **Stop
  autoplay** button is available in the floating settings window.
- **Quick setups**: Study (three candidate moves at depth 18), Coach (one move
  at an approximate 1500 Elo), Fast (one move with a 500 ms search), or On
  demand (show moves only when you press the shortcut). These are starting
  points; every setting remains adjustable.
- **Engine**: the bundled single-threaded Stockfish 19 lite build (about
  1.8 MB), or Stockfish 19.0.1 full (about 99 MB). The full WASM is downloaded
  only when requested. Vektra asks for optional host permission, checks the
  download's SHA-256, then stores it in the extension's cache.

Keyboard shortcuts (change them at `chrome://extensions/shortcuts`):

| Shortcut | Action |
| --- | --- |
| Alt+Shift+H | Turn hints on or off |
| Alt+Shift+J | Show the hint for the current position now |
| Alt+Shift+A | Turn autoplay on or off |

Chrome skips a suggested shortcut that clashes with another extension; set it
on the shortcuts page if one shows as "not set" in the popup.

## Layout

```
src/
  analysis/     position evaluation, move classification, reports, opening names
  background/   extension service worker and keyboard shortcuts
  content/      page detection, board reading, hints, autoplay, analysis lifecycle
  engine/       engine clients, Stockfish worker host, UCI protocol
  popup/        settings UI, also embedded in the floating window
  shared/       validated settings and shared message constants
  ui/           board overlays, controls, analysis panel, floating settings
tests/
  e2e/          browser tests against captured Chess.com markup
  fixtures/     captured markup and shared test fixtures
  tools/        dev-only tools: analyse a PGN, compare with Chess.com (never shipped)
data/openings/  source opening TSVs; generated lookup is in src/analysis
docs/           architecture, calibration plan, and reviewed games for tuning
scripts/        engine asset copy and opening-data generation
public/         extension assets copied into the production build, and the updater helper
```

For module responsibilities and runtime flow, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Where Vektra runs

This branch is limited to games against Chess.com's bots. The rules live in
`src/content/pageScope.ts`:

| Page | Behavior |
| --- | --- |
| `/play/computer` with the bot board (`#board-play-computer`) | Game: hints, live ratings, autoplay |
| `/game/computer/<id>` | Game (a saved bot game) |
| `/analysis`, `/game/review` | Analysis and review |
| `/play/online`, `/game/live/<id>`, `/game/daily/<id>`, `/game/<id>`, `/live`, `/daily`, `/variants` | Inactive until the move list shows a result, then review only |
| Anything else | Inactive |

Anything that can't be confirmed as a bot game or a finished game stays
inactive: the game-over modal alone doesn't unlock a game against a person,
and `/play/computer` without the bot board stays off. The scope is checked
again on every URL change, board change and before each autoplay move. If
Chess.com renames the bot board, hints stop in bot games until
`SELECTORS.botBoard` is updated.

## How the position is read

The move list is replayed in chess.js, which gives a correct FEN (side to move,
castling, en passant) for every ply. The pieces on the board then decide which
ply is actually on screen, so stepping back and forward through the game, a
missing selection, or the board updating before the move list all resolve to
the right position. If no ply matches (for example an analysis board set up
from a custom position), the FEN is rebuilt from the pieces alone, with
castling inferred from home squares and no en passant square.

## Game analysis

On a finished game, Game Review, or analysis-board page, the "Vektra analysis"
panel opens as its own window beside the board (on the right if there is room,
otherwise on the left); drag its title bar to move it, click it to fold it, and
it remembers both. After a bot game the button is **Review this game**: it
analyses the game and then jumps to your biggest mistake (the inaccuracy or
worse that lost the most win chance). Click **Analyze game** to run Stockfish over every
position of the main line (depth set in the popup, 12 by default). When it
finishes:

- the opening is named, and opening moves are marked Book (from the Lichess
  opening list, CC0, in `data/openings`);
- each move in chess.com's move list gets a badge: Book, Brilliant `!!`, Great `!`,
  Best `★`, Excellent `✓`, Good `○`, Inaccuracy `?!`, Mistake `?`, Miss `✗`,
  Blunder `??`;
- the panel shows accuracy per side, an eval graph (click it to jump to a
  move), and how many moves of each kind each side played;
- each side gets a rough **game rating** from its accuracy (a line through
  one Chess.com Game Rating so far, so treat it as a guide), and an accuracy
  for the **opening, middlegame and endgame** with the badge it would get as
  a move (a dash where a phase wasn't reached). Phases follow Lichess's
  split: the middlegame starts once 10 or fewer rooks, knights, bishops and
  queens are left or a back rank thins out (by move 15 at the latest), the
  endgame at 6 or fewer;
- stepping to a move shows the engine's preferred line from that position as
  arrows, and the panel says what the move was and what the best move was.
  For an Inaccuracy, Mistake, Miss or Blunder it also says why when there is
  a concrete reason: "Allows mate in 2, starting with Qxh7+", "Misses mate in
  3 with Rd8+", "Loses the knight on c3 to bxc3", "Loses the queen for a
  bishop", or "Misses Qxc8, which takes the queen". Moves that only give up
  position get no reason;
- **What do the arrows and numbers mean?** at the bottom of the panel opens
  a short legend of the board marks and the numbers;
- the shown move gets a Vektra classification marker on its destination square;
- **Export PDF** downloads a one-page report (accuracy, eval graph, counts and
  every move with its classification and the better move), and **Export
  JSON** downloads every move with its evals, best move and line, win %,
  accuracy and classification.

The panel can be folded away by clicking its title; Vektra remembers that.
Completed analyses are cached locally for up to 12 games.

### How moves are classified

Evals are turned into win % with
`win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`. A move's loss is
the mover's win % with the best move minus their win % after the move
played. All thresholds are in `src/analysis/config.ts`:

| Category | Rule (defaults) |
| --- | --- |
| Book | Every move so far is in the opening list (first 30 plies) |
| Brilliant | A detected sacrifice that is best or within 1 percentage point of best, with win % before between 20 and 98 and at least 50 after. A sacrifice gives up at least a pawn's worth more than the best other move would, in pieces worth 3 or more, after recaptures: so a knight for two pawns counts, and so does leaving an attacked piece where it is instead of saving it. A piece no move could save doesn't count, and nothing counts when the second-best move also wins outright |
| Great | Best or equal-best move when the second-best line is at least 15 percentage points worse, with win % before no higher than 90. Not for taking the piece the opponent just moved (a recapture), which is the expected reply |
| Best | Engine's top move, another engine line scored within 5 cp of it, or the only legal move |
| Excellent | Win-chance loss up to 2 percentage points |
| Good | Loss up to 5 percentage points |
| Miss | After an opponent inaccuracy or worse, fails to capitalize (loss over 5 points) from a 60%+ position, however much it gives back (not taking a hung queen is a Miss, as on Chess.com) |
| Inaccuracy | Loss up to 10 percentage points |
| Mistake | Loss up to 20 percentage points |
| Blunder | Loss over 20 percentage points |

These are Vektra's heuristics, not Chess.com's classification rules. Win
chances are derived from engine evaluations using the curve above; mate scores
are handled separately. Per-move accuracy uses
`103.1668 * exp(-0.075 * loss) - 3.1669`, clamped to 0-100. Side accuracy,
like Lichess's, is the average of two means of that side's non-book move
accuracies (100 if there are none):

- a weighted mean, where each move counts by how much the win chance swung
  in the few positions before it (sharp games count more), and
- a harmonic mean in which no move counts below 20%, so one or two moves
  that throw the game away pull the score down without sinking it to nothing.

The constants were fitted at depth 12 to Chess.com's Game Review of three
games: the six accuracies came within 3 points (2 on average).

### Comparing with Chess.com

Most differences from Chess.com's Game Review come from the engines, not the
rules: Chess.com searches deeper with its own settings, so in a decided
position it may call a move a Mistake that Vektra's engine thinks is best.
To compare a game, download its PGN from Chess.com after Game Review (it
carries Chess.com's ratings as $3, $2 and so on) and run:

```bash
PGN=game.pgn DEPTH=12 npx vitest run tests/tools --silent=false
```

It prints Vektra's rating of each move beside Chess.com's and how many of
the rated moves agree.

The reviewed games used for tuning, and the plan for calibrating on more,
are in [docs/CALIBRATION.md](docs/CALIBRATION.md).

## Engine

Vektra ships the single-threaded Stockfish 19 lite build from the `stockfish`
npm package (about 1.8 MB). It needs no cross-origin isolation. The optional
Stockfish 19.0.1 full WASM is about 99 MB and takes additional time and memory
to download and run.
`npm run build` copies it into the extension (`scripts/copy-engine.mjs`).

Content scripts can't start a worker from the extension's origin, so the
background service worker opens an offscreen document, and each chess.com tab
connects to it over a port. Hints use three Stockfish Web Workers per tab
(the main search, weaker moves and threats), or one in light mode; full-game
analysis uses its own. The
extension pages' CSP adds `wasm-unsafe-eval` for the WebAssembly. Nothing is
injected into chess.com's own page context, so `web_accessible_resources`
only lists what the content-script loader needs.

The full engine's loader (`engine/stockfish-19-single.js`) ships with the
extension; its WASM is downloaded from the stockfish.js GitHub release only
after the user requests it and grants optional host permissions. Vektra checks
the SHA-256 before caching the file in extension Cache Storage and using it in
a worker. `npm run e2e:full-engine` tests the download (first build with
`VEKTRA_E2E_FULL_ENGINE=1 npm run build` so the test extension has the download
hosts granted without a prompt; the test stops if `dist` was not built that
way).

Full-game analysis requests a 64 MiB transposition table per worker to help
reuse search results across nearby positions. The full engine can use multiple
workers, so analysis may use substantially more memory than a single engine
search.

## Updating selectors

Every Chess.com selector is in `src/content/selectors.ts`. Each entry is a
list tried in order, so add new markup first and keep old selectors as
fallbacks. Entries marked CONFIRMED match markup captured on 2026-10-29 (saved
in `tests/fixtures/chesscom` and tested by `tests/chesscomMarkup.test.ts`).
UNCONFIRMED selectors have not been verified against live markup.

To see the current markup, open a chess.com game, open DevTools, and run:

```js
const b = document.querySelector('wc-chess-board');
console.log(b?.id, b?.className, b?.querySelector('.piece')?.className);
const l = document.querySelector('.move-list.chessboard-pkg-move-list-component');
console.log(l?.tagName, l?.outerHTML.slice(0, 2000));
```

After changing selectors, save fresh markup into `tests/fixtures/chesscom`,
update `tests/fixtures/dom.ts` to the new shape, and run `npm test`.

## Known limitations

- chess.com may change its markup at any time; see "Updating selectors".
  When the board, its pieces or a game's moves can't be found, the popup
  says so, and it asks for a reload when Vektra isn't running in the tab.
  Markup was captured logged out, so logged-in-only variations (such as
  figurine notation) are untested.
- The DOM-only fallback cannot know en passant rights or the move counters.
- Positions in a variation of a variation fall back to reading the board.
- Move arrows along the same line can overlap; only the threat arrow is
  shifted aside.
- The eval bar sits just outside the board's left edge and may be hidden if a
  surrounding chess.com element clips it.
- In bot games, "your side" is taken to be the side at the bottom of the board.
- Game analysis covers the main line only.
- The full engine uses about 100 MB of memory per engine worker. Hints use
  three workers unless light mode is on, and full-game analysis can use more
  than one.
- The sacrifice test for Brilliant checks material only (a static exchange
  on each piece, counting legal captures and recaptures); it does not look
  for compensation such as mating attacks, which the engine score covers.
- The reason given for a bad move covers mates and material only, read from
  the engine's lines; a move that only gives up position gets none.
- Game rating is a rough line through one Chess.com Game Rating pair, and
  the accuracy fit rests on three games; see docs/CALIBRATION.md.
- Not yet tried on the live site: the promotion picker selectors, the board
  on `/game/computer/<id>`, the Review button and Alt+Shift+A in a finished
  bot game, and the popup's page warning.
- In Elo or reduced-skill mode a provisional best line appears during search;
  the final weakened move replaces it when the search finishes.
- With autoplay off, an eligible weaker alternative appears as the second,
  dim violet arrow alongside the best move. When autoplay chooses a weaker
  move, that selected move is highlighted in violet; enabling additional
  candidate moves also shows the other engine lines.

## Third-party licenses

- Stockfish is distributed under GPL-3.0; see
  [`public/engine/STOCKFISH-LICENSE.txt`](public/engine/STOCKFISH-LICENSE.txt)
  and the [stockfish.js source](https://github.com/nmrugg/stockfish.js).
- Opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  released under CC0; see [`data/openings/README.md`](data/openings/README.md).
