import { describe, expect, it } from 'vitest';
import { classifyPath, isLiveGamePath, resolveScope } from '../src/content/pageScope';

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
    ['/play/online', 'game'],
    ['/play/online/new', 'game'],
    ['/live', 'game'],
    ['/game/123456', 'game'],
    ['/play/computerx', 'none'],
    ['/home', 'none'],
    ['/puzzles', 'none'],
  ])('%s -> %s', (path, kind) => expect(classifyPath(path)).toBe(kind));
});

describe('resolveScope', () => {
  const live = () => (document.body.innerHTML = '<wc-chess-board></wc-chess-board>');

  it('enables bot, human, analysis and review pages', () => {
    live();
    for (const p of ['/play/computer', '/play/online', '/analysis', '/game/review/1']) {
      expect(resolveScope(p, document).status).toBe('enabled');
    }
  });

  it('enables in-progress human games with the shared game behavior', () => {
    live();
    expect(resolveScope('/play/online', document)).toEqual({ status: 'enabled', kind: 'game' });
    expect(resolveScope('/game/live/123', document)).toEqual({ status: 'enabled', kind: 'game' });
  });

  it('uses live-game behavior until an archived game is finished', () => {
    document.body.innerHTML = '';
    expect(resolveScope('/game/live/123', document)).toEqual({ status: 'enabled', kind: 'game' });
    document.body.innerHTML = '<div class="game-over-modal-shell-content"></div>';
    expect(resolveScope('/game/live/123', document)).toEqual({ status: 'enabled', kind: 'archived' });
    document.body.innerHTML =
      '<wc-simple-move-list><div class="main-line-row move-list-row result-row"><span class="game-result">0-1 </span></div></wc-simple-move-list>';
    expect(resolveScope('/game/daily/123', document)).toEqual({ status: 'enabled', kind: 'archived' });
  });

  it('keeps finished human games enabled for review', () => {
    document.body.innerHTML = '<div class="game-over-modal-shell-content"></div>';
    expect(resolveScope('/play/online', document)).toEqual({ status: 'enabled', kind: 'game' });
  });

  it('is inactive elsewhere', () => {
    expect(resolveScope('/home', document).status).toBe('inactive');
  });

  it('distinguishes live game URLs from saved bot games', () => {
    expect(isLiveGamePath('/play/online')).toBe(true);
    expect(isLiveGamePath('/game/live/123')).toBe(true);
    expect(isLiveGamePath('/game/computer/123')).toBe(false);
  });
});
