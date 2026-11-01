# Vektra architecture

Vektra is a Manifest V3 extension built with TypeScript, Vite, and crxjs. Its
content script runs on Chess.com pages and decides whether the current page is
a bot game, a finished game, a review or the analysis board before attaching
features (`src/content/pageScope.ts`). Hints, live ratings and autoplay run
only in games against Chess.com's bots; games against people open for
analysis only once they have finished.

## Runtime boundaries

1. `src/content/index.ts` watches Chess.com navigation and board changes. It
   coordinates settings, move hints, autoplay controls, and lazy loading of
   full-game analysis.
2. `src/content/boardReader.ts` reads the visible board and move list.
   `src/content/fen.ts` replays moves with chess.js to produce position FENs;
   `src/content/selectors.ts` keeps Chess.com selectors in one place.
3. `src/engine/client.ts` connects a tab to the background service worker.
   `src/background/index.ts` starts `src/engine/offscreen.html`, where
   `src/engine/offscreen.ts` hosts one Stockfish worker per connected client.
   `src/engine/uciEngine.ts` handles UCI searches. A client that loses its
   port reconnects once and resends the searches it was waiting for.
4. `src/content/hints.ts` manages position searches and live move ratings,
   using `src/analysis/moveAnalysis.ts` without loading full-game analysis.
   It runs three engine clients side by side: the main search, the weaker
   move search and the threat search (one client in light mode). It sends
   the game's moves since the last capture or pawn move, so the engine sees
   repetitions, keeps a cache of finished searches, searches ahead on the
   bot's turn, and can swap a best move that draws on the spot.
   `src/content/autoPlay.ts` validates and schedules optional move submission.
   `src/content/analysisController.ts` runs full-game review on demand and
   caches completed analyses locally. Each saved analysis records the engine
   that actually ran and its search settings (`src/analysis/analysisCache.ts`),
   and is reused only when those cover the current engine and depth. Saved
   analyses are re-rated from their evaluations when shown, so rating rule
   changes reach them without running the engine again.
   `src/content/pageHealth.ts` answers the popup's check of whether the
   board, pieces and moves can still be read.
5. `src/ui/` contains the board overlays and controls; `src/popup/` contains
   the settings interface, which is also embedded as a floating window.
   Shared settings and message names are in `src/shared/`.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/analysis/` | Position evaluation, classification (`classify.ts`), the reason a move was bad (`explain.ts`), game phases (`phases.ts`), accuracy and game rating (`gameAnalysis.ts`), tunable constants (`config.ts`), exports, opening lookup |
| `src/background/` | Extension service worker and keyboard shortcuts |
| `src/content/` | Chess.com page scope, board reading, hints, autoplay, analysis lifecycle |
| `src/engine/` | Engine protocol, worker host, full-engine download and UCI implementation |
| `src/popup/` | Settings markup, styles and behavior |
| `src/shared/` | Validated settings and cross-context message constants |
| `src/ui/` | Board controls, overlays, badges and analysis panel |
| `data/openings/` | Source opening TSVs used to generate `src/analysis/openings.json` |
| `public/` | Static extension assets; engine assets are copied before builds |
| `scripts/` | Build-time asset copying and opening-data generation |
| `tests/` | Unit, integration, fixture-based browser and full-engine tests; `tests/tools` holds dev-only analysis tools that never ship |
| `docs/calibration/` | Chess.com-reviewed games used to tune the ratings (see [CALIBRATION.md](CALIBRATION.md)) |

The full-game controller and opening database are loaded on demand, keeping
the initial content-script path leaner on pages where those features are not
needed yet.

## Build and verification

- `npm run build` copies the bundled engine assets and builds the unpacked
  extension into `dist/`.
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
