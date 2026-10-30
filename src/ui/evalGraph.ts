import { displayWinPercent } from '../analysis/scoreScale';
import type { GameAnalysis } from '../analysis/gameAnalysis';
import { CATEGORY_STYLE } from '../shared/categoryStyle';
import { THEME } from './theme';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 80;

/** White's win % after each ply (index 0 = start position). */
export function graphPoints(a: GameAnalysis): number[] {
  return a.positions.map((p) => displayWinPercent(p.score));
}

/**
 * Eval graph of the whole game: white area = White's winning chances.
 * Dots mark inaccuracies and worse. onSelect gets the ply clicked.
 */
export function renderEvalGraph(
  a: GameAnalysis,
  currentPly: number | null,
  onSelect: (ply: number) => void,
): SVGSVGElement {
  const pts = graphPoints(a);
  const n = Math.max(1, pts.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (w: number) => H - (w / 100) * H;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Evaluation graph');
  Object.assign(svg.style, { width: '100%', height: `${H}px`, display: 'block', cursor: 'pointer', borderRadius: '3px', outline: `1px solid ${THEME.line}` });

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(W));
  bg.setAttribute('height', String(H));
  bg.setAttribute('fill', THEME.ink);
  svg.appendChild(bg);

  const area = document.createElementNS(SVG_NS, 'path');
  const line = pts.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(w).toFixed(2)}`).join(' ');
  area.setAttribute('d', `${line} L${W},${H} L0,${H} Z`);
  area.setAttribute('fill', THEME.bone);
  svg.appendChild(area);

  const mid = document.createElementNS(SVG_NS, 'line');
  mid.setAttribute('x1', '0');
  mid.setAttribute('x2', String(W));
  mid.setAttribute('y1', String(H / 2));
  mid.setAttribute('y2', String(H / 2));
  mid.setAttribute('stroke', THEME.muted);
  mid.setAttribute('stroke-width', '0.5');
  svg.appendChild(mid);

  if (currentPly !== null) {
    const cur = document.createElementNS(SVG_NS, 'line');
    cur.setAttribute('x1', String(x(currentPly)));
    cur.setAttribute('x2', String(x(currentPly)));
    cur.setAttribute('y1', '0');
    cur.setAttribute('y2', String(H));
    cur.setAttribute('stroke', THEME.brass);
    cur.setAttribute('stroke-width', '2');
    svg.appendChild(cur);
  }

  for (const m of a.moves) {
    if (!['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(m.category)) continue;
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x(m.ply)));
    dot.setAttribute('cy', String(y(pts[m.ply])));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', CATEGORY_STYLE[m.category].color);
    dot.setAttribute('stroke', THEME.ink);
    dot.setAttribute('stroke-width', '0.8');
    svg.appendChild(dot);
  }

  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const ply = Math.round(((e.clientX - rect.left) / rect.width) * n);
    onSelect(Math.min(n, Math.max(0, ply)));
  });
  return svg;
}
