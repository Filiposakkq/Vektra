import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Category } from './classify';
import type { PositionEval } from './moveAnalysis';

/**
 * Why a bad move was bad, in a sentence: it allows a mate, misses one, loses
 * material or misses a win of material. Read from the engine's lines before
 * and after the move; moves that only give up position get no reason.
 */

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Ratings that get a reason. */
const EXPLAINED = new Set<Category>(['inaccuracy', 'mistake', 'miss', 'blunder']);

/** Material (pawns) a line must lose or miss against the best line to be named. */
const MATERIAL_SWING = 2;
/** Longest stretch of a line played out to count material. */
const MAX_PLIES = 8;
/** Shortest stretch: the move and the reply to it. */
const MIN_PLIES = 2;

interface LineOutcome {
  /** Material change for the mover once the captures settle, in pawns. */
  material: number;
  /** The mover's pieces the opponent captured. */
  lost: Move[];
  /** The opponent's pieces the mover captured. */
  won: Move[];
}

function playUci(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** True if the UCI move captures in this position (en passant included). */
function isCapture(chess: Chess, uci: string): boolean {
  const to = uci.slice(2, 4) as Square;
  if (chess.get(to)) return true;
  const piece = chess.get(uci.slice(0, 2) as Square);
  return piece?.type === 'p' && uci[0] !== uci[2];
}

/**
 * Play a line from `fen` and count material for `mover` once it settles: after
 * at least MIN_PLIES, at the first point where the next move isn't a capture,
 * and at most MAX_PLIES.
 */
function playLine(fen: string, line: string[], mover: 'w' | 'b'): LineOutcome {
  const chess = new Chess(fen);
  const outcome: LineOutcome = { material: 0, lost: [], won: [] };
  for (let i = 0; i < Math.min(line.length, MAX_PLIES); i++) {
    const move = playUci(chess, line[i]);
    if (!move) break;
    if (move.captured) {
      const value = PIECE_VALUE[move.captured];
      if (move.color === mover) {
        outcome.material += value;
        outcome.won.push(move);
      } else {
        outcome.material -= value;
        outcome.lost.push(move);
      }
    }
    if (move.promotion) outcome.material += (move.color === mover ? 1 : -1) * (PIECE_VALUE[move.promotion] - 1);
    const next = line[i + 1];
    if (i + 1 >= MIN_PLIES && (!next || !isCapture(chess, next))) break;
  }
  return outcome;
}

/**
 * What a line's captures come to, with trades of equal value cancelled: the
 * biggest piece taken from each side that wasn't traded for one of the same
 * value (a queen trade followed by a lost knight comes to the knight).
 */
function netCaptures(taken: Move[], given: Move[]): { taken?: Move; given?: Move } {
  const left = [...given];
  const kept = taken.filter((m) => {
    const i = left.findIndex((g) => PIECE_VALUE[g.captured!] === PIECE_VALUE[m.captured!]);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  const biggest = (moves: Move[]) =>
    [...moves].sort((x, y) => PIECE_VALUE[y.captured!] - PIECE_VALUE[x.captured!])[0];
  return { taken: biggest(kept), given: biggest(left) };
}

/** "the queen", or "the queen for a bishop" when something came back. */
function pieceWording(net: { taken?: Move; given?: Move }): string | undefined {
  if (!net.taken) return undefined;
  const piece = `the ${PIECE_NAME[net.taken.captured!]}`;
  if (!net.given) return piece;
  const other = PIECE_NAME[net.given.captured!];
  return `${piece} for ${/^[aeiou]/.test(other) ? 'an' : 'a'} ${other}`;
}

function sanOf(fen: string, uci: string | undefined): string | undefined {
  if (!uci) return undefined;
  return playUci(new Chess(fen), uci)?.san;
}

/** One sentence on why the move was bad, or undefined when there is no concrete reason to give. */
export function explainMove(
  before: PositionEval,
  after: PositionEval,
  move: { uci: string; color: 'w' | 'b' },
  category: Category,
): string | undefined {
  if (!EXPLAINED.has(category)) return undefined;
  const sign = move.color === 'w' ? 1 : -1;
  const best = before.lines[0];
  const reply = after.lines[0]?.pv ?? [];

  // Mates first: nothing else matters as much. Scores in `after` are White's view.
  if (after.score.type === 'mate' && after.score.value * sign < 0) {
    const start = sanOf(after.fen, reply[0]);
    return `Allows mate in ${Math.abs(after.score.value)}${start ? `, starting with ${start}` : ''}.`;
  }
  if (best?.score.type === 'mate' && best.score.value > 0) {
    const bestSan = sanOf(before.fen, best.pv[0]);
    if (after.score.type === 'mate' && after.score.value * sign > 0) {
      return `Mate in ${best.score.value} was there with ${bestSan}; this mates in ${Math.abs(after.score.value)}.`;
    }
    return `Misses mate in ${best.score.value} with ${bestSan}.`;
  }

  if (!best) return undefined;
  const played = playLine(before.fen, [move.uci, ...reply], move.color);
  const ideal = playLine(before.fen, best.pv, move.color);
  if (ideal.material - played.material < MATERIAL_SWING) return undefined;

  const bestSan = sanOf(before.fen, best.pv[0]);
  const misses = () => {
    // When the best move itself takes a piece, that is the clearest thing to name.
    const first = ideal.won[0];
    if (first?.san === bestSan && PIECE_VALUE[first.captured!] >= 3) {
      return `Misses ${bestSan}, which takes the ${PIECE_NAME[first.captured!]}.`;
    }
    const what = pieceWording(netCaptures(ideal.won, ideal.lost));
    return `Misses ${bestSan}, which wins ${what ?? 'material'}.`;
  };
  // A Miss is about the chance that was there, even when the move also loses something.
  if (category === 'miss' && ideal.material >= MATERIAL_SWING) return misses();
  if (played.material <= -MATERIAL_SWING) {
    const net = netCaptures(played.lost, played.won);
    if (net.taken?.captured === 'r' && net.given && PIECE_VALUE[net.given.captured!] === 3) return 'Loses the exchange.';
    const what = pieceWording(net);
    if (!what) return `Loses ${-played.material} pawns' worth of material.`;
    // Name the square and the capture when the piece goes for nothing.
    return net.given ? `Loses ${what}.` : `Loses ${what} on ${net.taken!.to} to ${net.taken!.san}.`;
  }
  return misses();
}
