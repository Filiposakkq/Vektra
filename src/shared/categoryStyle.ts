import type { Category } from '../analysis/classify';

/**
 * Colour and plain-text symbol for each move category. The colours follow
 * the ones chess players know from chess.com's Game Review; the symbol is
 * used where an icon can't be drawn (PDF, tooltips).
 */
export const CATEGORY_STYLE: Record<Category, { symbol: string; color: string }> = {
  book: { symbol: '▤', color: '#a88865' },
  brilliant: { symbol: '!!', color: '#26c2a3' },
  great: { symbol: '!', color: '#749bbf' },
  best: { symbol: '★', color: '#81b64c' },
  excellent: { symbol: '👍', color: '#96bc4b' },
  good: { symbol: '✓', color: '#96af8b' },
  inaccuracy: { symbol: '?!', color: '#f7c631' },
  mistake: { symbol: '?', color: '#ffa459' },
  miss: { symbol: '✗', color: '#ff7769' },
  blunder: { symbol: '??', color: '#fa412d' },
};
