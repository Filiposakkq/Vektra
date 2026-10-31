import { describe, expect, it } from 'vitest';
import { classifyPath, isLiveGamePath, resolveScope } from '../src/content/pageScope';

const RESULT_ROW =
  '<wc-simple-move-list><div class="main-line-row move-list-row result-row"><span class="game-result">0-1 </span></div></wc-simple-move-list>';

describe('classifyPath', () => {
  it.each([
    ['/play/computer', 'game'],
    ['/play/computer/discover', 'game'],
    ['/game/computer/2466023156', 'game'],
    ['/analysis', 'analysis'],
    ['/analysis/game/live/123?tab=review', 'analysis'],
    ['/game/review/123', 'review'],
    ['/game/live/123456', 'archived'],
    ['/game/daily/987', 'archived'],
    ['/play/online', 'archived'],
    ['/play/online/new', 'archived'],
    ['/live', 'archived'],
    ['/game/123456', 'archived'],
    ['/variants/chess960/game/1', 'archived'],
    ['/play/computerx', 'none'],
    ['/home', 'none'],
    ['/puzzles', 'none'],
  ])('%s -> %s', (path, kind) => expect(classifyPath(path)).toBe(kind));
});

describe('resolveScope', () => {
  const botBoard = () =>
    (document.body.innerHTML = '<wc-chess-board id="board-play-computer"></wc-chess-board>');

  it('enables bot games, analysis and review', () => {
    botBoard();
    for (const p of ['/play/computer', '/game/computer/1', '/analysis', '/game/review/1']) {
      expect(resolveScope(p, document).status).toBe('enabled');
    }
    expect(resolveScope('/play/computer', document)).toEqual({ status: 'enabled', kind: 'game' });
  });

  it('keeps /play/computer inactive without the bot board', () => {
    document.body.innerHTML = '<wc-chess-board id="board-single"></wc-chess-board>';
    expect(resolveScope('/play/computer', document).status).toBe('inactive');
  });

  it('never enables a game against a person in progress', () => {
    botBoard();
    for (const p of ['/play/online', '/game/live/123', '/game/daily/123', '/game/123', '/live', '/variants/x']) {
      expect(resolveScope(p, document).status).toBe('inactive');
    }
  });

  it('does not treat the game-over modal alone as a finished game against a person', () => {
    document.body.innerHTML = '<div class="game-over-modal-shell-content"></div>';
    expect(resolveScope('/game/live/123', document).status).toBe('inactive');
    expect(resolveScope('/play/online', document).status).toBe('inactive');
  });

  it('enables finished games against people for review once a result shows', () => {
    document.body.innerHTML = RESULT_ROW;
    expect(resolveScope('/game/live/123', document)).toEqual({ status: 'enabled', kind: 'archived' });
    expect(resolveScope('/game/daily/123', document)).toEqual({ status: 'enabled', kind: 'archived' });
    expect(resolveScope('/play/online', document)).toEqual({ status: 'enabled', kind: 'archived' });
  });

  it('is inactive elsewhere', () => {
    expect(resolveScope('/home', document).status).toBe('inactive');
  });

  it('treats only /play/computer as a bot game in progress', () => {
    expect(isLiveGamePath('/play/computer')).toBe(true);
    expect(isLiveGamePath('/game/computer/123')).toBe(false);
    expect(isLiveGamePath('/play/online')).toBe(false);
  });
});
