# Calibrating ratings against Chess.com

Planned for later. Vektra's move ratings and accuracy are tuned to land
close to Chess.com's Game Review. So far that tuning rests on three games
(in `docs/calibration/`); more games make it more trustworthy.

## Collecting games

For each game reviewed on Chess.com:

1. Download the PGN after Game Review. It carries Chess.com's ratings as
   NAGs: `$3` Brilliant, `$1` Great, `$6` Inaccuracy, `$2` Mistake,
   `$4` Blunder.
2. Add one header with the two accuracies from the review screen, White
   first: `[ChesscomAccuracy "78.2 84.9"]`.
3. Keep the players' ratings (`WhiteElo`, `BlackElo`); Chess.com's ratings
   seem to depend on them. Replace other people's usernames with
   `Opponent`.
4. Save it in `docs/calibration/` as `<date>-<opponent>.pgn`.

20-30 games, a mix of bot strengths and some decisive blunders, is the target.

## The plan

- A script that analyses every game in the folder (at depth 12, the
  default, and again at the full engine's depth) and saves the engine
  output, so refits don't rerun the engine.
- Refit against all of them: the accuracy constants (`ACCURACY.B`,
  `HARMONIC_FLOOR` in `src/analysis/config.ts`), then the category
  thresholds, scoring agreement on the moves Chess.com marks.
- Then try a rating-dependent win-chance curve: Chess.com gave the
  100-rated Pepe six Mistakes in a lost position where Vektra's curve has
  flattened out, and rated 29.Qc8+ (hanging the queen at about 10% to win)
  a Blunder where Vektra says Inaccuracy.
- A temporary sacrifice that wins the material back within a couple of
  moves (34.Rxd5 in the 1-minute game) is Brilliant to Vektra, not to
  Chess.com.

The calibration tools stay out of the extension: they live in `tests/tools`
and never ship, and users get the fitted constants with the code.

## Results so far (depth 12, lite engine)

| Game | Chess.com | Vektra |
| --- | --- | --- |
| Francis-BOT (2300) | 97.5 / 80.4 | 95.8 / 82.3 |
| Pepe-BOT (100) | 77.0 / 86.4 | 76.5 / 89.5 |
| 1-minute game (2050) | 78.2 / 84.9 | 75.9 / 83.0 |

Today one game at a time can be compared with:

```bash
PGN=docs/calibration/2026-10-31-francis.pgn DEPTH=12 npx vitest run tests/tools --silent=false
```
