import { describe, expect, it } from 'vitest';
import { classifyMove, isSacrifice, moveAccuracy, type MoveFacts } from '@core/analysis/classify';
import { CLASSIFICATION as C } from '@core/analysis/config';
import { classifyGame, gameOpening, summarize, type PositionEval } from '@core/analysis/gameAnalysis';
import { replay } from '@core/chess/replay';

const facts = (f: Partial<MoveFacts>): MoveFacts => ({
  winBefore: 50,
  winAfter: 50,
  isTopMove: false,
  forced: false,
  sacrifice: false,
  opponentErred: false,
  ...f,
});

describe('classifyMove by win % loss', () => {
  it.each([
    [0, true, 'best'],
    [0, false, 'excellent'],
    [C.EXCELLENT_MAX_LOSS, false, 'excellent'],
    [C.GOOD_MAX_LOSS, false, 'good'],
    [C.INACCURACY_MAX_LOSS, false, 'inaccuracy'],
    [C.MISTAKE_MAX_LOSS, false, 'mistake'],
    [C.MISTAKE_MAX_LOSS + 0.1, false, 'blunder'],
    [40, false, 'blunder'],
  ] as const)('loss %d (top move %s) -> %s', (loss, isTopMove, expected) => {
    expect(classifyMove(facts({ winBefore: 60, winAfter: 60 - loss, isTopMove }))).toBe(expected);
  });

  it('an equally good alternative to the top move is best', () => {
    expect(classifyMove(facts({ equalAlternative: true }))).toBe('best');
    expect(classifyMove(facts({ equalAlternative: false }))).toBe('excellent');
  });

  it('book moves', () => {
    expect(classifyMove(facts({ book: true, winAfter: 40 }))).toBe('book');
  });

  it('a forced move is best', () => {
    expect(classifyMove(facts({ forced: true, winAfter: 10 }))).toBe('best');
  });

  it('brilliant: a sound sacrifice when the game is not decided', () => {
    expect(classifyMove(facts({ sacrifice: true, isTopMove: true, winBefore: 55, winAfter: 56 }))).toBe('brilliant');
    // Completely decided already: just best.
    expect(classifyMove(facts({ sacrifice: true, isTopMove: true, winBefore: 99, winAfter: 99 }))).toBe('best');
    // A forced mate (rated below 98%) where another move wins outright too:
    // giving material up there decides nothing.
    expect(classifyMove(facts({ sacrifice: true, isTopMove: true, winBefore: 88, winAfter: 90, wonEitherWay: true }))).toBe('best');
    // Unsound sacrifice: judged by its loss.
    expect(classifyMove(facts({ sacrifice: true, winBefore: 55, winAfter: 20 }))).toBe('blunder');
  });

  it('great: the only good move', () => {
    expect(classifyMove(facts({ isTopMove: true, winBefore: 55, winAfter: 55, winSecondBest: 30 }))).toBe('great');
    expect(classifyMove(facts({ isTopMove: true, winBefore: 55, winAfter: 55, winSecondBest: 50 }))).toBe('best');
  });

  it('not great for taking back the piece that was just moved', () => {
    expect(
      classifyMove(facts({ isTopMove: true, winBefore: 55, winAfter: 55, winSecondBest: 10, recapture: true })),
    ).toBe('best');
  });

  it('miss: failing to punish the opponent error', () => {
    const f = { winBefore: 80, winAfter: 60, opponentErred: true };
    expect(classifyMove(facts(f))).toBe('miss');
    expect(classifyMove(facts({ ...f, opponentErred: false }))).toBe('mistake');
    // However much it gives back, as chess.com rates not taking a hung queen.
    expect(classifyMove(facts({ ...f, winAfter: 20 }))).toBe('miss');
    // From a position that wasn't good, it is judged by its loss.
    expect(classifyMove(facts({ ...f, winBefore: 50, winAfter: 20 }))).toBe('blunder');
  });
});

