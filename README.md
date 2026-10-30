# Vektra

Vektra is an independent browser extension that provides Stockfish move
suggestions, optional live move ratings, and full-game analysis on supported
Chess.com game and analysis pages. Optional autoplay is off by default.

> [!IMPORTANT]
> **Use Vektra responsibly.** Engine assistance and automated move input may be
> restricted by Chess.com, tournament organizers, or other applicable rules,
> especially during live games. Check the rules that apply to you before using
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
- [Important notices](#important-notices)
- [Settings](#settings)
- [Project layout](#layout)
- [Position detection](#how-the-position-is-read)
- [Game analysis](#game-analysis)
- [Engine](#engine)
- [Chess.com selectors](#updating-selectors)
- [Known limitations](#known-limitations)
- [Third-party licenses](#third-party-licenses)

## Install (load unpacked)

1. `npm ci` (or `npm install` if you are changing dependencies)
2. `npm run build`
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and choose the `dist` folder.
4. Open a supported Chess.com game, review, or analysis page. Click the Vektra
   toolbar icon to open settings. In games, the board can show up to three
   normal engine arrows (green, blue, and orange), an evaluation bar, and
   controls for autoplay and weaker alternatives. With autoplay off, an
   eligible weaker alternative is shown as a dim second arrow while the best
   move stays visible. If autoplay selects that alternative, it is shown in
   magenta. Hints in live games appear only on the bottom-side player's turn.
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

## Important notices

- **Live-game rules:** Vektra can display engine suggestions in live games
  against people or bots. Autoplay submits moves through the board's input
  handlers. The rules for engine assistance and automation vary by platform,
  event, and context; verify that your use is permitted. Vektra does not
  determine whether a particular game allows assistance.
- **Review every move:** Stockfish strength settings are approximate, searches
  have configurable limits, and engine evaluations can change with depth or
  position reconstruction. Autoplay checks legality and turn/position state,
  but it cannot guarantee a good move or protect against every site UI change.
  Autoplay is off by default; supervise it and turn it off if behavior is
  unexpected. Promotions are not played automatically.
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
move it and use the close button to dismiss it. On other pages, the regular
toolbar popup remains available. Settings are saved in `chrome.storage.sync`
and apply to open tabs straight away. Settings have three tabs: **Hints**
(presets and live-game controls), **Engine** (engine choice, strength and search
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
  other top lines. Configure it under **Hints →
  Move suggestions**: the default chance is 50% per eligible turn, with a
  maximum evaluation loss of 2.00 pawns. Positions without a suitable legal
  alternative keep the engine's first choice. With autoplay off, the engine's
  best move stays first and an eligible weaker alternative is always shown as
  the second, dim purple arrow; the chance setting does not hide this preview.
  With autoplay on, the chance setting controls whether the weaker alternative
  is played automatically. The board control and settings toggle stay synchronized.
- **Search**: fixed depth (1-30) or a time per move.
- **Board display**: move arrows use consistent colours, alongside the
  evaluation bar; there are no separate display controls.
- **Hints in live games**: show recommendations immediately (default) or only
  when you press the "show hint" shortcut. Analysis and review pages always
  show hints immediately.
- **Autoplay**: off by default and available in live games against people and
  bots. The board control shows an Auto on/off state, engine think time, and
  the selected delay before a move is submitted. Set minimum and maximum
  delays in the popup; Vektra picks a delay in that range after choosing a move. The
  existing Skill Level/Elo controls determine move strength. Vektra checks the
  turn and position, submits at most one move per position, stops after the
  game ends, and leaves promotions for you to handle manually. A **Stop
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
  tools/        test utilities
data/openings/  source opening TSVs; generated lookup is in src/analysis
docs/           project documentation
scripts/        engine asset copy and opening-data generation
public/         extension assets copied into the production build
```

For module responsibilities and runtime flow, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
panel sits at the top of Chess.com's sidebar next to the board (or bottom right
if there is no sidebar). Click **Analyze game** to run Stockfish over every
position of the main line (depth set in the popup, 12 by default). When it
finishes:

- the opening is named, and opening moves are marked Book (from the Lichess
  opening list, CC0, in `data/openings`);
- each move in chess.com's move list gets a badge: Book, Brilliant `!!`, Great `!`,
  Best `★`, Excellent `✓`, Good `○`, Inaccuracy `?!`, Mistake `?`, Miss `✗`,
  Blunder `??`;
- the panel shows accuracy per side, an eval graph (click it to jump to a
  move), and how many moves of each kind each side played;
- stepping to a move shows the engine's preferred line from that position as
  arrows, and the panel says what the move was and what the best move was;
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
| Brilliant | A detected sacrifice that is best or within 1 percentage point of best, with win % before between 20 and 98 and at least 50 after |
| Great | Best or equal-best move when the second-best line is at least 15 percentage points worse, with win % before no higher than 90 |
| Best | Engine's top move, another engine line scored within 5 cp of it, or the only legal move |
| Excellent | Win-chance loss up to 2 percentage points |
| Good | Loss up to 5 percentage points |
| Miss | After an opponent mistake/blunder, fails to capitalize (loss over 5 points) from a 60%+ position while still at 40%+ |
| Inaccuracy | Loss up to 10 percentage points |
| Mistake | Loss up to 20 percentage points |
| Blunder | Loss over 20 percentage points |

These are Vektra's heuristics, not Chess.com's classification rules. Win
chances are derived from engine evaluations using the curve above; mate scores
are handled separately. Per-move accuracy uses
`103.1668 * exp(-0.08 * loss) - 3.1669`, clamped to 0-100. Side accuracy is
the harmonic mean of that side's non-book move accuracies (or 100 if there are
no such moves).

## Engine

Vektra ships the single-threaded Stockfish 19 lite build from the `stockfish`
npm package (about 1.8 MB). It needs no cross-origin isolation. The optional
Stockfish 19.0.1 full WASM is about 99 MB and takes additional time and memory
to download and run.
`npm run build` copies it into the extension (`scripts/copy-engine.mjs`).

Content scripts can't start a worker from the extension's origin, so the
background service worker opens an offscreen document, and each chess.com tab
connects to it over a port and gets its own Stockfish Web Worker. The
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
  Markup was captured logged out, so logged-in-only variations (such as
  figurine notation) are untested.
- The DOM-only fallback cannot know en passant rights or the move counters.
- Positions in a variation of a variation fall back to reading the board.
- Arrows along the same line overlap.
- The eval bar sits just outside the board's left edge and may be hidden if a
  surrounding chess.com element clips it.
- In live games, "your side" is taken to be the side at the bottom of the board.
- Game analysis covers the main line only.
- The analysis panel docks into chess.com's sidebar by its id
  (`#board-layout-sidebar`); if chess.com changes it, the panel floats instead.
- The full engine uses about 100 MB of memory per engine worker; full-game
  analysis can use more than one worker.
- The sacrifice test for Brilliant checks material only (a static exchange
  on each piece, counting legal captures and recaptures); it does not look
  for compensation such as mating attacks, which the engine score covers.
- In Elo or reduced-skill mode a provisional best line appears during search;
  the final weakened move replaces it when the search finishes.
- With autoplay off, an eligible weaker alternative appears as the second,
  dim purple arrow alongside the best move. When autoplay chooses a weaker
  move, that selected move is highlighted in magenta; enabling additional
  candidate moves also shows the other engine lines.

## Third-party licenses

- Stockfish is distributed under GPL-3.0; see
  [`public/engine/STOCKFISH-LICENSE.txt`](public/engine/STOCKFISH-LICENSE.txt)
  and the [stockfish.js source](https://github.com/nmrugg/stockfish.js).
- Opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  released under CC0; see [`data/openings/README.md`](data/openings/README.md).
- The display face is [Young Serif](https://github.com/noirblancrouge/YoungSerif),
  bundled under the SIL Open Font License; see
  [`public/fonts/OFL.txt`](public/fonts/OFL.txt).
