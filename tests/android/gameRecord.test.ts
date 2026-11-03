import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { fenFromBoard } from '@core/chess/position';
import { GameRecord } from '../../android/web/gameRecord';

/** The positions the overlay shows along a game: rebuilt from the board, as the app reads it. */
function positions(sans: string[]): string[] {
  const chess = new Chess();
  const fens = [fenFromBoard(chess.fen().split(' ')[0], 'w')!];
  for (const san of sans) {
    chess.move(san);
    fens.push(fenFromBoard(chess.fen().split(' ')[0], chess.turn())!);
  }
  return fens;
}

describe('GameRecord', () => {
  it('records a game from its starting position', () => {
    const game = new GameRecord();
    for (const fen of positions(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])) game.add(fen, true);
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(game.flipped).toBe(true);
  });

  it('keeps nothing until a starting position is seen', () => {
    const game = new GameRecord();
    const fens = positions(['e4', 'e5']);
    expect(game.add(fens[2], false)).toBe(false);
    expect(game.sans).toEqual([]);
  });

  it('follows a takeback of one or two moves', () => {
    const fens = positions(['e4', 'e5', 'Nf3', 'Nc6']);
    const game = new GameRecord();
    for (const fen of fens) game.add(fen, false);
    // Back before Nf3 (and the bot's Nc6), then a different move.
    game.add(fens[2], false);
    expect(game.sans).toEqual(['e4', 'e5']);
    game.add(positions(['e4', 'e5', 'Bc4'])[3], false);
    expect(game.sans).toEqual(['e4', 'e5', 'Bc4']);
  });

  it('takes a position repeated from earlier as new moves, not a takeback', () => {
    const sans = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'];
    const game = new GameRecord();
    for (const fen of positions(sans)) game.add(fen, false);
    expect(game.sans).toEqual(sans);
  });

  it('starts again at a new game', () => {
    const game = new GameRecord();
    for (const fen of positions(['d4', 'd5'])) game.add(fen, false);
    for (const fen of positions(['e4'])) game.add(fen, true);
    expect(game.sans).toEqual(['e4']);
    expect(game.flipped).toBe(true);
  });
});
