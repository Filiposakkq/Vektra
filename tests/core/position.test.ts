import { describe, expect, it } from 'vitest';
import { fenFromBoard, moveBetween } from '@core/chess/position';

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

  it('refuses boards read mid-animation', () => {
    // Read on the phone while ...e5 was moving: the pawn on e6 and e5 at once.
    expect(fenFromBoard('rnb1kbnr/pppp1ppp/4pq2/4p3/3PP3/2N5/PPP2PPP/R1BQKBNR', 'w')).toBeNull();
    // A pawn on the last rank, two white kings, three knights with all pawns left.
    expect(fenFromBoard('rnbqkbnP/ppppppp1/8/8/8/8/PPPPPPP1/RNBQKBNR', 'b')).toBeNull();
    expect(fenFromBoard('rnbqkbnr/pppppppp/8/8/8/4K3/PPPPPPPP/RNBQKBNR', 'w')).toBeNull();
    expect(fenFromBoard('rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/RNBQKBNR', 'w')).toBeNull();
    // A promoted queen is fine when a pawn is missing.
    expect(fenFromBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKQNR', 'w')).not.toBeNull();
  });

  it('refuses a position where the side that just moved is in check', () => {
    // White to move, but Black's king is attacked by the queen on e2.
    expect(fenFromBoard('4k3/8/8/8/8/8/4Q3/4K3', 'w')).toBeNull();
    expect(fenFromBoard('4k3/8/8/8/8/8/4Q3/4K3', 'b')).toBe('4k3/8/8/8/8/8/4Q3/4K3 b - - 0 1');
  });
});

describe('the move between two positions', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('finds the move played', () => {
    expect(moveBetween(start, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR')).toEqual({ uci: 'e2e4', san: 'e4' });
    // From the phone: White's 10.Bxd2 after ...exd2+.
    expect(
      moveBetween('r2qk1nr/pppbbppp/2n5/3p4/8/1PP3PB/P1Np3P/R1BQK2R w KQkq - 0 1', 'r2qk1nr/pppbbppp/2n5/3p4/8/1PP3PB/P1NB3P/R2QK2R'),
    ).toEqual({ uci: 'c1d2', san: 'Bxd2' });
  });

  it('knows castling and promotion', () => {
    expect(moveBetween('4k3/8/8/8/8/8/8/4K2R w K - 0 1', '4k3/8/8/8/8/8/8/5RK1')).toEqual({ uci: 'e1g1', san: 'O-O' });
    expect(moveBetween('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'N3k3/8/8/8/8/8/8/4K3')).toEqual({ uci: 'a7a8n', san: 'a8=N' });
  });

  it('is null when no single move explains the change', () => {
    expect(moveBetween(start, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR')).toBeNull();
    expect(moveBetween(start, start.split(' ')[0])).toBeNull();
  });
});
