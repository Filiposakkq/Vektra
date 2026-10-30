import { SELECTORS, queryAllFirst, queryFirst } from './selectors';

export interface MoveListReading {
  /** Main-line moves in SAN, in order. */
  sans: string[];
  /**
   * Number of plies played in the position the move list marks as shown
   * (selected ply index + 1), or null when nothing is marked.
   */
  selectedPly: number | null;
  /**
   * Moves from the start to the selected node, which may be in a variation.
   * Null when nothing is selected or the path can't be worked out.
   */
  selectedPath: string[] | null;
  /** Colour of the side that played the selected move. */
  selectedColor: 'w' | 'b' | null;
}

const UNICODE_FIGURINES: Record<string, string> = {
  '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N',
  '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N',
};

/**
 * Promotion pieces as chess.com writes them in some languages ("fxg8=D" in
 * Czech), used as the first guess. Pieces elsewhere are figurine icons, so
 * only the promotion letter is localised. Letters mean different pieces in
 * different languages (S is a bishop in Czech, a knight in German), so the
 * page language picks the table.
 */
const PROMOTION_LETTERS: Record<string, Record<string, string>> = {
  cs: { D: 'Q', V: 'R', S: 'B', J: 'N' },
  sk: { D: 'Q', V: 'R', S: 'B', J: 'N' },
  de: { D: 'Q', T: 'R', L: 'B', S: 'N' },
  nl: { D: 'Q', T: 'R', L: 'B', P: 'N' },
  fr: { D: 'Q', T: 'R', F: 'B', C: 'N' },
  es: { D: 'Q', T: 'R', A: 'B', C: 'N' },
  it: { D: 'Q', T: 'R', A: 'B', C: 'N' },
  pt: { D: 'Q', T: 'R', B: 'B', C: 'N' },
  pl: { H: 'Q', W: 'R', G: 'B', S: 'N' },
  sv: { D: 'Q', T: 'R', L: 'B', S: 'N' },
  da: { D: 'Q', T: 'R', L: 'B', S: 'N' },
  no: { D: 'Q', T: 'R', L: 'B', S: 'N' },
  hu: { V: 'Q', B: 'R', F: 'B', H: 'N' },
};

function pageLanguage(): string {
  return typeof document === 'undefined' ? '' : (document.documentElement.lang || '').slice(0, 2).toLowerCase();
}

