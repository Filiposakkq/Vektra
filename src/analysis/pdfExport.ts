import type { jsPDF as JsPdf } from 'jspdf';
import { CATEGORIES, CATEGORY_LABELS, type Category } from './classify';
import type { GameAnalysis, MoveAnalysis } from './gameAnalysis';
import { winPercent } from './winProbability';
import { CATEGORY_STYLE } from '../ui/categoryStyle';

const PAGE = { w: 595.28, h: 841.89, margin: 40 };
const TEXT = '#262421';
const MUTED = '#77736d';

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

function dot(doc: JsPdf, x: number, y: number, r: number, category: Category) {
  doc.setFillColor(...hex(CATEGORY_STYLE[category].color));
  doc.circle(x, y, r, 'F');
}

function drawGraph(doc: JsPdf, a: GameAnalysis, x: number, y: number, w: number, h: number) {
  const pts = a.positions.map((p) => winPercent(p.score));
  const n = Math.max(1, pts.length - 1);
  const px = (i: number) => x + (i / n) * w;
  const py = (win: number) => y + h - (win / 100) * h;

  doc.setFillColor(64, 61, 57);
  doc.rect(x, y, w, h, 'F');
  // White's area as one closed polygon.
  const poly: [number, number][] = [[x, y + h], ...pts.map((p, i) => [px(i), py(p)] as [number, number]), [x + w, y + h]];
  const deltas = poly.slice(1).map(([qx, qy], i) => [qx - poly[i][0], qy - poly[i][1]]);
  doc.setFillColor(240, 240, 240);
  doc.lines(deltas, poly[0][0], poly[0][1], [1, 1], 'F', true);
  doc.setDrawColor(136, 136, 136);
  doc.setLineWidth(0.5);
  doc.line(x, y + h / 2, x + w, y + h / 2);
  for (const m of a.moves) {
    if (!['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.category)) continue;
    dot(doc, px(m.ply), py(pts[m.ply]), 2.5, m.category);
  }
}

function moveCell(doc: JsPdf, m: MoveAnalysis | undefined, x: number, y: number) {
  if (!m) return;
  dot(doc, x + 4, y - 3, 3.5, m.category);
  doc.setTextColor(TEXT);
  doc.text(m.san, x + 12, y);
  doc.setTextColor(MUTED);
  let label = CATEGORY_LABELS[m.category];
  if (m.bestSan && m.bestMove !== m.uci && !['best', 'brilliant', 'great'].includes(m.category)) {
    label += ` (best ${m.bestSan})`;
  }
  doc.text(label, x + 60, y);
}

/** Build the analysis report as a PDF document. */
export async function buildPdf(a: GameAnalysis, meta: { url?: string; date?: Date } = {}): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const { margin } = PAGE;
  const contentW = PAGE.w - margin * 2;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(TEXT);
  doc.text('Vektra game analysis', margin, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const date = (meta.date ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  doc.text(
    `${date} UTC  ·  ${a.engine ?? 'Stockfish'} depth ${a.depth}  ·  ${a.moves.length} plies${a.opening ? `  ·  ${a.opening}` : ''}`,
    margin,
    y + 30,
    { maxWidth: contentW },
  );
  if (meta.url) doc.text(meta.url, margin, y + 42, { maxWidth: contentW });
  y += 60;

  // Accuracy boxes.
  const boxW = (contentW - 10) / 2;
  for (const [i, color, label] of [
    [0, 'w', 'White'],
    [1, 'b', 'Black'],
  ] as const) {
    const bx = margin + i * (boxW + 10);
    if (color === 'w') doc.setFillColor(240, 240, 240);
    else doc.setFillColor(64, 61, 57);
    doc.roundedRect(bx, y, boxW, 46, 4, 4, 'F');
    doc.setTextColor(color === 'w' ? TEXT : '#f0f0f0');
    doc.setFontSize(9);
    doc.text(`${label} accuracy`, bx + boxW / 2, y + 16, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(a.summary[color].accuracy.toFixed(1), bx + boxW / 2, y + 37, { align: 'center' });
    doc.setFont('helvetica', 'normal');
  }
  y += 60;

  drawGraph(doc, a, margin, y, contentW, 90);
  y += 108;

  // Category counts.
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('White', margin + 200, y, { align: 'right' });
  doc.text('Black', margin + 250, y, { align: 'right' });
  y += 14;
  for (const cat of CATEGORIES) {
    dot(doc, margin + 5, y - 3.5, 4, cat);
    doc.setTextColor(TEXT);
    doc.text(CATEGORY_LABELS[cat], margin + 16, y);
    doc.text(String(a.summary.w.counts[cat]), margin + 200, y, { align: 'right' });
    doc.text(String(a.summary.b.counts[cat]), margin + 250, y, { align: 'right' });
    y += 14;
  }
  y += 12;

  // Moves.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Moves', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 16;
  const half = contentW / 2;
  for (let i = 0; i < a.moves.length; i += 2) {
    if (y > PAGE.h - margin) {
      doc.addPage();
      y = margin + 10;
    }
    doc.setTextColor(MUTED);
    doc.text(`${i / 2 + 1}.`, margin, y);
    moveCell(doc, a.moves[i], margin + 22, y);
    moveCell(doc, a.moves[i + 1], margin + 22 + half - 10, y);
    y += 13;
  }

  return doc;
}

/** Build and download the analysis as a PDF. */
export async function downloadPdf(a: GameAnalysis, filename = 'vektra-analysis.pdf'): Promise<void> {
  const doc = await buildPdf(a, { url: location.href });
  doc.save(filename);
}
