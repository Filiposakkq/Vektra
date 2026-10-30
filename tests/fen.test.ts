import { describe, expect, it } from 'vitest';
import { DEFAULT_POSITION } from 'chess.js';
import { parsePieceClasses, placementToFenBoard, readPlacement, type Placement } from '../src/content/boardDom';
import { fenFromPlacement, replay, resolvePosition, settlePromotions } from '../src/content/fen';
import { boardHtml, fenAfter } from './fixtures/dom';

function placementOf(fen: string): Placement {
  document.body.innerHTML = boardHtml(fen);
  return readPlacement(document.querySelector('wc-chess-board')!);
}

describe('board DOM parsing', () => {
  it('maps square-XY classes to algebraic squares', () => {
    expect(parsePieceClasses(['piece', 'wp', 'square-52'])).toEqual(['e2', 'wp']);
    expect(parsePieceClasses(['piece', 'square-18', 'br'])).toEqual(['a8', 'br']);
    expect(parsePieceClasses(['piece', 'square-88', 'bk'])).toEqual(['h8', 'bk']);
    expect(parsePieceClasses(['highlight', 'square-52'])).toBeNull();
  });

  it('round-trips the start position', () => {
    expect(placementToFenBoard(placementOf(DEFAULT_POSITION))).toBe(DEFAULT_POSITION.split(' ')[0]);
  });

  it('reads the same placement when the board is flipped', () => {
    document.body.innerHTML = boardHtml(DEFAULT_POSITION, { flipped: true });
    const p = readPlacement(document.querySelector('wc-chess-board')!);
    expect(placementToFenBoard(p)).toBe(DEFAULT_POSITION.split(' ')[0]);
  });

  it('ignores a piece being dragged', () => {
    document.body.innerHTML = boardHtml(DEFAULT_POSITION);
    document.querySelector('.square-52')!.classList.add('dragging');
    expect(readPlacement(document.querySelector('wc-chess-board')!).has('e2')).toBe(false);
  });
});

describe('replay', () => {
  it('produces side to move, castling and en passant', () => {
    const { fens, failedAt } = replay(['e4', 'c5', 'e5', 'd5']);
    expect(failedAt).toBeNull();
    expect(fens[4]).toBe('rnbqkbnr/pp2pppp/8/2ppP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  });

  it('loses castling rights after a king move', () => {
    const { fens } = replay(['e4', 'e5', 'Ke2', 'Ke7']);
    expect(fens[4].split(' ')[2]).toBe('-');
  });

  it('handles castling and promotion and gives UCI moves', () => {
    const sans = ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Bf5', 'bxa8=Q'];
    const r = replay(sans);
    expect(r.failedAt).toBeNull();
    expect(r.uci.at(-1)).toBe('b7a8q');
    expect(r.fens.at(-1)!.split(' ')[0]).toBe('Qn1qkb1r/p3pppp/5n2/5b2/8/8/PPPP1PPP/RNBQKBNR');

    const castle = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
    expect(castle.uci.at(-1)).toBe('e1g1');
    expect(castle.fens.at(-1)!.split(' ').slice(1, 3)).toEqual(['b', 'kq']);
  });

  it('accepts chess.com style SAN without "=" for promotion', () => {
    const r = replay(['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Bf5', 'bxa8Q']);
    expect(r.failedAt).toBeNull();
  });

  it('reports the first illegal move', () => {
    expect(replay(['e4', 'e5', 'Ke3']).failedAt).toBe(2);
  });
});

describe('resolvePosition', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];

  it('uses the replayed FEN when the board matches the selected ply', () => {
    const r = resolvePosition({ sans, placement: placementOf(fenAfter(sans)), selectedPly: 6 });
    expect(r).toEqual({ fen: fenAfter(sans), ply: 6, source: 'replay' });
  });

  it('follows the user navigating back through the moves', () => {
    const r = resolvePosition({ sans, placement: placementOf(fenAfter(sans, 3)), selectedPly: 3 });
    expect(r?.ply).toBe(3);
    expect(r?.fen.split(' ')[1]).toBe('b');
  });

  it('finds the shown ply from the board when the selection is missing or stale', () => {
    expect(resolvePosition({ sans, placement: placementOf(fenAfter(sans, 2)), selectedPly: null })?.ply).toBe(2);
    // Board already shows the new move, move list still marks the old one.
    expect(resolvePosition({ sans, placement: placementOf(fenAfter(sans, 6)), selectedPly: 5 })?.ply).toBe(6);
  });

  it('shows the start position at ply 0', () => {
    const r = resolvePosition({ sans, placement: placementOf(DEFAULT_POSITION), selectedPly: null });
    expect(r).toEqual({ fen: DEFAULT_POSITION, ply: 0, source: 'replay' });
  });

  it('keeps the position while a piece is lifted for dragging', () => {
    const p = placementOf(fenAfter(sans));
    p.delete('b5'); // the white bishop is in the user's hand
    expect(resolvePosition({ sans, placement: p, selectedPly: 6 })).toEqual({
      fen: fenAfter(sans),
      ply: 6,
      source: 'replay',
    });
  });

  it('falls back to the board when the move list does not match (e.g. custom start)', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const r = resolvePosition({ sans: [], placement: placementOf(fen), selectedPly: null });
    expect(r).toEqual({ fen, ply: 0, source: 'dom' });
  });

  it('replays from a custom start FEN', () => {
    const start = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const r = resolvePosition({ sans: ['a8=Q+'], placement: null, selectedPly: 1, startFen: start });
    expect(r?.fen).toBe('Q3k3/8/8/8/8/8/8/4K3 b - - 0 1');
  });
});

describe('fenFromPlacement', () => {
  it('infers castling from home squares', () => {
    expect(fenFromPlacement(placementOf('r3k3/8/8/8/8/8/8/4K2R w - - 0 1'), 'b')).toBe(
      'r3k3/8/8/8/8/8/8/4K2R b Kq - 0 1',
    );
  });

  it('rejects impossible positions', () => {
    expect(fenFromPlacement(new Map([['e1', 'wk']]), 'w')).toBeNull();
  });
});

describe('settlePromotions', () => {
  // 5.bxa8 promotes; the language decides the letter shown.
  const start = ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6', 'bxa8=Q', 'e6'];

  it('keeps a guess that fits', () => {
    expect(settlePromotions([...start, 'Qxc6'])).toEqual([...start, 'Qxc6']);
  });

  it('picks the piece later moves need, whatever the letter said', () => {
    // Only a knight on a8 can play Nc7.
    expect(settlePromotions([...start, 'Nc7'])[8]).toBe('bxa8=N');
  });

  it('uses the board when later moves do not decide', () => {
    const asRook = replay([...start.slice(0, 8), 'bxa8=R']).fens.at(-1)!.split(' ')[0];
    expect(settlePromotions(start, { ply: 9, boardFen: asRook })[8]).toBe('bxa8=R');
  });
});

