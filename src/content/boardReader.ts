import { findBoard, isFlipped, placementToFenBoard, readPlacement } from './boardDom';
import { resolvePosition, settlePromotions, type ResolvedPosition } from './fen';
import { findMoveList, readMoveList } from './moveList';

export interface BoardState extends ResolvedPosition {
  flipped: boolean;
  /** Main-line moves in SAN, as read from the move list. */
  sans: string[];
  /** True when the position shown is inside a variation, not the main line. */
  inVariation: boolean;
  board: HTMLElement;
}

/** Read the board and move list once. Returns null if no board is on the page. */
export function readBoardState(root: ParentNode = document): BoardState | null {
  const board = findBoard(root);
  if (!board) return null;
  const list = findMoveList(root, board);
  const reading = list
    ? readMoveList(list)
    : { sans: [], selectedPly: null, selectedPath: null, selectedColor: null };
  const { selectedPly, selectedPath, selectedColor } = reading;
  const placement = readPlacement(board);
  // Promotion letters are localised; settle them against the game and board.
  const boardFen = placementToFenBoard(placement);
  const sans = settlePromotions(reading.sans, { ply: selectedPly ?? reading.sans.length, boardFen });
  const inVariation = selectedPly === null && selectedPath !== null;
  const resolved = resolvePosition({
    sans: inVariation ? selectedPath : sans,
    placement,
    selectedPly: inVariation ? selectedPath.length : selectedPly,
    fallbackTurn: selectedColor ? (selectedColor === 'w' ? 'b' : 'w') : undefined,
  });
  if (!resolved) return null;
  return { ...resolved, flipped: isFlipped(board), sans, inVariation, board };
}

/**
 * Watch the page and call onChange whenever the displayed position, move
 * history, board element, route, or orientation changes. Mutations are
 * debounced because chess.com animates pieces and updates the move list in
 * several steps.
 */
export function watchBoard(
  onChange: (state: BoardState | null) => void,
  { debounceMs = 60, root = document.body }: { debounceMs?: number; root?: HTMLElement } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let lastBoard: HTMLElement | null = null;
  // While the user holds a piece, the board is mid-drag; read it once released.
  let pointerOnBoard = false;

  const check = () => {
    timer = undefined;
    if (pointerOnBoard) return;
    const state = readBoardState(document);
    const key = state
      ? `${location.pathname}|${state.fen}|${state.flipped}|${state.ply}|${state.source}|${state.inVariation}|${state.sans.join(' ')}`
      : '';
    if (key === lastKey && state?.board === lastBoard) return;
    lastKey = key;
    lastBoard = state?.board ?? null;
    onChange(state);
  };

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  };
  const observer = new MutationObserver(schedule);
  const onPointerDown = (e: PointerEvent) => {
    pointerOnBoard = !!findBoard(document)?.contains(e.target as Node);
  };
  const onPointerUp = () => {
    if (!pointerOnBoard) return;
    pointerOnBoard = false;
    schedule();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  check();

  return () => {
    observer.disconnect();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    if (timer !== undefined) clearTimeout(timer);
  };
}
