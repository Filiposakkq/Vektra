import { describe, expect, it } from 'vitest';
import { fenFromBoard } from '@core/chess/position';

describe('a FEN from the pieces alone', () => {
  it('gives the start position its castling rights', () => {
    expect(fenFromBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'w')).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
  });

  it('keeps castling only where king and rook are still at home', () => {
    // Read from the Chess.com app on a phone: Black to move after 9.Bh3.
    expect(fenFromBoard('r2qk1nr/pppbbppp/2n5/3p4/8/1PP1p1PB/P1NP3P/R1BQK2R', 'b')).toBe(
      'r2qk1nr/pppbbppp/2n5/3p4/8/1PP1p1PB/P1NP3P/R1BQK2R b KQkq - 0 1',
    );
    expect(fenFromBoard('r3k2r/8/8/8/8/8/8/1R2K1R1', 'w')).toBe('r3k2r/8/8/8/8/8/8/1R2K1R1 w kq - 0 1');
    expect(fenFromBoard('4k3/8/8/8/8/8/8/4K3', 'w')).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  });

  it('refuses a position that is not legal', () => {
    expect(fenFromBoard('8/8/8/8/8/8/8/8', 'w')).toBeNull();
    expect(fenFromBoard('rnbqkbnr/pppppppp/8/8', 'w')).toBeNull();
  });
});