/** Normalise displayed move text to SAN chess.js accepts. Returns null for non-moves. */
export function normalizeSan(raw: string, lang = pageLanguage()): string | null {
  let s = raw.replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (c) => UNICODE_FIGURINES[c] ?? c);
  s = s.replace(/\s+/g, '');
  // Localised promotion letter, e.g. "fxg8=D" -> "fxg8=Q".
  // An unknown language's D is still a queen (Dame, Dama, Dáma, ...).
  // This is only a first guess; settlePromotions (fen.ts) checks it against
  // the rest of the game and the board, so any language works.
  s = s.replace(/([a-h][18])=?(\p{Lu})(?=[+#!?]*$)/u, (_, sq: string, letter: string) => {
    const known = PROMOTION_LETTERS[lang]?.[letter] ?? (letter === 'D' ? 'Q' : letter);
    return `${sq}=${'NBRQ'.includes(known) ? known : 'Q'}`;
  });
  // Move numbers ("12." / "12...") sometimes share the node.
  s = s.replace(/^\d+\.+/, '');
  // Annotation glyphs.
  s = s.replace(/[!?]+$/, '');
  s = s.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
  if (!s || /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(s)) return null;
  if (!/^([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=?[NBRQ])?|O-O(-O)?)[+#]?$/.test(s)) return null;
  return s;
}

/** Text of a ply element with figurine icons replaced by their letter. */
export function plyText(el: Element): string {
  const textEl = queryFirst(el, SELECTORS.plyText) ?? el;
  const clone = textEl.cloneNode(true) as Element;
  for (const fig of clone.querySelectorAll(SELECTORS.figurine)) {
    fig.replaceWith(fig.getAttribute(SELECTORS.figurineAttr) ?? '');
  }
  // Figurine icons without data-figurine: the piece is only in the class name.
  for (const icon of clone.querySelectorAll('[class*="-white"], [class*="-black"]')) {
    const m = FIGURINE_CLASS.exec(icon.getAttribute('class') ?? '');
    if (m) icon.replaceWith(FIGURINE_LETTER[m[1]]);
  }
  return clone.textContent ?? '';
}

const FIGURINE_CLASS = /\b(king|queen|rook|bishop|knight)-(?:white|black)\b/;
const FIGURINE_LETTER: Record<string, string> = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };

/**
 * The move list for a board. A page can hold several (chess.com's analysis
 * page keeps one per sidebar tab, some of them empty), so the one with the
 * most main-line moves wins; on a tie, the one whose board-id names this board.
 */
export function findMoveList(root: ParentNode = document, board?: Element | null): Element | null {
  const candidates = new Set<Element>();
  if (board?.id) {
    const id = board.id.replace(/["\\]/g, '\\$&');
    for (const el of root.querySelectorAll(`[${SELECTORS.moveListBoardIdAttr}="${id}"]`)) candidates.add(el);
  }
  for (const sel of SELECTORS.moveList) for (const el of root.querySelectorAll(sel)) candidates.add(el);
  let best: Element | null = null;
  let bestCount = -1;
  for (const el of candidates) {
    const count = queryAllFirst(el, SELECTORS.mainLinePly).length;
    if (count > bestCount) {
      best = el;
      bestCount = count;
    }
  }
  return best;
}

function plyColor(node: Element): 'w' | 'b' | null {
  if (node.classList.contains(SELECTORS.whiteMoveClass)) return 'w';
  if (node.classList.contains(SELECTORS.blackMoveClass)) return 'b';
  return null;
}

function plyIndex(node: Element): [line: string, index: number] | null {
  const m = /^(\d+)-(\d+)$/.exec(node.getAttribute(SELECTORS.plyNodeAttr) ?? '');
  return m ? [m[1], Number(m[2])] : null;
}

/**
 * Moves from the start of the game to a selected node inside a variation that
 * branches off the main line. Returns null for nested variations; the caller
 * then falls back to reading the board.
 */
function variationPath(node: Element, mainSans: readonly string[]): string[] | null {
  const pos = plyIndex(node);
  const line = node.closest(SELECTORS.variationLine);
  if (!pos || !line || line.parentElement?.closest(SELECTORS.variationLine)) return null;

  const start = queryFirst(line, [SELECTORS.variationStartNumber]);
  const m = /^(\d+)(\.+)/.exec((start?.textContent ?? '').trim());
  if (!m) return null;
  const startPly = (Number(m[1]) - 1) * 2 + (m[2].length >= 3 ? 1 : 0);
  if (startPly > mainSans.length) return null;

  const moves: string[] = [];
  for (const el of line.querySelectorAll(SELECTORS.anyPly)) {
    const p = plyIndex(el);
    if (!p || p[0] !== pos[0] || p[1] > pos[1]) continue;
    const san = normalizeSan(plyText(el));
    if (!san) return null;
    moves.push(san);
  }
  return [...mainSans.slice(0, startPly), ...moves];
}

export function readMoveList(list: Element): MoveListReading {
  const sans: string[] = [];
  let selectedPly: number | null = null;
  for (const el of queryAllFirst(list, SELECTORS.mainLinePly)) {
    const san = normalizeSan(plyText(el));
    // Stop at a move that can't be read rather than skip it: skipping would
    // shift every later move and make the rest of the game unreadable.
    if (!san) break;
    sans.push(san);
    if (el.querySelector(SELECTORS.selectedPly)) selectedPly = sans.length;
  }

  let selectedPath: string[] | null = null;
  let selectedColor: 'w' | 'b' | null = null;
  const selectedNode = list.querySelector(SELECTORS.selectedPly)?.closest(SELECTORS.anyPly);
  if (selectedNode) {
    selectedColor = plyColor(selectedNode);
    selectedPath = selectedPly !== null ? sans.slice(0, selectedPly) : variationPath(selectedNode, sans);
  }
  return { sans, selectedPly, selectedPath, selectedColor };
}
