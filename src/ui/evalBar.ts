import { winPercent } from '../analysis/winProbability';
import { formatScore, type Score } from '../engine/uci';
import { THEME } from './theme';

/** chess.com's own evaluation bar. CONFIRMED (analysis page markup) */
const NATIVE_EVAL_BAR = 'wc-evaluation-bar';

/**
 * Evaluation bar just left of the board, in Vektra's bone and ink. It lives inside
 * the board element and is sized in percent of the board, so it follows the
 * board through resizes. White's share grows from White's side, and the score
 * is printed at the end of the side that is ahead.
 */
export class EvalBar {
  private root: HTMLDivElement;
  private white: HTMLDivElement;
  private label: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'vektra-evalbar';
    Object.assign(this.root.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: 'calc(-4.2% - 4px)',
      width: '4.2%',
      minWidth: '16px',
      background: THEME.ink,
      borderRadius: '3px',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '50',
      boxShadow: `0 0 0 1px ${THEME.line}`,
    } satisfies Partial<CSSStyleDeclaration>);
    this.white = document.createElement('div');
    Object.assign(this.white.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      background: THEME.bone,
      transition: 'height 400ms ease',
      height: '50%',
    });
    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      font: '700 10px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      letterSpacing: '-0.03em',
      textAlign: 'center',
    });
    this.root.append(this.white, this.label);
  }

  /** score must be from White's point of view. */
  update(board: HTMLElement, score: Score, flipped: boolean): void {
    if (this.root.parentElement !== board) board.appendChild(this.root);
    // chess.com draws its own bar in the same place on some pages (analysis
    // with its engine on); two bars overlap, so Vektra's steps aside.
    const native = document.querySelector<HTMLElement>(NATIVE_EVAL_BAR);
    this.root.style.display = native && native.offsetWidth > 0 ? 'none' : '';
    const pct = winPercent(score);
    this.white.style.height = `${pct}%`;
    this.white.style.top = flipped ? '0' : '';
    this.white.style.bottom = flipped ? '' : '0';

    const whiteAhead = score.type === 'mate' ? score.value > 0 : score.value >= 0;
    // Short form like chess.com's bar: "0.5", "12.3", "M3".
    this.label.textContent =
      score.type === 'mate' ? `M${Math.abs(score.value)}` : (Math.abs(score.value) / 100).toFixed(1);
    // At the leading side's end: White's end is the bottom unless flipped.
    const atBottom = flipped ? !whiteAhead : whiteAhead;
    this.label.style.top = atBottom ? '' : '4px';
    this.label.style.bottom = atBottom ? '4px' : '';
    this.label.style.color = whiteAhead ? THEME.oxblood : THEME.bone;
    this.root.title = `Eval ${formatScore(score)}`;
  }

  destroy(): void {
    this.root.remove();
  }
}
