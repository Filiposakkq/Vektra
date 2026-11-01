import { CATEGORY_STYLE } from '@core/analysis/categoryStyle';
import type { Category } from '@core/analysis/classify';
import { winPercent } from '@core/analysis/winProbability';
import { drawArrows } from '@core/draw/arrowDrawing';
import type { Score } from '@core/engine/uci';
import { squareCenter } from '@core/hints/arrowShapes';
import type { Arrow } from '@core/hints/types';

/** A move rating shown on a square (Best, Mistake...). */
export interface Badge {
  square: string;
  category: Category;
  title: string;
}

/** The app's painter (HintOverlay.kt), which draws each frame natively over the Chess.com board. */
declare global {
  interface Window {
    VektraNative?: { render(frame: string): void };
  }
}

/**
 * What to draw, worked out here with the shared code (core/draw/arrowDrawing)
 * and painted by the app with Android's own graphics: a web page in its own
 * window drew a frame or two later. Positions are in board units.
 */
export class NativeLayer {
  private arrows: unknown[] = [];
  private badge: unknown = null;
  private evaluation: unknown = null;
  private last = '';

  /** Remove the arrows (a new position); the eval strip stays until the next evaluation. */
  clearArrows(): void {
    this.draw([], false, null);
  }

  /** Remove everything, the eval strip too (Vektra turning off). */
  clear(): void {
    this.arrows = [];
    this.badge = null;
    this.evaluation = null;
    this.send();
  }

  draw(arrows: Arrow[], flipped: boolean, badge: Badge | null = null): void {
    this.arrows = drawArrows(arrows, flipped).map((d) => ({
      rank: d.arrow.rank,
      color: d.color,
      width: d.width,
      opacity: d.opacity,
      dash: d.dash,
      shaft: d.shaft,
      head: d.head,
      tint: d.tinted ? [d.from, d.to] : null,
      label: d.label,
      promotion: d.promotion,
      step: d.step,
    }));
    if (badge) {
      // In the square's top-right corner, overlapping the edge like Chess.com's.
      const [cx, cy] = squareCenter(badge.square, flipped);
      const style = CATEGORY_STYLE[badge.category];
      this.badge = { cx: cx + 0.39, cy: cy - 0.39, radius: 0.22, color: style.color, symbol: style.symbol };
    } else {
      this.badge = null;
    }
    this.send();
  }

  /** The eval strip above the board: the user's share of the win chance, on the left. */
  eval(whiteScore: Score, flipped: boolean): void {
    const white = winPercent(whiteScore);
    this.evaluation = {
      mine: (flipped ? 100 - white : white) / 100,
      mineColor: flipped ? '#1b1b1b' : '#f4f1ea',
      theirsColor: flipped ? '#f4f1ea' : '#1b1b1b',
    };
    this.send();
  }

  private send(): void {
    const frame = JSON.stringify({ arrows: this.arrows, badge: this.badge, eval: this.evaluation });
    if (frame === this.last) return;
    this.last = frame;
    window.VektraNative?.render(frame);
  }
}
