import { winPercent } from '../analysis/winProbability';
import { formatScore, type Score } from '../engine/uci';
import { THEME } from './theme';

/** chess.com's own evaluation bar. CONFIRMED (analysis page markup) */
const NATIVE_EVAL_BAR = 'wc-evaluation-bar';

/**
 * Evaluation bar just left of the board, in Vektra's bone and ink. It lives inside
 * the board element and is sized in percent of the board, so it follows the
 * board through resizes. White's share grows from White's side, and the score
 * rides on the edge between the two shares, in the colour of the side ahead,
 * so how far the edge has moved and the number read together.
 */
export class EvalBar {
  private root: HTMLDivElement;
  private white: HTMLDivElement;
  private label: HTMLDivElement;
  private depth: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'vektra-evalbar';
    Object.assign(this.root.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: 'calc(-4.2% - 5px)',
      width: '4.2%',
      minWidth: '16px',
      pointerEvents: 'none',
      zIndex: '50',
    } satisfies Partial<CSSStyleDeclaration>);
    const track = document.createElement('div');
    Object.assign(track.style, {
      position: 'absolute',
      inset: '0',
      background: THEME.ink,
      borderRadius: '4px',
      overflow: 'hidden',
      boxShadow: `0 0 0 1px ${THEME.line}`,
    } satisfies Partial<CSSStyleDeclaration>);
    this.white = document.createElement('div');
    this.white.className = 'vektra-evalbar-white';
    Object.assign(this.white.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      background: THEME.bone,
      transition: 'height 400ms ease',
      height: '50%',
    });
    // A tick at the middle, so a small edge is easy to read.
    const middle = document.createElement('div');
    Object.assign(middle.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: 'calc(50% - 0.5px)',
      height: '1px',
      background: 'rgba(128, 140, 155, 0.6)',
    });
    track.append(this.white, middle);
    this.label = document.createElement('div');
    this.label.className = 'vektra-evalbar-score';
    Object.assign(this.label.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '2px 3px',
      borderRadius: '3px',
      font: '700 10px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-0.02em',
      whiteSpace: 'nowrap',
      boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.35)',
      transition: 'top 400ms ease',
    } satisfies Partial<CSSStyleDeclaration>);
    this.depth = document.createElement('div');
    this.depth.className = 'vektra-evalbar-depth';
    Object.assign(this.depth.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      font: '600 8px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      textAlign: 'center',
      opacity: '0.7',
    });
    this.root.append(track, this.label, this.depth);
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.white.style.transition = 'none';
      this.label.style.transition = 'none';
    }
  }

  /** score must be from White's point of view; depth is the search depth, when known. */
  update(board: HTMLElement, score: Score, flipped: boolean, depth?: number): void {
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
    // On the edge between the shares (from the top: Black's share unless
    // flipped), kept clear of the bar's ends.
    const edge = flipped ? pct : 100 - pct;
    this.label.style.top = `${Math.min(97, Math.max(3, edge))}%`;
    this.label.style.background = whiteAhead ? THEME.bone : THEME.ink;
    this.label.style.color = whiteAhead ? THEME.oxblood : THEME.bone;
    // The depth sits at the end away from the score; the top end is Black's
    // unless flipped.
    const depthAtTop = edge >= 50;
    const topIsWhite = flipped;
    this.depth.textContent = depth ? `d${depth}` : '';
    this.depth.style.top = depthAtTop ? '4px' : '';
    this.depth.style.bottom = depthAtTop ? '' : '4px';
    this.depth.style.color = depthAtTop === topIsWhite ? THEME.oxblood : THEME.bone;
    this.root.title = `Eval ${formatScore(score)}${depth ? ` · depth ${depth}` : ''}`;
  }

  destroy(): void {
    this.root.remove();
  }
}
