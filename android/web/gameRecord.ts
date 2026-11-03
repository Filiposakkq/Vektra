import { moveBetween } from '@core/chess/position';

/** The starting position's pieces. */
export const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/**
 * A bot game, move by move from the starting position, built from the
 * positions the overlay shows, so the app can review it afterwards:
 * Chess.com's public archive has no bot games. `fens[i]` is the position
 * after `sans[i - 1]`.
 */
export class GameRecord {
  sans: string[] = [];
  fens: string[] = [];
  flipped = false;

  /** Adds a position shown; true if the game changed. Before a starting position, nothing is kept. */
  add(fen: string, flipped: boolean): boolean {
    const [board, turn] = fen.split(' ');
    if (this.fens.length) {
      // A move taken back (yours, or yours and the bot's): back to that position.
      // Only the last two count; a position repeated from earlier is a new move.
      const key = (f: string) => f.split(' ').slice(0, 2).join(' ');
      const back = this.fens.findIndex((f, i) => i >= this.fens.length - 3 && key(f) === key(fen));
      if (back === this.fens.length - 1) return false;
      if (back >= 0) {
        this.fens.length = back + 1;
        this.sans.length = back;
        // Back at the start, this may be a new game, with the other colour.
        this.flipped = flipped;
        return true;
      }
      // One move on, even back to the starting position (knights out and home again).
      const move = moveBetween(this.fens[this.fens.length - 1], board);
      if (move) {
        this.sans.push(move.san);
        this.fens.push(fen);
        return true;
      }
    }
    if (board === START_BOARD && turn === 'w') {
      this.sans = [];
      this.fens = [fen];
      this.flipped = flipped;
      return true;
    }
    // shortcut: a position that isn't one move on is skipped, so a missed move ends the record there; fine while every move is announced.
    return false;
  }
}