describe('isSacrifice', () => {
  it('a bishop taking a pawn next to the king, where it can be taken', () => {
    // Italian: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6, then Bxf7+ is a classic bishop sacrifice.
    const { fens } = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
    expect(isSacrifice(fens[6], 'c4f7')).toBe(true);
  });

  it('not a trade, a quiet move, or a pawn', () => {
    const { fens } = replay(['e4', 'd5']);
    expect(isSacrifice(fens[2], 'e4d5')).toBe(false); // pawn takes pawn
    expect(isSacrifice(fens[0], 'g1f3')).toBe(false);
    const qxq = replay(['e4', 'e5', 'Qh5', 'Qh4', 'Qxh4']);
    expect(qxq.failedAt).toBeNull();
    expect(isSacrifice(qxq.fens[4], 'h5h4')).toBe(false);
  });

  it('a piece left on a square attacked by a pawn', () => {
    const { fens } = replay(['e4', 'e5']);
    expect(isSacrifice(fens[2], 'g1f3')).toBe(false); // safe square
    const { fens: f2 } = replay(['d4', 'e5']);
    expect(isSacrifice(f2[2], 'c1f4')).toBe(true); // exf4 wins the bishop
  });

  it('ignores attackers that are pinned', () => {
    // The d7 pawn is pinned to the king by Bb5, so it can't take on e6.
    expect(isSacrifice('4k3/3p4/8/1B4N1/8/8/8/6K1 w - - 0 1', 'g5e6')).toBe(false);
  });

  it('counts recaptures, so a piece that is won back is not sacrificed', () => {
    // Nxd5: Rxd5 Rxd5 would lose Black the exchange, so the knight is safe.
    expect(isSacrifice('3rk3/8/8/3p4/8/2N5/8/3RK3 w - - 0 1', 'c3d5')).toBe(false);
  });

  it('a piece newly left where it can be taken (ignoring a threat)', () => {
    // e5 stops defending the knight, so Rxd5 wins it.
    expect(isSacrifice('3rk3/8/8/3N4/4P3/8/8/6K1 w - - 0 1', 'e4e5')).toBe(true);
  });

  it('a piece that was already attacked and is left there rather than saved', () => {
    // exd5 can win the knight, which could step away; the king move leaves it.
    expect(isSacrifice('4k3/8/4p3/3N4/8/8/8/6K1 w - - 0 1', 'g1g2')).toBe(true);
    // From a game chess.com rated Brilliant: Bxc4 leaves the c3 knight to
    // b4xc3, a knight for two pawns, when Nb5 or Ne4 would have saved it.
    const { fens } = replay([
      'e3', 'e5', 'd4', 'exd4', 'exd4', 'Qe7+', 'Be2', 'd5', 'Nf3', 'Nf6',
      'c4', 'dxc4', 'Nc3', 'b5', 'O-O', 'a6', 'a4', 'b4',
    ]);
    expect(isSacrifice(fens[18], 'e2c4')).toBe(true);
  });

  it('not a piece that no move could save', () => {
    // The knight on a8 is lost whatever White plays: Be4 attacks it, and
    // a7 and the king cover its only squares.
    expect(isSacrifice('N2k4/p7/8/8/4b3/8/8/7K w - - 0 1', 'h1h2')).toBe(false);
    expect(isSacrifice('N2k4/p7/8/8/4b3/8/8/7K w - - 0 1', 'a8b6')).toBe(false);
  });

  it('not a free pawn taken', () => {
    // Nothing can take the knight on e5, so it gives nothing up.
    expect(isSacrifice('4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1', 'f3e5')).toBe(false);
  });

  it('an exchange sacrifice', () => {
    // Rxc6 bxc6: a rook for a knight.
    expect(isSacrifice('4k3/1p6/2n5/8/8/8/8/2R1K3 w - - 0 1', 'c1c6')).toBe(true);
  });
});

describe('accuracy', () => {
  it('is ~100 for no loss and falls with loss', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(2));
    expect(moveAccuracy(100)).toBe(0);
  });
});

describe('classifyGame', () => {
  const pos = (fen: string, cp: number, best: string): PositionEval => ({
    fen,
    score: { type: 'cp', value: cp },
    lines: [{ multipv: 1, depth: 10, score: { type: 'cp', value: fen.includes(' w ') ? cp : -cp }, pv: [best] }],
  });

  it('marks opening moves as book, then uses the next position eval for the move played', () => {
    const sans = ['e4', 'e5', 'Qh5', 'Ke7'];
    const { fens, uci } = replay(sans);
    const positions = [
      pos(fens[0], 30, 'e2e4'),
      pos(fens[1], 30, 'e7e5'),
      pos(fens[2], 30, 'g1f3'),
      pos(fens[3], 0, 'b8c6'),
      pos(fens[4], 600, 'h5e5'),
    ];
    const moves = classifyGame(sans, uci, positions);
    expect(moves.map((m) => m.category).slice(0, 3)).toEqual(['book', 'book', 'book']);
    // Ke7 drops Black from 50% to ~10%.
    expect(moves[3]).toMatchObject({ color: 'b', category: 'blunder', bestSan: 'Nc6' });
    expect(gameOpening(positions, moves)).toMatch(/^C20 /);
    const sum = summarize(moves);
    expect(sum.w.counts.book).toBe(2);
    expect(sum.b.counts.blunder).toBe(1);
    expect(sum.w.accuracy).toBeGreaterThan(sum.b.accuracy);
  });

  it('book stops at the first move out of the book', () => {
    const sans = ['e4', 'e5', 'Qh5', 'Ke7', 'Qxe5#'];
    const { fens, uci, failedAt } = replay(sans);
    expect(failedAt).toBeNull();
    const positions = fens.map((f) => pos(f, 0, 'a2a3'));
    const cats = classifyGame(sans, uci, positions).map((m) => m.category);
    expect(cats.slice(0, 3)).toEqual(['book', 'book', 'book']);
    expect(cats.slice(3)).not.toContain('book');
  });
});

describe('recaptures', () => {
  it('rates taking back a piece as best, not great, even as the only good move', async () => {
    const { analyzeMove } = await import('@core/analysis/moveAnalysis');
    const line = (uci: string, multipv: number, value: number) => ({
      multipv,
      depth: 12,
      score: { type: 'cp' as const, value },
      pv: [uci],
    });
    // 1.e4 d5 2.exd5: Black takes back with the queen; anything else is a pawn down.
    const beforeFen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    const afterFen = 'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3';
    const before = { fen: beforeFen, score: { type: 'cp' as const, value: 0 }, lines: [line('d8d5', 1, 0), line('g8f6', 2, -300)] };
    const after = { fen: afterFen, score: { type: 'cp' as const, value: 0 }, lines: [line('b1c3', 1, 0)] };
    const move = { ply: 4, san: 'Qxd5', uci: 'd8d5' };
    expect(analyzeMove(before, after, move, { book: false }).category).toBe('great');
    expect(analyzeMove(before, after, move, { book: false, previousUci: 'e4d5' }).category).toBe('best');
  });
});
