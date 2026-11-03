# Vektra for Android: plan

Status: milestone 5 built (2026-11-03), waiting for its first release. In Chess.com bot games the app shows
the engine's best moves as arrows over the board on the user's turn, with
scores, the bot's threat, an optional weaker move, an eval strip and a rating
of each of the user's moves, and has a settings screen. This is the plan agreed on
2026-11-01, after checking what the Chess.com Android app exposes.

## Building and installing

You need Java 17, the Android SDK (platform 35, build tools 35.0.0) and adb.
Put the SDK path in `android/local.properties` (`sdk.dir=E\:\\android-sdk`;
the file is ignored by git). Build the overlay page from the repository root
first: `npm run build:android-web` puts `android/web` and the shared core,
with the Stockfish files, into the app's assets. Then from `android/`:

```bash
JAVA_HOME=/e/jdk-17 ./gradlew testDebugUnitTest assembleDebug
```

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On a PC where security software inspects HTTPS (Windows trusts its
certificate, Java doesn't), Gradle can't download anything. Run it with
`GRADLE_OPTS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"` and add
`-Djavax.net.ssl.trustStoreType=Windows-ROOT` to the command, so Java uses
the Windows certificate store.

On the phone: on Xiaomi, turn on **Install via USB** in the developer options;
after installing, turn on Vektra under **Accessibility → Downloaded apps**
(if it is greyed out, **Allow restricted settings** in Vektra's app info
first). `adb logcat -s Vektra:I` shows what it reads.

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
   `core/`: replaying moves, building engine requests, choosing and scoring
   arrows, weaker moves, live ratings and full-game analysis (`core/hints/`,
   `core/analysis/`). Kotlin passes it the board and moves and draws what it
   returns. Rules aren't rewritten in Kotlin, so the two versions can't drift.
4. **Engine.** First the same Stockfish WebAssembly build in that WebView
   (identical behaviour, one runtime). If it is too slow on phones, a native
   Stockfish binary later, behind the same request format.
5. **Review screen.** Enter a Chess.com username, pick a finished game from the
   public archive (`api.chess.com/pub/player/<name>/games/archives`, no login),
   and see the analysis panel, rendered from the same code in a WebView.
6. **Settings.** The settings model (`core/settings.ts`, `sanitizeSettings`)
   is shared; the screen shows the subset the app uses.

### Repository layout

- `android/`: the Gradle project (Kotlin).
- `core/`: the shared TypeScript. A Vite library build (milestone 2) bundles
  it into `android/app/src/main/assets/`.
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
   *Done:* checked on the phone, the position read matched the screen square
   for square (Black to move after 9.Bh3, board shown from Black's side), and
   it stayed off on the new-game and play-a-friend screens. English labels are
   tested but not yet seen on a device.
2. **Hints.** Shared core bundle and engine in the WebView; best-move arrows
   with scores and the eval bar in the overlay.
   *Done:* the overlay page (`android/web`) runs the lite Stockfish and
   `core/hints` in a see-through WebView window laid over the board
   (`HintOverlay.kt`); arrows use the extension's shapes and colours
   (`core/hints/arrowShapes.ts`). On the phone: depth 16 in 2-4 seconds, the
   arrows on the right squares. Without the move history the position comes
   from the pieces alone (`core/chess/position.ts`: castling guessed from
   kings and rooks at home, no en passant, no repetitions). The eval strip is
   hard to see on Chess.com's dark background when the user plays Black.
3. **The rest of the hints.** Threat arrow, weaker moves, live ratings,
   settings screen.
   *Done:* the threat check and the full arrow list are shared with the
   extension (`threatWorthShowing`, `hintArrows` in `core/hints/hintArrows.ts`),
   as are the rating icons (`core/draw/categoryIcons.ts`). The user's move is
   found by comparing the board before and after (`moveBetween` in
   `core/chess/position.ts`) and rated from the first usable depth, since
   bots reply fast; whether it was a book move is judged from the position
   reached only. While the bot thinks, the positions after its two likeliest
   replies are searched ahead, and the user's search carries on from there.
   The settings (`HintSettings.kt`) use the extension's names and defaults.
   Speed, measured on the phone: the board is read 0.1 s after the screen
   starts changing (and once more when it settles); first arrows 0-70 ms
   after that, instantly when the bot plays a move searched ahead. Whose turn
   it is follows from the board (one legal move on from the last position)
   before Chess.com's move list catches up; boards read mid-animation are
   ignored (`fenFromBoard` rejects impossible positions). Smoothness: two
   engines took the phone's two fast cores and the arrows lagged, so light
   mode (one engine, searches one after another) is on by default; arrows
   appear and leave without fades, and the overlay window uses the GPU.
   Chess.com only reports the board changing as a whole (reading it takes
   100-300 ms while it animates), but announces each move for screen readers
   the moment it is played ("Bílý Dáma z d1 na d4", `MoveAnnouncement.kt`);
   the overlay applies that move at once (arrows 10-20 ms later) and the board
   reads that follow check it. A board read while a piece is dragged (one
   piece missing) is ignored (`onePieceLifted`). Still not PC-smooth: Chess.com
   announces after its animation, Android delivers events a little late, and
   the overlay is a separate window, so it can't match the extension, which
   draws inside the page in the same frame.
   *Native drawing:* `core/draw/arrowDrawing.ts` describes every arrow
   (colour, strength, dashes, outline points, score pill, promotion tile);
   the extension's overlay draws it as SVG and the app's `OverlayView.kt`
   paints it with Android graphics, so look changes stay in one place. The
   WebView is hidden and only works out frames (`android/web/nativeLayer.ts`).
   Rating icons are the extension's SVG icons, turned into PNGs by the page
   once and painted as bitmaps (a round symbol badge until they are ready). A frame that can't be
   painted is skipped, never crashing the service. Drawing into Chess.com's
   own app would need root or a modified copy of it: not an option.
4. **Review.** Finished games from the public archive, with the analysis panel.
   *Done:* "Review finished games" on the main screen opens `ReviewActivity`, a
   WebView with `android/web/review.ts`: a Chess.com username (remembered),
   the standard games of the last two months (Load older games adds a month at a time), and the extension's
   `AnalysisPanel` full-screen over two lite engines at the analysis depth set on the main screen
   (12 by default). A bar on top has a back arrow and the game's players. The
   board (`#board` in `review.html`, Vektra's own flat pieces in `pieces.ts`,
   from the user's side, with coordinates) shows the position during and
   after the analysis, the move just played in yellow like Chess.com; ◀ ▶ step
   through the moves and a tap on the graph jumps there. Once analysed, the
   extension's `BoardOverlay` draws the move's rating badge and, unless it was
   the best or a book move, an arrow for the better move; **Line** adds the
   engine's line from there (three numbered arrows). No exports (the panel
   hides them without callbacks), no cache, portrait only. The main screen uses
   the extension's palette (`themes.xml`) with the settings in cards, including
   the extension's avoid-draws, hide-alternatives, threat, weaker-move and
   analysis-depth settings (not autoplay's).
5. **Releases.** APK in the release workflow, signing, the in-app updater.
   *Built, not yet released:* the release workflow builds the app with
   `npm run build:android-web` and `assembleRelease`, signed with the release
   key (kept in `E:\Vektra-signing`, outside the repository, and in the
   `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` secrets; the
   release fails without them), and attaches `vektra-<version>.apk` and its
   SHA-256 to the release. `app/build.gradle.kts` signs only when
   `VEKTRA_KEYSTORE` is set, so debug builds are unchanged. `AppUpdater.kt`:
   each time the main screen opens (unless "Check for updates" is off) it asks
   GitHub for the latest release; if it is newer, a card offers the update,
   which downloads the APK, checks the SHA-256 and hands it to
   `PackageInstaller`, which asks the user to confirm (the first time Android
   asks to allow Vektra to install apps). Debug builds are signed with another
   key, so the first release needs one uninstall. Also: a quick settings tile
   (`HintsTileService`) turns hints in bot games on and off.

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
