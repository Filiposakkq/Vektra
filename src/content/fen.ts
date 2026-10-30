import { Chess, DEFAULT_POSITION, validateFen, type Square } from 'chess.js';
import { placementToFenBoard, type Placement } from './boardDom';

export interface ReplayResult {
  /** FEN after each ply; fens[0] is the start position. */
  fens: string[];
  /** UCI moves (e2e4, e7e8q) for each ply, for sending to the engine. */
  uci: string[];
  /** Index of the first SAN that could not be played, or null if all played. */
  failedAt: number | null;
}

/** Replay SAN moves with chess.js, recording the full FEN after every ply. */
export function replay(sans: readonly string[], startFen: string = DEFAULT_POSITION): ReplayResult {
  const chess = new Chess(startFen);
  const fens = [chess.fen()];
  const uci: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    try {
      const m = chess.move(sans[i], { strict: false });
      uci.push(m.from + m.to + (m.promotion ?? ''));
      fens.push(chess.fen());
    } catch {
      return { fens, uci, failedAt: i };
    }
  }
  return { fens, uci, failedAt: null };
}

const PROMOTION_PIECES = ['Q', 'R', 'B', 'N'] as const;

/**
 * Settle which piece each promotion was to, whatever language the move list
 * is in. chess.com writes the promotion piece as a localised letter, so the
 * letter read from the page is only a first guess. The other pieces are tried
 * too, and the choice must keep every later move legal (the promoted piece's
 * later moves are shown as language-independent icons) and, when given, match
 * the pieces on the board after `check.ply` plies. Ties keep the first guess,
 * then prefer queen, rook, bishop, knight.
 */
let lastSettle: { key: string; result: string[] } | null = null;

export function settlePromotions(
  sans: readonly string[],
  check?: { ply: number; boardFen: string },
): string[] {
  if (!sans.some((san) => san.includes('='))) return [...sans];
  // The board is read many times a second; the answer only changes with the input.
  const key = `${sans.join(' ')}|${check?.ply}|${check?.boardFen}`;
  if (lastSettle?.key === key) return [...lastSettle.result];
  const result = settle(sans, check);
  lastSettle = { key, result };
  return [...result];
}

function settle(sans: readonly string[], check?: { ply: number; boardFen: string }): string[] {
  const at = sans.flatMap((san, i) => (san.includes('=') ? [i] : []));
  if (!at.length) return [...sans];
  // More than three promotions in one game is rare; beyond that only the
  // first guesses are used for the rest, to keep the search small.
  const open = at.slice(0, 3);
  const choices = open.map((i) => {
    const guess = sans[i].match(/=([QRBN])/)?.[1];
    return [...new Set([guess, ...PROMOTION_PIECES].filter(Boolean))] as string[];
  });
  const withPieces = (pick: number[]) =>
    sans.map((san, i) => {
      const k = open.indexOf(i);
      return k < 0 ? san : san.replace(/=[QRBN]/, `=${choices[k][pick[k]]}`);
    });

  let fallback: string[] | null = null;
  const total = choices.reduce((n, c) => n * c.length, 1);
  for (let n = 0; n < total; n++) {
    const pick: number[] = [];
    let rest = n;
    for (const c of choices) {
      pick.push(rest % c.length);
      rest = Math.floor(rest / c.length);
    }
    const candidate = withPieces(pick);
    const { fens, failedAt } = replay(candidate);
    if (failedAt !== null) continue;
    if (!check || check.ply >= fens.length) return candidate;
    if (fens[check.ply].split(' ')[0] === check.boardFen) return candidate;
    fallback ??= candidate;
  }
  return fallback ?? [...sans];
}

export interface ResolvedPosition {
  fen: string;
  /** Plies played from the start to reach this position (0 = start). */
  ply: number;
  /**
   * replay: FEN comes from the move list, so castling, en passant and move
   *         counters are exact.
   * dom:    move list unavailable or inconsistent; FEN was rebuilt from the
   *         pieces on the board and the extra fields are best guesses.
   */
  source: 'replay' | 'dom';
}

export interface ResolveInput {
  sans: readonly string[];
  /** Pieces drawn on the board, if a board was found. */
  placement: Placement | null;
  /** Ply the move list marks as shown, if any. */
  selectedPly: number | null;
  startFen?: string;
  /** Side to move for the DOM fallback when the move list can't tell us. */
  fallbackTurn?: 'w' | 'b';
}

const boardField = (fen: string) => fen.split(' ')[0];

/**
 * Work out the exact position on screen.
 *
 * The move list is replayed to get a full FEN for every ply. The board's piece
 * placement then picks which ply is actually displayed: this handles the user
 * stepping back and forward, an unmarked selection, and the moment between a
 * move being drawn and the move list updating. If no ply matches, the FEN is
 * rebuilt from the board alone.
 */
export function resolvePosition(input: ResolveInput): ResolvedPosition | null {
  const { sans, placement, selectedPly, startFen } = input;
  const { fens } = replay(sans, startFen);
  const last = fens.length - 1;

  const order: number[] = [];
  const push = (p: number | null) => {
    if (p !== null && p >= 0 && p <= last && !order.includes(p)) order.push(p);
  };
  push(selectedPly);
  push(last);
  for (let p = last; p >= 0; p--) push(p);

  if (!placement || placement.size === 0) {
    const ply = order[0];
    return { fen: fens[ply], ply, source: 'replay' };
  }

  const domBoard = placementToFenBoard(placement);
  for (const ply of order) {
    if (boardField(fens[ply]) === domBoard) return { fen: fens[ply], ply, source: 'replay' };
  }
  // A piece the user has picked up is not on its square while it is dragged.
  for (const ply of order) {
    if (isOnePieceLifted(placement, fens[ply])) return { fen: fens[ply], ply, source: 'replay' };
  }

  const turn =
    input.fallbackTurn ?? (selectedPly !== null ? (selectedPly % 2 === 0 ? 'w' : 'b') : 'w');
  const fen = fenFromPlacement(placement, turn);
  return fen ? { fen, ply: selectedPly ?? last, source: 'dom' } : null;
}

/** True if the board equals the FEN's position with exactly one piece missing. */
export function isOnePieceLifted(placement: Placement, fen: string): boolean {
  const full = new Chess(fen);
  let count = 0;
  for (const row of full.board()) {
    for (const sq of row) {
      if (!sq) continue;
      count++;
      const shown = placement.get(sq.square);
      if (shown && shown !== sq.color + sq.type) return false;
    }
  }
  if (placement.size !== count - 1) return false;
  for (const [square] of placement) if (!full.get(square as Square)) return false;
  return true;
}

/**
 * Build a FEN from piece placement only. Castling rights are inferred from
 * kings and rooks on their home squares; en passant is unknown and left "-".
 * Returns null if the result is not a legal FEN.
 */
export function fenFromPlacement(placement: Placement, turn: 'w' | 'b'): string | null {
  const at = (sq: string) => placement.get(sq);
  let castling = '';
  if (at('e1') === 'wk') {
    if (at('h1') === 'wr') castling += 'K';
    if (at('a1') === 'wr') castling += 'Q';
  }
  if (at('e8') === 'bk') {
    if (at('h8') === 'br') castling += 'k';
    if (at('a8') === 'br') castling += 'q';
  }
  const fen = `${placementToFenBoard(placement)} ${turn} ${castling || '-'} - 0 1`;
  return validateFen(fen).ok ? fen : null;
}
