import { Chess } from 'chess.js';
import { autoPlayDelayMs, type Settings } from '../shared/settings';
import type { BoardState } from './boardReader';
import type { PageKind, Scope } from './pageScope';
import { isGameOver } from './pageScope';
import { shouldHint } from './hints';
import { squareCenter } from '../ui/overlay';

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

/** Submit a legal move through the board's pointer and click input handlers. */
export function playUciMove(state: BoardState, uci: string): boolean {
  const match = UCI_MOVE.exec(uci);
  if (!match || match[3]) return false;

  try {
    new Chess(state.fen).move({ from: match[1], to: match[2] });
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

export class AutoPlayScheduler {
  private lastMoveKey = '';
  private pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly getSettings: () => Settings,
    private readonly getScope: () => Scope | null,
    private readonly getState: () => BoardState | null,
    private readonly onDelay: (milliseconds: number | null) => void,
  ) {}

  resetPosition(): void {
    this.lastMoveKey = '';
  }

  clear(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
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
    if (key === this.lastMoveKey || this.pending?.key === key) return;
    this.clear();
    const delay = autoPlayDelayMs(settings);
    this.onDelay(delay);
    const timer = setTimeout(() => {
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
      if (playUciMove(current, move)) {
        this.lastMoveKey = key;
      } else {
        console.warn('[Vektra] Could not safely submit the engine move:', move);
      }
    }, delay);
    this.pending = { key, timer };
  }
}
