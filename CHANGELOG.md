<div align="center">

<img src="docs/images/vektra-logo.svg" width="96" alt="Vektra">

# Changelog

Every Vektra release, newest first: the Chrome extension and the Android app ship together, with one version number.

[Latest release](https://github.com/Filiposakkq/Vektra/releases/latest) · [How to release](docs/RELEASING.md)

</div>

<!--
  How this file works (docs/RELEASING.md has the whole story):
  - Write what changed under "Unreleased" as you go, in the sections below it.
    Delete a section that stays empty.
  - `npm run release -- 0.4.1` turns "Unreleased" into "0.4.1", dated today,
    puts a fresh empty "Unreleased" back, and publishes the release. Its notes
    on GitHub are that version's section from this file.
-->

## Unreleased

> **The Android app, rebuilt.** A modern, fully native app with a new look, your last game on a real board, and the whole game review native too.

### ✨ New

- **A new look for the whole app.** A deep night theme, gold from the new logo for the main actions, the engine's blue for arrows, big rounded cards, pill buttons and proper icons, with a bottom bar for **Home**, **Review** and **Settings**.
- **A new logo and app icon:** a white knight with a gold mane.
- **Home shows your last game** on a real board at its final position, with the opening's name, ready to analyse in one tap. It also tells you whether Vektra is ready, with **Open Chess.com**, and when something is wrong, the one thing to fix.
- **Review your last bot game.** Chess.com's archive has no bot games, so Vektra records the bot game you play, from its first move, takebacks included.
- **A native game review:** the board with the move played, its rating badge and the better move, a strip of moves with their ratings, swipes and gliding pieces, each side's accuracy and game rating, a win-chance graph you can tap, the move's verdict, phases and ratings. **Line** shows the engine's best line.
- **Real chess pieces:** the classic *cburnett* set, also used by Lichess and Wikipedia.
- **Settings grouped by what belongs together.** A setting that only matters while a switch is on sits under it; **Strength** is either the full engine or an Elo; analysis depth is Quick, Normal or Deep.
- **What's new** links on the home screen and the update card.

### 🎨 Improved

- **No more lag after the bot's move:** Vektra doesn't check the board while it's your turn, so your moves, king captures included, come through at once.
- **The game list** shows 50 games at a time, then older months on request.
- Numbers and times are written in English everywhere (87.9%, "2 hours ago").

### 🐛 Fixed

- A game's analysis no longer hides under its board.
- Opening names drop their ECO code ("Nimzowitsch Defense", not "B00 Nimzowitsch Defense").

---

## 0.3.1 · 2026-11-03

> Quieter where Chess.com already helps, quicker castling.

### ✨ New

- **Coach games:** Vektra stays off, since Chess.com shows its own arrows, move feedback and eval bar there.
- **Help only when something is wrong:** the app explains a switched-off or stopped service, or battery saving that can stop it, with steps for Xiaomi and other phones.
- An install guide for the Android app in the README.

### 🎨 Improved

- **Castling** is read from Chess.com's announcement instead of waiting for the board.
- CI builds and tests the Android app on every push.
- The quick settings tile was removed.

---

## 0.3.0 · 2026-11-03

> **The first Android app.** Vektra's hints over the Chess.com app, in bot games only.

### ✨ New

- **Hints in Chess.com bot games** on Android: best-move arrows with scores, the bot's threats, an optional weaker move, an eval strip, and a rating of each of your moves, drawn natively over the board.
- **Review finished games** from Chess.com's public archive: accuracy, game rating, phases and every move rated.
- **Settings** for arrows, threats, weaker moves, strength, light mode and more.
- **Signed APK releases and an in-app updater:** a new version installs over the app with your confirmation.
- The extension and the app share their chess rules (`core/`), so a change reaches both.

---

## 0.2.4 · 2026-11-01

### 🎨 Improved

- The updater helper installs one update at a time.

## 0.2.3 · 2026-11-01

### 🎨 Improved

- After an update, open Chess.com tabs are asked to reload, and Vektra says once that it was updated.

## 0.2.2 · 2026-11-01

### 🎨 Improved

- Updates are checked at once on start, on reload and when the check is switched back on.

## 0.2.1 · 2026-11-01

### 🎨 Improved

- The toolbar button greys out away from Chess.com.
- The updater helper works with Brave and Edge.

## 0.2.0 · 2026-11-01

> The first release with automatic updates.

### ✨ New

- **Updates from GitHub releases**, by the updater helper or by hand.
- **Why a move was bad**, game ratings, phase grades and a legend in the game analysis.
- **Accuracy and Miss** fitted to Chess.com's Game Review; sacrifices rated like Chess.com.
- **Threats, step-by-step hints and weaker moves**, avoid draws, review after bot games, light mode.
- Hints, ratings and autoplay limited to bot games.

### 🎨 Improved

- Steadier arrows, square tints, redesigned badges, eval bar and settings; hint searches on parallel engines.
