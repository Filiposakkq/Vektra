import { describe, expect, it } from 'vitest';
import { drawArrows } from '@core/draw/arrowDrawing';
import { DEFAULT_ARROW_COLORS, THREAT_ARROW_COLOR, WEAKER_ARROW_COLOR } from '@core/hints/arrowShapes';

describe('arrow drawings', () => {
  it('draws threats underneath and the best move on top, in the rank colours', () => {
    const drawings = drawArrows(
      [
        { move: 'e2e4', rank: 0, label: '+0.3' },
        { move: 'd2d4', rank: 1, label: '+0.2' },
        { move: 'd8h4', rank: 0, threat: true },
      ],
      false,
    );
    expect(drawings.map((d) => d.key)).toEqual(['threat:d8h4', 'move:d2d4', 'move:e2e4']);
    expect(drawings.map((d) => d.color)).toEqual([THREAT_ARROW_COLOR, DEFAULT_ARROW_COLORS[1], DEFAULT_ARROW_COLORS[0]]);
    expect(drawings[2].tinted).toBe(true);
    expect(drawings[0].tinted).toBe(false);
  });

  it('places points in board units from the side shown', () => {
    const [white] = drawArrows([{ move: 'e2e4', rank: 0 }], false);
    expect(white.from).toEqual([4.5, 6.5]);
    expect(white.head[0]).toEqual([4.5, 4.5]);
    const [black] = drawArrows([{ move: 'e2e4', rank: 0 }], true);
    expect(black.from).toEqual([3.5, 1.5]);
  });

  it('bends knight moves and dashes a running search', () => {
    const [knight] = drawArrows([{ move: 'g1f3', rank: 0, provisional: true }], false);
    expect(knight.corner).not.toBeNull();
    expect(knight.shaft).toHaveLength(3);
    expect(knight.dash).not.toBeNull();
    expect(knight.opacity).toBeLessThan(drawArrows([{ move: 'g1f3', rank: 0 }], false)[0].opacity);
  });

  it('stacks score pills on a shared square, the best move lowest', () => {
    const drawings = drawArrows(
      [
        { move: 'e2e4', rank: 0, label: '+0.3' },
        { move: 'e3e4', rank: 1, label: '+0.1' },
      ],
      false,
    );
    const best = drawings.find((d) => d.arrow.rank === 0)!.label!;
    const second = drawings.find((d) => d.arrow.rank === 1)!.label!;
    expect(second.y).toBeLessThan(best.y);
    expect(best.text).toBe('+0.3');
  });

  it('marks promotions and weaker moves', () => {
    const [promotion] = drawArrows([{ move: 'a7a8n', rank: 0 }], false);
    expect(promotion.promotion?.text).toBe('N');
    const [weaker] = drawArrows([{ move: 'e2e4', rank: 1, weaker: true }], false);
    expect(weaker.color).toBe(WEAKER_ARROW_COLOR);
  });
});
