import { CATEGORY_LABELS } from './classify';
import type { GameAnalysis } from './gameAnalysis';
import type { Score } from '../engine/uci';

const scoreJson = (s: Score) => (s.type === 'cp' ? { cp: s.value } : { mate: s.value });

/** Plain JSON description of an analysed game. */
export function analysisToJson(a: GameAnalysis, meta: { url?: string; generatedAt?: string } = {}) {
  return {
    format: 'vektra-analysis',
    version: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    url: meta.url,
    engine: a.engine ?? 'Stockfish 19 (WASM)',
    opening: a.opening,
    depth: a.depth,
    moves: a.moves.map((m, i) => ({
      ply: m.ply,
      moveNumber: Math.ceil(m.ply / 2),
      color: m.color === 'w' ? 'white' : 'black',
      san: m.san,
      uci: m.uci,
      fenBefore: m.fenBefore,
      evalBefore: scoreJson(a.positions[i].score),
      evalAfter: scoreJson(a.positions[i + 1].score),
      bestMove: m.bestMove,
      bestLine: m.bestLine,
      winBefore: round(m.winBefore),
      winAfter: round(m.winAfter),
      winLoss: round(m.loss),
      accuracy: round(m.accuracy),
      classification: CATEGORY_LABELS[m.category],
    })),
    summary: {
      white: { accuracy: round(a.summary.w.accuracy), counts: a.summary.w.counts },
      black: { accuracy: round(a.summary.b.accuracy), counts: a.summary.b.counts },
    },
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Start a download of the analysis as a .json file. */
export function downloadJson(a: GameAnalysis, filename = 'vektra-analysis.json'): void {
  const blob = new Blob([JSON.stringify(analysisToJson(a, { url: location.href }), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
