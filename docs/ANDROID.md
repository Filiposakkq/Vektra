# Vektra for Android: plan

Status: planned, nothing built yet. This is the plan agreed on 2026-11-01,
after checking what the Chess.com Android app exposes.

## Goal

An Android app that shows Vektra's hints as an overlay on the Chess.com app
during **bot games only**, and reviews finished games. It shares its rules
with the extension, so a change to ratings or hints reaches both in the same
release.

| Kept | Dropped |
| --- | --- |
| Best-move arrows with scores, the eval bar | Autoplay |
| The threat arrow | Three engines at once (one on a phone) |
| Weaker moves (the violet arrow) | PDF export, at first |
| Live move ratings (Best, Mistake...) | |
| Strength, depth and hint settings | |
| Review of finished games: accuracy, game rating, phase grades, reasons, legend | |

## The bot-only rule

The same rule as the extension: hints only in games against Chess.com's bots,
and anything that can't be confirmed as one stays off.

- The app has no URL, but Android tells an accessibility service which screen
  is in front. Bot games use `com.chess.features.versusbots.game.BotGameActivityV2`;
  live games use `com.chess.realchess.ui.game.RealGameActivity` (seen while
  watching a game).
- The overlay turns on **only** for an allow-list of bot-game screens (today
  just `BotGameActivityV2`) with a readable board. Every other screen (live,
  daily, puzzles, lessons, anything new or renamed) keeps it off. If Chess.com
  renames the bot screen, hints stop until Vektra is updated: the safe
  direction.
- Games against people are only reviewed once finished, loaded from
  Chess.com's public game archive, never read from a game on screen.
- The accessibility service reads the screen only. It never taps, types or
  performs gestures (`canPerformGestures` off), so there is no autoplay path.

To check: whether other modes (coach, lessons, custom positions) also use
`BotGameActivityV2`, and whether the screen name changes between app versions.

## What the app exposes

Checked on a Redmi Note 12 Pro 5G, Android 14, Chess.com app 4.10.23 (Czech).

- **Every square**, with its piece and screen position, as an accessibility
  label: `Bílý Věž na h1` (White Rook on h1) at `[0,719][135,854]`,
  `g1, prázdné` (g1, empty). No screenshots or image recognition are needed,
  and arrows can be drawn exactly on the squares.
- **Board orientation** follows from the square positions (h1 top-left means
  the board is shown from Black's side).
- **The move list** as text (`3. c3 e5 4. f4`). In the live-game screen piece
  icons come through as lower-case letters (`10. qe2`, `11. bd2`).
- **Languages:** labels follow the app's language, so piece and colour names
  are needed per language, like the extension's localised move list.

## How it is built

A Kotlin app with a small native shell around the shared TypeScript core.

1. **Accessibility service.** Watches which Chess.com screen is in front
   (window state events) and, on an allowed bot screen, reads the square
   labels into a board position and the move list into the game's moves.
2. **Overlay.** An accessibility overlay window (no separate "draw over other
   apps" permission) draws the arrows, scores, threat arrow, eval bar and
   rating badges on the square positions, plus a small Vektra button for
   settings. It is cleared the moment the screen stops being a bot game.
3. **Shared core in a WebView.** A hidden WebView runs a bundle built from
   `src/`: replaying moves, building engine requests, choosing and scoring
   arrows, weaker moves, live ratings and full-game analysis
   (`src/content/hint*.ts`, `weakerMoves.ts`, `liveRatings.ts`,
   `src/analysis/`). Kotlin passes it the board and moves and draws what it
   returns. Rules aren't rewritten in Kotlin, so the two versions can't drift.
4. **Engine.** First the same Stockfish WebAssembly build in that WebView
   (identical behaviour, one runtime). If it is too slow on phones, a native
   Stockfish binary later, behind the same request format.
5. **Review screen.** Enter a Chess.com username, pick a finished game from the
   public archive (`api.chess.com/pub/player/<name>/games/archives`, no login),
   and see the analysis panel, rendered from the same code in a WebView.
6. **Settings.** The extension's settings model (`src/shared/settings.ts`,
   `sanitizeSettings`) is shared; the screen shows the subset the app uses.

### Repository layout

- `android/`: the Gradle project (Kotlin).
- `src/core/`: the entry point for the shared bundle; a Vite library build
  writes it into `android/app/src/main/assets/`.
- Tests: board-label parsing tested against saved screen dumps (bot game,
  and a live game with player names removed), JVM unit tests for the shell,
  and the existing unit tests for the shared core.

## Releases and updates

- One version for both: `package.json` sets the extension version and the
  app's `versionName` (and a `versionCode` derived from it).
- One tag, one release: the release workflow builds the extension zip and a
  signed `vektra-<version>.apk`, each with a SHA-256 checksum, and attaches
  them to the same GitHub release. The APK signing key is a GitHub secret;
  every release must use the same key or Android refuses the update.
- Updating: the app checks the latest GitHub release like the extension does,
  downloads the APK, checks its checksum and hands it to Android's installer,
  which asks the user to confirm (sideloaded apps can't update silently).
- Distribution is GitHub only. Google Play doesn't accept apps that read other
  apps' screens like this.
- Installing: allow installs from the browser or file manager, then enable the
  Vektra accessibility service. On Android 13 and later, a sideloaded app's
  accessibility service first needs **Allow restricted settings** in its app
  info.

## Milestones

1. **Read the board.** Android skeleton, accessibility service, the bot-screen
   allow-list, board and move parsing for Czech and English; logs the position.
2. **Hints.** Shared core bundle and engine in the WebView; best-move arrows
   with scores and the eval bar in the overlay.
3. **The rest of the hints.** Threat arrow, weaker moves, live ratings,
   settings screen.
4. **Review.** Finished games from the public archive, with the analysis panel.
5. **Releases.** APK in the release workflow, signing, the in-app updater.

## Risks and open questions

- Chess.com can rename screens or change labels; Vektra then stays off until
  updated (the bot check fails closed).
- Phone performance and battery: one engine, light defaults, nothing runs
  outside bot games.
- Xiaomi and other vendors stop background services to save battery; the
  accessibility service may need to be exempted.
- Promotions, castling and en passant from labels alone: the move list fills
  these in, as in the extension.
- Same rules as the extension: no autoplay, no data collection, no
  detection evasion, no live-game hints.
