import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPage } from '../src/content/pageHealth';
import { NOT_RUNNING_TEXT, pageHealthText } from '../src/shared/pageHealth';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures/chesscom', `${name}.html`), 'utf8');
const load = (...names: string[]) => (document.body.innerHTML = names.map(fixture).join(''));

describe('checkPage', () => {
  it('finds nothing wrong in a bot game it can read', () => {
    load('computer-03-board', 'computer-03-movelist');
    expect(checkPage('/play/computer')).toEqual([]);
  });

  it('reports a missing board', () => {
    document.body.innerHTML = '<div class="board-layout"></div>';
    expect(checkPage('/play/computer')).toEqual(['board']);
    expect(checkPage('/analysis')).toEqual(['board']);
  });

  it('reports a bot game whose board is not the bot board', () => {
    load('game-live-board', 'game-live-movelist');
    expect(checkPage('/play/computer')).toContain('botBoard');
  });

  it('reports a board without readable pieces', () => {
    document.body.innerHTML = '<wc-chess-board id="board-play-computer"><div class="piece-x"></div></wc-chess-board>';
    expect(checkPage('/play/computer')).toEqual(['pieces']);
  });

  it('reports a game past the start whose moves cannot be read', () => {
    load('computer-03-board');
    expect(checkPage('/play/computer')).toEqual(['moves']);
  });

  it('does not ask the analysis board for moves', () => {
    load('computer-03-board');
    expect(checkPage('/analysis')).toEqual([]);
  });

  it('checks nothing off board pages or in games against people still going', () => {
    document.body.innerHTML = '';
    expect(checkPage('/home')).toEqual([]);
    expect(checkPage('/game/live/123')).toEqual([]);
  });

  it('turns the first problem into a warning', () => {
    expect(pageHealthText({ problems: [] })).toBeNull();
    expect(pageHealthText({ problems: ['board', 'moves'] })).toMatch(/can't find the board/);
    expect(NOT_RUNNING_TEXT).toMatch(/Reload/);
  });
});
