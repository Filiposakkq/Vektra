import { BOARD_COLORS } from './overlay';

const HOST_CLASS = 'vektra-autoplay-control';

/*
 * A small bar in the board's top-left corner. It sits over the top rank, so it
 * stays faint until the pointer or keyboard is on it, or autoplay is running.
 */
const css = `
  :host {
    position: absolute;
    z-index: 1000;
    top: 6px;
    left: 6px;
    color: #eef2f7;
    font: 600 11px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    width: max-content;
    max-width: 320px;
    padding: 3px;
    border-radius: 9px;
    background: rgba(24, 33, 44, .86);
    box-shadow: 0 2px 10px rgba(0, 0, 0, .32);
    opacity: .5;
    transition: opacity 140ms ease;
  }
  :host(:hover) .control,
  .control:focus-within,
  :host([data-autoplay="true"]) .control,
  :host([data-open="true"]) .control { opacity: 1; }
  /* Idle, only the switches show, so less of the top rank is covered. */
  .label {
    display: inline-block;
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    opacity: 0;
    transition: max-width 160ms ease, opacity 120ms ease;
  }
  :host(:hover) .label,
  .control:focus-within .label,
  :host([data-open="true"]) .label { max-width: 110px; opacity: 1; }
  button { gap: 0; padding: 0 5px; }
  :host(:hover) button,
  .control:focus-within button,
  :host([data-open="true"]) button { gap: 6px; padding: 0 8px 0 6px; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: rgba(255, 255, 255, .09); }
  button:focus-visible { outline: 2px solid #9dbcff; outline-offset: 1px; }
  .switch {
    position: relative;
    flex: none;
    width: 20px;
    height: 12px;
    border-radius: 6px;
    background: #4a5a6c;
    transition: background 140ms ease;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #eef2f7;
    transition: transform 140ms ease;
  }
  button[aria-pressed="true"] .switch { background: ${BOARD_COLORS.lapis}; }
  button.weaker[aria-pressed="true"] .switch { background: ${BOARD_COLORS.violet}; }
  button[aria-pressed="true"] .switch::after { transform: translateX(8px); }
  .chevron {
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
    transition: transform 140ms ease;
  }
  .details-toggle { color: #b5c1cf; }
  .details-toggle[aria-expanded="true"] { color: #eef2f7; }
  .details-toggle[aria-expanded="true"] .chevron { transform: translateY(1px) rotate(225deg); }
  .times {
    flex-basis: 100%;
    display: grid;
    gap: 2px;
    padding: 5px 7px 4px;
    border-top: 1px solid rgba(255, 255, 255, .1);
    color: #b5c1cf;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .suggestion { color: #eef2f7; }
  /* Your recent picks, newest first, so they can be read after the move. */
  .history { display: grid; gap: 1px; margin-top: 4px; padding-top: 5px; border-top: 1px solid rgba(255, 255, 255, .08); }
  .history:empty { display: none; }
  .history-row {
    display: grid;
    grid-template-columns: 1fr 52px 52px;
    gap: 6px;
    white-space: nowrap;
  }
  .history-row span:not(:first-child) { text-align: right; }
  .history-head { color: #8593a3; font-size: 10px; }
  .history-row:nth-child(2) { color: #eef2f7; }
  [hidden] { display: none !important; }
  @media (prefers-reduced-motion: reduce) {
    .control, .switch, .switch::after, .chevron, .label { transition: none; }
  }
`;

/** Picks kept in the Details history. */
const HISTORY_LENGTH = 6;

function seconds(milliseconds: number | null): string {
  return milliseconds === null ? '—' : `${(milliseconds / 1000).toFixed(2)} s`;
}

function switchButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  const track = document.createElement('span');
  track.className = 'switch';
  track.setAttribute('aria-hidden', 'true');
  button.append(track, buttonLabel(label));
  return button;
}

/** A button's text, hidden while the control is idle (the switches still show the state). */
function buttonLabel(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'label';
  span.textContent = text;
  return span;
}

export class BoardAutoPlayControl {
  private readonly host: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly weakerToggle: HTMLButtonElement;
  private readonly detailsToggle: HTMLButtonElement;
  private readonly details: HTMLDivElement;
  private readonly thinkTime: HTMLSpanElement;
  private readonly moveDelay: HTMLSpanElement;
  private readonly suggestion: HTMLSpanElement;
  private readonly history: HTMLDivElement;
  /** Your recent picks, newest first. */
  private picks: { label: string; move: string; think: string; delay: string }[] = [];
  private board: HTMLElement | null = null;

