import { describe, expect, it } from 'vitest';
import { classifyMove, isSacrifice, moveAccuracy, type MoveFacts } from '../src/analysis/classify';
import { CLASSIFICATION as C } from '../src/analysis/config';
import { classifyGame, gameOpening, summarize, type PositionEval } from '../src/analysis/gameAnalysis';
import { replay } from '../src/content/fen';

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
    // Unsound sacrifice: judged by its loss.
    expect(classifyMove(facts({ sacrifice: true, winBefore: 55, winAfter: 20 }))).toBe('blunder');
  });

  it('great: the only good move', () => {
    expect(classifyMove(facts({ isTopMove: true, winBefore: 55, winAfter: 55, winSecondBest: 30 }))).toBe('great');
    expect(classifyMove(facts({ isTopMove: true, winBefore: 55, winAfter: 55, winSecondBest: 50 }))).toBe('best');
  });

  it('miss: failing to punish the opponent error', () => {
    const f = { winBefore: 80, winAfter: 60, opponentErred: true };
    expect(classifyMove(facts(f))).toBe('miss');
    expect(classifyMove(facts({ ...f, opponentErred: false }))).toBe('mistake');
    // Throwing the game away is still a blunder.
    expect(classifyMove(facts({ ...f, winAfter: 20 }))).toBe('blunder');
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

  it('a piece left where it can be taken (ignoring a threat)', () => {
    // exd5 wins the knight after the quiet king move.
    expect(isSacrifice('4k3/8/4p3/3N4/8/8/8/6K1 w - - 0 1', 'g1g2')).toBe(true);
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
