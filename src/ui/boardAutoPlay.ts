const HOST_CLASS = 'vektra-autoplay-control';

const css = `
  :host {
    position: absolute;
    z-index: 1000;
    top: 10px;
    left: 10px;
    color: #e7eef6;
    font: 600 11px/1.25 system-ui, sans-serif;
  }
  .control {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px;
    border: 1px solid rgba(104, 223, 194, .3);
    border-radius: 12px;
    background: rgba(17, 24, 32, .96);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .38);
    backdrop-filter: blur(8px);
  }
  button {
    min-height: 28px;
    padding: 5px 8px;
    border: 1px solid #344354;
    border-radius: 7px;
    background: #202c38;
    color: #e7eef6;
    font: 700 10px/1 system-ui, sans-serif;
    letter-spacing: .03em;
    cursor: pointer;
  }
  button:hover { border-color: #68dfc2; }
  button[aria-pressed="true"] {
    border-color: #68dfc2;
    background: #68dfc2;
    color: #10211f;
  }
  button:nth-child(2)[aria-pressed="true"] {
    border-color: #c084fc;
    background: #c084fc;
    color: #211331;
  }
  button:focus-visible { outline: 2px solid #68dfc2; outline-offset: 2px; }
  .times { display: grid; gap: 3px; color: #9aaabd; font-variant-numeric: tabular-nums; }
  .time { min-width: 112px; white-space: nowrap; }
  .suggestion { color: #e7eef6; }
  .details-toggle {
    min-width: 52px;
    padding-inline: 8px;
    color: #9aaabd;
  }
  .details-toggle[aria-expanded="true"] { color: #68dfc2; }
  [hidden] { display: none !important; }
`;

function seconds(milliseconds: number | null): string {
  return milliseconds === null ? '—' : `${(milliseconds / 1000).toFixed(2)} s`;
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
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.addEventListener('click', () => this.onToggle(this.toggle.getAttribute('aria-pressed') !== 'true'));
    this.weakerToggle = document.createElement('button');
    this.weakerToggle.type = 'button';
    this.weakerToggle.addEventListener('click', () =>
      this.onWeakerToggle(this.weakerToggle.getAttribute('aria-pressed') !== 'true'),
    );
    this.detailsToggle = document.createElement('button');
    this.detailsToggle.type = 'button';
    this.detailsToggle.className = 'details-toggle';
    this.detailsToggle.textContent = 'Details';
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
      this.detailsToggle.setAttribute('aria-expanded', String(expanded));
      this.detailsToggle.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} move details`);
    });
    this.thinkTime = document.createElement('span');
    this.thinkTime.className = 'time think-time';
    this.thinkTime.textContent = 'Think: —';
    this.thinkTime.setAttribute('aria-live', 'polite');
    this.moveDelay = document.createElement('span');
    this.moveDelay.className = 'time move-delay';
    this.moveDelay.textContent = 'Delay: —';
    this.suggestion = document.createElement('span');
    this.suggestion.className = 'time suggestion';
    this.suggestion.textContent = 'Pick: —';
    this.details.append(this.thinkTime, this.moveDelay, this.suggestion);
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
    this.toggle.textContent = enabled ? 'AUTO · ON' : 'AUTO · OFF';
    this.toggle.setAttribute('aria-pressed', String(enabled));
    this.toggle.setAttribute('aria-label', `Autoplay ${enabled ? 'on' : 'off'}`);
    this.weakerToggle.textContent = weakerMovesEnabled ? 'WEAKER · ON' : 'WEAKER · OFF';
    this.weakerToggle.setAttribute('aria-pressed', String(weakerMovesEnabled));
    this.weakerToggle.setAttribute('aria-label', `Occasional weaker moves ${weakerMovesEnabled ? 'on' : 'off'}`);
  }

  setThinkTime(milliseconds: number | null): void {
    this.thinkTime.textContent = `Think: ${seconds(milliseconds)}`;
  }

  setMoveDelay(milliseconds: number | null): void {
    this.moveDelay.textContent = `Delay: ${seconds(milliseconds)}`;
  }

  setSuggestion(san: string | null, lossCp: number): void {
    if (!san) {
      this.suggestion.textContent = 'Pick: —';
      return;
    }
    const loss = lossCp > 0 ? ` (−${(lossCp / 100).toFixed(2)})` : '';
    this.suggestion.textContent = `Pick: ${san}${loss}`;
  }

  destroy(): void {
    this.host.remove();
    this.board = null;
  }
}