  constructor(
    private readonly onToggle: (enabled: boolean) => void,
    private readonly onWeakerToggle: (enabled: boolean) => void,
  ) {
    this.host = document.createElement('div');
    this.host.className = HOST_CLASS;
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const control = document.createElement('div');
    control.className = 'control';
    this.toggle = switchButton('Autoplay', 'autoplay');
    this.toggle.addEventListener('click', () => this.onToggle(this.toggle.getAttribute('aria-pressed') !== 'true'));
    this.weakerToggle = switchButton('Weaker moves', 'weaker');
    this.weakerToggle.addEventListener('click', () =>
      this.onWeakerToggle(this.weakerToggle.getAttribute('aria-pressed') !== 'true'),
    );
    this.detailsToggle = document.createElement('button');
    this.detailsToggle.type = 'button';
    this.detailsToggle.className = 'details-toggle';
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.setAttribute('aria-hidden', 'true');
    this.detailsToggle.append(buttonLabel('Details'), chevron);
    this.detailsToggle.setAttribute('aria-label', 'Show move details');
    this.detailsToggle.setAttribute('aria-expanded', 'false');
    this.details = document.createElement('div');
    this.details.className = 'times';
    this.details.id = 'vektra-move-details';
    this.details.hidden = true;
    this.detailsToggle.setAttribute('aria-controls', this.details.id);
    this.detailsToggle.addEventListener('click', () => {
      const expanded = this.detailsToggle.getAttribute('aria-expanded') !== 'true';
      this.details.hidden = !expanded;
      this.host.dataset.open = String(expanded);
      this.detailsToggle.setAttribute('aria-expanded', String(expanded));
      this.detailsToggle.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} move details`);
    });
    const row = (className: string, text: string) => {
      const span = document.createElement('span');
      span.className = `time ${className}`;
      span.textContent = text;
      return span;
    };
    this.thinkTime = row('think-time', 'Think: —');
    this.thinkTime.setAttribute('aria-live', 'polite');
    this.moveDelay = row('move-delay', 'Delay: —');
    this.suggestion = row('suggestion', 'Pick: —');
    this.history = document.createElement('div');
    this.history.className = 'history';
    this.details.append(this.suggestion, this.thinkTime, this.moveDelay, this.history);
    control.append(this.toggle, this.weakerToggle, this.detailsToggle, this.details);
    root.append(style, control);

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  update(board: HTMLElement, enabled: boolean, weakerMovesEnabled: boolean): void {
    if (this.board !== board) {
      this.host.remove();
      this.board = board;
      board.append(this.host);
    }
    this.host.dataset.autoplay = String(enabled);
    this.toggle.setAttribute('aria-pressed', String(enabled));
    this.toggle.setAttribute('aria-label', `Autoplay ${enabled ? 'on' : 'off'}`);
    this.weakerToggle.setAttribute('aria-pressed', String(weakerMovesEnabled));
    this.weakerToggle.setAttribute('aria-label', `Occasional weaker moves ${weakerMovesEnabled ? 'on' : 'off'}`);
  }

  setThinkTime(milliseconds: number | null): void {
    this.thinkTime.textContent = `Think: ${seconds(milliseconds)}`;
  }

  setMoveDelay(milliseconds: number | null): void {
    this.moveDelay.textContent = `Delay: ${seconds(milliseconds)}`;
    // A planned move's delay belongs to the latest pick.
    if (milliseconds !== null && this.picks[0]) {
      this.picks[0].delay = seconds(milliseconds);
      this.renderHistory();
    }
  }

  setSuggestion(san: string | null, lossCp: number): void {
    if (!san) {
      this.suggestion.textContent = 'Pick: —';
      return;
    }
    const loss = lossCp > 0 ? ` (−${(lossCp / 100).toFixed(2)})` : '';
    this.suggestion.textContent = `Pick: ${san}${loss}`;
  }

  /**
   * A new pick for your move: it shows in the lines above and starts a row in
   * the history. The values stay until the next pick, so they can be read
   * after the move is made.
   */
  recordPick(label: string, san: string | null, thinkMs: number, lossCp: number): void {
    this.setSuggestion(san, lossCp);
    this.setThinkTime(thinkMs);
    const loss = lossCp > 0 ? ` (−${(lossCp / 100).toFixed(2)})` : '';
    const pick = { label, move: `${label} ${san ?? '?'}${loss}`, think: seconds(thinkMs), delay: '—' };
    if (this.picks[0]?.label === label) {
      // Worked out again for the same move (e.g. after a settings change):
      // replace it, keeping the delay of the move already planned.
      pick.delay = this.picks[0].delay;
      this.picks[0] = pick;
    } else {
      // A new move: its delay is unknown until autoplay plans it.
      this.picks.unshift(pick);
      this.moveDelay.textContent = 'Delay: —';
    }
    this.picks.length = Math.min(this.picks.length, HISTORY_LENGTH);
    this.renderHistory();
  }

  /** The move autoplay will play changed (a newer choice for the same position). */
  setPlannedMove(label: string, san: string | null): void {
    if (!san) return;
    this.suggestion.textContent = `Pick: ${san}`;
    if (this.picks[0]) this.picks[0].move = `${label} ${san}`;
    this.renderHistory();
  }

  /** Start a new history, e.g. for a new game. */
  resetHistory(): void {
    this.picks = [];
    this.renderHistory();
  }

  private renderHistory(): void {
    if (!this.picks.length) {
      this.history.replaceChildren();
      return;
    }
    const line = (cells: string[], className = 'history-row') => {
      const div = document.createElement('div');
      div.className = className;
      for (const text of cells) {
        const span = document.createElement('span');
        span.textContent = text;
        div.append(span);
      }
      return div;
    };
    this.history.replaceChildren(
      line(['Recent picks', 'Think', 'Delay'], 'history-row history-head'),
      ...this.picks.map((pick) => line([pick.move, pick.think, pick.delay])),
    );
  }

  destroy(): void {
    this.host.remove();
    this.board = null;
  }
}
