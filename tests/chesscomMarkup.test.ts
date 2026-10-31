import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBoardState } from '../src/content/boardReader';
import { findMoveList, readMoveList } from '../src/content/moveList';
import { resolveScope } from '../src/content/pageScope';
import { fenAfter } from './fixtures/dom';

/** Markup captured from chess.com (logged out) on 2026-10-29. */
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures/chesscom', `${name}.html`), 'utf8');
const load = (...names: string[]) => (document.body.innerHTML = names.map(fixture).join(''));

describe('real chess.com markup', () => {
  it('/play/computer: game in progress', () => {
    load('computer-03-board', 'computer-03-movelist');
    const s = readBoardState()!;
    expect(s.source).toBe('replay');
    expect(s.ply).toBe(s.sans.length);
    expect(s.fen).toBe(fenAfter(s.sans));
    expect(resolveScope('/play/computer', document).status).toBe('enabled');
  });

  it('/play/computer: result row marks the game as over', () => {
    load('computer-04-movelist');
    const r = readMoveList(findMoveList()!);
    expect(r.sans).toEqual(['e4', 'e5', 'Nf3', 'Qf6', 'Bc4', 'Bc5']);
    expect(r.selectedPly).toBe(6);
    expect(resolveScope('/game/live/1', document).status).toBe('enabled');
  });

  it('/game/live: finished game is read and enabled', () => {
    load('game-live-board', 'game-live-movelist');
    const s = readBoardState()!;
    expect(s.sans.length).toBeGreaterThan(20);
    expect(s.source).toBe('replay');
    expect(s.fen).toBe(fenAfter(s.sans, s.ply));
    expect(resolveScope('/game/live/186167189226', document).status).toBe('enabled');
  });

  it('/game/live: in-progress game (no result row) is inactive', () => {
    load('computer-03-board', 'computer-03-movelist');
    expect(resolveScope('/game/live/1', document).status).toBe('inactive');
  });

  it('/analysis: last move selected (mate)', () => {
    load('analysis-03-board-mate', 'analysis-03-movelist-last-selected');
    const s = readBoardState()!;
    expect(s.sans).toEqual(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
    expect(s).toMatchObject({ ply: 7, source: 'replay', inVariation: false });
  });

  it('/analysis: position inside a variation', () => {
    load('analysis-04-board-variation', 'analysis-04-movelist-variation-selected');
    const s = readBoardState()!;
    expect(s.inVariation).toBe(true);
    expect(s.source).toBe('replay');
    expect(s.fen).toBe(fenAfter(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6']));
  });

  it('/analysis: flipped board', () => {
    load('analysis-05-board-flipped');
    expect(readBoardState()!.flipped).toBe(true);
  });
});
