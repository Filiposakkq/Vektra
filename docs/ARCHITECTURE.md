# Vektra architecture

Vektra has two apps that share one core:

| Folder | What it is |
| --- | --- |
| `core/` | Shared TypeScript: game analysis, hint logic, engine search types and the Stockfish driver, the settings model. No browser-extension or page APIs, so the Android app can run the same code. |
| `extension/` | The Chrome extension (Manifest V3, built with Vite and crxjs). Imports the core as `@core/...`. |
| `android/` | The Android app (Kotlin), an overlay on the Chess.com app; see [ANDROID.md](ANDROID.md). |

`tests/layers.test.ts` enforces the direction: `core/` never imports the
extension and never uses `chrome.*`. Tests import the core as `@core/...` and
the extension as `@ext/...` (aliases in `tsconfig.json`, `vite.config.ts` and
`vitest.config.ts`).

The extension's content script runs on Chess.com pages and decides whether the
current page is a bot game, a finished game, a review or the analysis board
before attaching features (`extension/src/content/pageScope.ts`). Hints, live
ratings and autoplay run only in games against Chess.com's bots; games against
people open for analysis only once they have finished.

## Runtime boundaries (extension)

Paths below are under `extension/src/` unless they start with `core/`.

1. `content/index.ts` watches Chess.com navigation and board changes. It
   coordinates settings, move hints, autoplay controls, and lazy loading of
   full-game analysis.
2. `content/boardReader.ts` reads the visible board and move list.
   `content/fen.ts` replays moves with chess.js (`core/chess/replay.ts`) to
   produce position FENs; `content/selectors.ts` keeps Chess.com selectors in
   one place.
3. `engine/client.ts` connects a tab to the background service worker.
   `background/index.ts` starts `engine/offscreen.html`, where
   `engine/offscreen.ts` hosts one Stockfish worker per connected client.
   `core/engine/uciEngine.ts` handles UCI searches. A client that loses its
   port reconnects once and resends the searches it was waiting for.
4. `content/hints.ts` (the `HintController`) runs the position searches and
   draws their results. It runs three engine clients side by side: the main
   search, the weaker move search and the threat search (one client in light
   mode). It keeps a cache of finished searches, searches ahead on the bot's
   turn, and can swap a best move that draws on the spot. The logic it uses is
   in `core/hints/`: `hintRequests.ts` (what each search asks the engine),
   `hintArrows.ts` (which arrows to draw, their scores, keeping them steady),
   `gameHistory.ts` (the game's moves since the last capture or pawn move, sent
   so the engine sees repetitions; draws), `weakerMoves.ts`, `userSide.ts`
   (whose turn the hints are for) and `liveRatings.ts` (rating the user's moves
   with `core/analysis/moveAnalysis.ts`, without loading full-game analysis).
   `content/autoPlay.ts` validates and schedules optional move submission.
   `content/analysisController.ts` runs full-game review on demand and caches
   completed analyses locally. Each saved analysis records the engine that
   actually ran and its search settings (`analysis/analysisCache.ts`), and is
   reused only when those cover the current engine and depth. Saved analyses
   are re-rated from their evaluations when shown, so rating rule changes reach
   them without running the engine again.
   `content/pageHealth.ts` answers the popup's check of whether the board,
   pieces and moves can still be read.
5. `ui/` contains the board overlays and controls; `popup/` contains the
   settings interface, which is also embedded as a floating window. The
   settings model is `core/settings.ts`; `shared/settings.ts` stores it in
   `chrome.storage` and holds the extension's message names.
6. Updates: `background/updates.ts` asks GitHub for the latest release (on
   Chrome start, after a reload, and when the popup opens, at most once an
   hour) and keeps the result in `chrome.storage.local` for the popup.
   Extensions can't write their own files, so installing goes through the
   updater helper in `extension/public/updater`: a PowerShell script Chrome
   starts by native messaging once `install-updater.ps1` has registered it. It
   takes a lock (one update at a time), downloads the release zip, checks its
   checksum and copies it over the extension folder without deleting anything
   (pages still running the old version may load its files); files only the
   old version had are removed on the next update. The worker then sees the
   newer `manifest.json` on disk, asks each Chess.com tab whether a bot game is
   in progress (`GAME_IN_PROGRESS`), and reloads Vektra once none is, checking
   again every minute by alarm. A version unzipped over the folder by hand is
   picked up the same way.

## Source layout

| Path | Responsibility |
| --- | --- |
| `core/analysis/` | Position evaluation, classification (`classify.ts`), the reason a move was bad (`explain.ts`), game phases (`phases.ts`), accuracy and game rating (`gameAnalysis.ts`), tunable constants (`config.ts`), opening lookup |
| `core/chess/` | Replaying a game's moves |
| `core/engine/` | UCI parsing, search request and result types, the worker-based UCI engine |
| `core/hints/` | Hint logic: requests, arrows, game history and draws, weaker moves, live ratings, shared types |
| `core/settings.ts` | Every setting, its default, and how stored values are checked |
| `extension/src/analysis/` | Saved analyses, JSON and PDF export |
| `extension/src/background/` | Service worker, keyboard shortcuts and updates |
| `extension/src/content/` | Chess.com page scope, board reading, the hint controller, autoplay, analysis lifecycle |
| `extension/src/engine/` | Engine messaging, the offscreen worker host, full-engine download |
| `extension/src/popup/` | Settings markup, styles and behavior |
| `extension/src/shared/` | Settings storage, page health and update messages |
| `extension/src/ui/` | Board controls, overlays, badges and analysis panel |
| `extension/public/` | Static extension assets and the updater helper (`updater/`); engine assets are copied there before builds |
| `extension/manifest.config.ts` | The extension manifest |
| `android/` | The Android app |
| `data/openings/` | Source opening TSVs used to generate `core/analysis/openings.json` |
| `scripts/` | Build-time asset copying, build fingerprint and opening-data generation |
| `tests/core/`, `tests/extension/` | Unit and integration tests for each; `tests/e2e/` fixture-based browser and full-engine tests; `tests/tools/` dev-only analysis tools that never ship |
| `docs/calibration/` | Chess.com-reviewed games used to tune the ratings (see [CALIBRATION.md](CALIBRATION.md)) |

The full-game controller and opening database are loaded on demand, keeping
the initial content-script path leaner on pages where those features are not
needed yet.

## Build and verification

- `npm run build` copies the bundled engine assets and builds the unpacked
  extension into `dist/`. The Vite root is `extension/`, so built paths stay
  `src/popup/index.html` and so on.
- `npm test` runs the unit and integration suite; `npm run typecheck` checks
  TypeScript without emitting files.
- `npm run e2e` runs browser tests against captured Chess.com markup. It
  first checks that `dist/vektra-build.json` matches a fingerprint of the
  current sources (`scripts/build-fingerprint.mjs`) and stops if `dist` is
  stale.
- `npm run openings` regenerates the opening lookup from `data/openings/`.
- `PGN=game.pgn DEPTH=12 npx vitest run tests/tools --silent=false`
  analyses one game with the real engine and prints Vektra's ratings beside
  Chess.com's (see [CALIBRATION.md](CALIBRATION.md)).

See the root [README](../README.md) for installation, settings, supported
behavior, compatibility notes, and third-party licenses.
