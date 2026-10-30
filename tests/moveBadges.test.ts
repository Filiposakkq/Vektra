import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../src/analysis/gameAnalysis';
import { applyMoveBadges, clearMoveBadges } from '../src/ui/moveBadges';

const move = (patch: Partial<MoveAnalysis> = {}): MoveAnalysis => ({
  ply: 1,
  color: 'w',
  san: 'e4',
  uci: 'e2e4',
  fenBefore: 'fen',
  bestMove: 'g1f3',
  bestSan: 'Nf3',
  bestLine: ['g1f3'],
  winBefore: 52.3,
  winAfter: 31.7,
  loss: 20.6,
  accuracy: 18.4,
  category: 'blunder',
  ...patch,
});

describe('move-list badges', () => {
  it('explains the rating accessibly and updates it without duplicate badges', () => {
    document.body.innerHTML =
      '<wc-move-list><div class="node main-line-ply" data-node="0-0"><span class="node-highlight-content">e4</span></div></wc-move-list>';
    const list = document.body.firstElementChild!;

    applyMoveBadges(list, [move()]);
    applyMoveBadges(list, [move({ category: 'mistake' })]);

    const badges = list.querySelectorAll('.vektra-move-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({
      dataset: { category: 'mistake', ply: '1' },
      title: expect.stringContaining('Nf3'),
    });
    expect(badges[0].getAttribute('aria-label')).toContain('win chances 52.3% to 31.7%');
  });

  it('removes ratings when moves have no analysis', () => {
    document.body.innerHTML =
      '<wc-move-list><div class="node main-line-ply"><span class="node-highlight-content">e4</span></div></wc-move-list>';
    const list = document.body.firstElementChild!;

    applyMoveBadges(list, [move()]);
    applyMoveBadges(list, []);

    expect(list.querySelector('.vektra-move-badge')).toBeNull();
    clearMoveBadges(list);
  });
});
