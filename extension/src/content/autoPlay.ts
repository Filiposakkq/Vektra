import { Chess } from 'chess.js';
import { autoPlayDelayMs, type Settings } from '../shared/settings';
import type { BoardState } from './boardReader';
import type { PageKind, Scope } from './pageScope';
import { isGameOver } from './pageScope';
import { shouldHint } from '@core/hints/userSide';
import { squareCenter } from '../ui/overlay';
import { SELECTORS, queryFirst } from './selectors';

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function canAutoPlay(
  state: BoardState,
  kind: PageKind,
  enabled: boolean,
  root: ParentNode = document,
): boolean {
  return (
    enabled &&
    kind === 'game' &&
    !state.inVariation &&
    state.source === 'replay' &&
    state.ply === state.sans.length &&
    shouldHint(state, kind) &&
    !isGameOver(root)
  );
}

/**
 * Submit a legal move through the board's pointer and click input handlers.
 * For a promotion this only moves the pawn; choosePromotion picks the piece.
 */
export function playUciMove(state: BoardState, uci: string): boolean {
  const match = UCI_MOVE.exec(uci);
  if (!match) return false;

  try {
    new Chess(state.fen).move({ from: match[1], to: match[2], ...(match[3] ? { promotion: match[3] } : {}) });
  } catch {
    return false;
  }

  const rect = state.board.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const squareClass = (square: string) => `square-${square.charCodeAt(0) - 96}${square[1]}`;
  const piece = state.board.querySelector<HTMLElement>(`.piece.${squareClass(match[1])}`);
  if (!piece) return false;

  const coordinates = (square: string) => {
    const [x, y] = squareCenter(square, state.flipped);
    return {
      clientX: rect.left + (x / 8) * rect.width,
      clientY: rect.top + (y / 8) * rect.height,
    };
  };
  const dispatchPointer = (type: 'pointerdown' | 'pointerup', target: HTMLElement, square: string) => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...coordinates(square),
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }),
    );
  };
  const dispatchMouse = (type: 'mousedown' | 'mouseup' | 'click', target: HTMLElement, square: string) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...coordinates(square),
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0,
        detail: type === 'click' ? 1 : 0,
      }),
    );
  };
  const destination =
    state.board.querySelector<HTMLElement>(`.piece.${squareClass(match[2])}`) ?? state.board;
  dispatchPointer('pointerdown', piece, match[1]);
  dispatchMouse('mousedown', piece, match[1]);
  dispatchPointer('pointerup', destination, match[2]);
  dispatchMouse('mouseup', destination, match[2]);
  dispatchMouse('click', destination, match[2]);
  return true;
}

/** Click an element at its centre, through pointer and mouse events. */
function pressElement(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const base = { bubbles: true, cancelable: true, composed: true, button: 0, ...at };
  const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }));
}

/**
 * After a promoting pawn move, wait for chess.com's promotion picker and
 * click the chosen piece. False when no picker with that piece appears in
 * time, e.g. when chess.com is set to always promote to a queen.
 */
export async function choosePromotion(
  piece: string,
  color: 'w' | 'b',
  root: ParentNode = document,
  timeoutMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const picker = queryFirst(root, SELECTORS.promotionWindow);
    const choice = picker?.querySelector<HTMLElement>(`${SELECTORS.promotionPiece}.${color}${piece}`);
    if (choice) {
      pressElement(choice);
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export class AutoPlayScheduler {
  private lastMoveKey = '';
  private pending: { key: string; move: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly getSettings: () => Settings,
    private readonly getScope: () => Scope | null,
    private readonly getState: () => BoardState | null,
    private readonly onDelay: (milliseconds: number | null) => void,
    /** Told which move is planned, including when a newer choice replaces it. */
    private readonly onPlan?: (move: string) => void,
  ) {}

  resetPosition(): void {
    this.lastMoveKey = '';
  }

  /** Cancel the planned move, if there is one; its delay is then shown as gone. */
  clear(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
    this.onDelay(null);
  }

  schedule(state: BoardState, move: string): void {
    const scope = this.getScope();
    const settings = this.getSettings();
    if (!scope || !canAutoPlay(state, scope.kind, settings.enabled && settings.autoPlay, document)) return;
    const latest = this.getState();
    if (
      !latest ||
      latest.fen !== state.fen ||
      latest.ply !== state.ply ||
      latest.sans.length !== state.sans.length ||
      !latest.sans.every((san, index) => san === state.sans[index]) ||
      latest.board !== state.board ||
      !canAutoPlay(latest, scope.kind, settings.enabled && settings.autoPlay, document)
    ) return;

    const key = `${location.pathname}|${state.fen}|${state.ply}|${state.sans.join(' ')}`;
    if (key === this.lastMoveKey) return;
    if (this.pending?.key === key) {
      // The hints for this position were worked out again (a settings
      // change, the engine retrying) and may show another move now; play the
      // one on the board, keeping the delay already running.
      this.pending.move = move;
      this.onPlan?.(move);
      return;
    }
    this.clear();
    const delay = autoPlayDelayMs(settings);
    this.onDelay(delay);
    this.onPlan?.(move);
    const timer = setTimeout(() => {
      const planned = this.pending?.move ?? move;
      this.pending = null;
      const currentScope = this.getScope();
      const current = this.getState();
      const currentSettings = this.getSettings();
      if (
        !currentScope ||
        !current ||
        current.fen !== state.fen ||
        current.ply !== state.ply ||
        current.sans.length !== state.sans.length ||
        !current.sans.every((san, index) => san === state.sans[index]) ||
        current.board !== state.board ||
        !canAutoPlay(
          current,
          currentScope.kind,
          currentSettings.enabled && currentSettings.autoPlay,
          document,
        )
      ) return;
      if (playUciMove(current, planned)) {
        this.lastMoveKey = key;
        if (planned.length === 5) {
          const color = current.fen.split(' ')[1] as 'w' | 'b';
          void choosePromotion(planned[4], color).then((picked) => {
            // Without a picker chess.com promotes to a queen on its own.
            if (!picked && planned[4] !== 'q') {
              console.warn('[Vektra] The promotion picker did not appear; check the promoted piece:', planned);
            }
          });
        }
      } else {
        console.warn('[Vektra] Could not safely submit the engine move:', planned);
      }
    }, delay);
    this.pending = { key, move, timer };
  }
}
