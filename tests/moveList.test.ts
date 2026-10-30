import { describe, expect, it } from 'vitest';
import { findMoveList, normalizeSan, readMoveList } from '../src/content/moveList';
import { readBoardState } from '../src/content/boardReader';
import { boardHtml, fenAfter, moveListHtml } from './fixtures/dom';

describe('normalizeSan', () => {
  it.each([
    ['e4', 'e4'],
    [' Nf3 ', 'Nf3'],
    ['♘f3', 'Nf3'],
    ['♛xh7#', 'Qxh7#'],
    ['0-0-0', 'O-O-O'],
    ['O-O+', 'O-O+'],
    ['exd8=Q+', 'exd8=Q+'],
    ['e5!?', 'e5'],
    ['12.Rfe1', 'Rfe1'],
  ])('%s -> %s', (raw, san) => expect(normalizeSan(raw)).toBe(san));

  it.each([
    ['fxg8=D', 'cs', 'fxg8=Q'],
    ['e8=V+', 'cs', 'e8=R+'],
    ['a1=S', 'cs', 'a1=B'],
    ['a1=S', 'de', 'a1=N'],
    ['b8=J#', 'cs', 'b8=N#'],
    ['h8=D', 'en', 'h8=Q'],
    ['exd8=Q+', 'cs', 'exd8=Q+'],
    ['e8=Ф', 'ru', 'e8=Q'],
  ])('localised promotion %s (%s) -> %s', (raw, lang, san) => expect(normalizeSan(raw, lang)).toBe(san));

  it.each(['1-0', '0-1', '1/2-1/2', '', 'Game Review'])('rejects %j', (raw) =>
    expect(normalizeSan(raw)).toBeNull(),
  );
});

describe('readMoveList', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'];

  it('reads SAN including figurine icons, and the selected ply', () => {
    document.body.innerHTML = moveListHtml(sans, { selected: 4 });
    expect(readMoveList(findMoveList()!)).toEqual({
      sans,
      selectedPly: 4,
      selectedPath: sans.slice(0, 4),
      selectedColor: 'b',
    });
  });

  it('reads promotions written with a figurine', () => {
    const promo = ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Bf5', 'bxa8=Q'];
    document.body.innerHTML = moveListHtml(promo);
    expect(readMoveList(findMoveList()!).sans).toEqual(promo);
  });

  it('skips the result and reports no selection', () => {
    document.body.innerHTML = moveListHtml(sans, { selected: null, result: '1-0' });
    expect(readMoveList(findMoveList()!)).toEqual({
      sans,
      selectedPly: null,
      selectedPath: null,
      selectedColor: null,
    });
  });
});

describe('findMoveList', () => {
  it('picks the list with moves when the page also has an empty one', () => {
    document.body.innerHTML = moveListHtml([]) + moveListHtml(['e4', 'e5', 'Nf3']);
    const board = document.createElement('div');
    board.id = 'board-single';
    expect(readMoveList(findMoveList(document, board)!).sans).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('reads figurine icons that only carry the piece in their class', () => {
    document.body.innerHTML = moveListHtml(['e4', 'e5', 'f3']).replace(
      '>f3',
      '><span class="icon-font-chess knight-white"></span>f3',
    );
    expect(readMoveList(findMoveList(document)!).sans).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('readBoardState', () => {
  const sans = ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'];

  it('combines board and move list into a full FEN', () => {
    document.body.innerHTML = boardHtml(fenAfter(sans), { flipped: true }) + moveListHtml(sans);
    const s = readBoardState()!;
    expect(s.fen).toBe(fenAfter(sans));
    expect(s.flipped).toBe(true);
    expect(s.source).toBe('replay');
    expect(s.sans).toEqual(sans);
  });

  it('reads a game with a promotion written in another language', () => {
    const game = ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6', 'bxa8=N', 'e6', 'Nc7+'];
    // As a Polish page would show it: knight is "S", which other languages use for a bishop.
    const list = moveListHtml(game).replace(/=<span[^>]*data-figurine="N"[^>]*><\/span>/, '=S');
    document.documentElement.lang = 'xx';
    document.body.innerHTML = boardHtml(fenAfter(game)) + list;
    const s = readBoardState()!;
    document.documentElement.lang = '';
    expect(s.sans).toEqual(game);
    expect(s.fen).toBe(fenAfter(game));
    expect(s.source).toBe('replay');
  });

  it('returns null without a board', () => {
    document.body.innerHTML = moveListHtml(sans);
    expect(readBoardState()).toBeNull();
  });
});

describe('watchBoard', () => {
  it('updates when Chess.com replaces the board with an identical starting position', async () => {
    const { watchBoard } = await import('../src/content/boardReader');
    const sans = ['e4', 'e5'];
    const markup = boardHtml(fenAfter(sans)) + moveListHtml(sans);
    document.body.innerHTML = markup;
    const seen: HTMLElement[] = [];
    const stop = watchBoard((state) => state && seen.push(state.board), { debounceMs: 5 });
    expect(seen).toHaveLength(1);

    document.body.innerHTML = markup;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
    stop();
  });

  it('updates when the move list changes without changing the displayed ply', async () => {
    const { watchBoard } = await import('../src/content/boardReader');
    const firstGame = ['e4', 'e5'];
    const secondGame = ['d4', 'd5'];
    document.body.innerHTML = boardHtml(fenAfter(firstGame)) + moveListHtml(firstGame);
    const seen: string[][] = [];
    const stop = watchBoard((state) => state && seen.push(state.sans), { debounceMs: 5 });
    expect(seen).toEqual([firstGame]);

    document.querySelector('.move-list')!.outerHTML = moveListHtml(secondGame);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(seen).toEqual([firstGame, secondGame]);
    stop();
  });

  it('ignores the board while a piece is held and reads it on release', async () => {
    const { watchBoard } = await import('../src/content/boardReader');
    const sans = ['e4', 'e5'];
    document.body.innerHTML = boardHtml(fenAfter(sans)) + moveListHtml(sans);
    const seen: string[] = [];
    const stop = watchBoard((s) => s && seen.push(s.fen), { debounceMs: 5 });
    expect(seen).toEqual([fenAfter(sans)]);

    const piece = document.querySelector('.square-71')!; // g1 knight
    piece.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    piece.classList.replace('square-71', 'square-63'); // dragged over f3
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toHaveLength(1);

    // Dropped back on g1: same position, no new reading.
    piece.classList.replace('square-63', 'square-71');
    document.dispatchEvent(new Event('pointerup'));
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toHaveLength(1);
    stop();
  });
});
