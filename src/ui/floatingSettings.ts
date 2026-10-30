const WINDOW_ID = 'vektra-floating-settings';

const css = `
  :host {
    all: initial;
    position: fixed;
    z-index: 2147483647;
    top: 16px;
    left: 16px;
    width: max-content;
    height: max-content;
    pointer-events: none;
    color-scheme: dark;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  .window {
    position: relative;
    pointer-events: auto;
    width: min(420px, calc(100vw - 24px));
    height: auto;
    max-width: calc(100vw - 24px);
    min-width: min(320px, calc(100vw - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(104, 223, 194, .24);
    border-radius: 16px;
    background: #111820;
    box-shadow: 0 18px 56px rgba(0, 0, 0, .56);
  }
  .launcher {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    height: auto;
    padding: 10px 14px;
    border: 1px solid rgba(104, 223, 194, .28);
    border-radius: 999px;
    background: linear-gradient(135deg, #202d39, #111820);
    color: #e7eef6;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .38);
    font: 600 13px/1.2 system-ui, sans-serif;
    touch-action: none;
    cursor: grab;
  }
  .launcher:active { cursor: grabbing; }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #68dfc2;
    box-shadow: 0 0 0 4px rgba(104, 223, 194, .14);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 7px 12px 7px 16px;
    border-bottom: 1px solid #2b3948;
    background: linear-gradient(120deg, #1d2a36, #151e28);
    color: #e7eef6;
    user-select: none;
    touch-action: none;
    cursor: grab;
  }
  header:active { cursor: grabbing; }
  strong { font: 650 16px/1.2 system-ui, sans-serif; letter-spacing: -.01em; }
  .actions { display: flex; align-items: center; gap: 7px; }
  .show-hint {
    width: auto;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    font: 600 11px/1 system-ui, sans-serif;
  }
  button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid #2b3948;
    border-radius: 7px;
    background: #18232e;
    color: #e7eef6;
    font: 18px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  button:hover { border-color: #68dfc2; background: #22313e; }
  button:focus-visible { outline: 2px solid #68dfc2; outline-offset: 2px; }
  [hidden] { display: none !important; }
  iframe {
    display: block;
    flex: none;
    width: 100%;
    height: 1px;
    border: 0;
    overscroll-behavior: contain;
    background: #111820;
  }
  @media (max-width: 440px) {
    .window { width: calc(100vw - 24px); }
    iframe { width: 100%; }
  }
`;

export class FloatingSettings {
  private readonly host: HTMLDivElement;
  private readonly windowElement: HTMLDivElement;
  private readonly launcher: HTMLButtonElement;
  private readonly stopAutoplay: HTMLButtonElement;
  private readonly removeFrameMessageListener: () => void;
  private suppressLauncherClick = false;
  private context: 'analysis' | 'game';

  constructor(
    onShowHint: () => void,
    private readonly onStopAutoplay: () => void,
    context: 'analysis' | 'game' = 'game',
  ) {
    this.context = context;
    document.getElementById(WINDOW_ID)?.remove();
    this.host = document.createElement('div');
    this.host.id = WINDOW_ID;
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;

    this.windowElement = document.createElement('div');
    this.windowElement.className = 'window';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Vektra settings';
    const actions = document.createElement('div');
    actions.className = 'actions';
    this.stopAutoplay = document.createElement('button');
    this.stopAutoplay.type = 'button';
    this.stopAutoplay.className = 'show-hint';
    this.stopAutoplay.textContent = 'Stop autoplay';
    this.stopAutoplay.setAttribute('aria-label', 'Stop autoplay');
    this.stopAutoplay.hidden = true;
    this.stopAutoplay.addEventListener('click', () => {
      this.setAutoplayEnabled(false);
      this.onStopAutoplay();
    });
    const showHint = document.createElement('button');
    showHint.type = 'button';
    showHint.className = 'show-hint';
    showHint.textContent = 'Show hint now';
    showHint.setAttribute('aria-label', 'Show hint now');
    showHint.addEventListener('click', onShowHint);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close Vektra settings');
    close.addEventListener('click', () => this.setOpen(false));
    actions.append(this.stopAutoplay, showHint, close);
    header.append(title, actions);

    const frame = document.createElement('iframe');
    frame.title = 'Vektra settings';
    frame.src = chrome.runtime.getURL(
      `src/popup/index.html?floating=1&context=${this.context}`,
    );
    const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
    const onFrameMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== extensionOrigin ||
        event.data?.type !== 'vektra:settings-content-height' ||
        typeof event.data.height !== 'number' ||
        !Number.isFinite(event.data.height)
      ) return;
      const maxHeight = Math.max(180, window.innerHeight - 24);
      const headerHeight = header.getBoundingClientRect().height || 48;
      const frameHeight = Math.min(Math.ceil(event.data.height), maxHeight - headerHeight - 2);
      frame.style.height = `${frameHeight}px`;
      this.windowElement.style.height = `${frameHeight + headerHeight + 2}px`;
      this.keepOnscreen();
    };
    window.addEventListener('message', onFrameMessage);
    this.removeFrameMessageListener = () => window.removeEventListener('message', onFrameMessage);
    this.windowElement.append(header, frame);
    this.launcher = document.createElement('button');
    this.launcher.type = 'button';
    this.launcher.className = 'launcher';
    this.launcher.id = 'vektra-settings-launcher';
    this.launcher.setAttribute('aria-label', 'Open Vektra settings');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = 'Vektra';
    this.launcher.append(dot, label);
    this.launcher.addEventListener('click', (event) => {
      if (this.suppressLauncherClick) {
        event.preventDefault();
        this.suppressLauncherClick = false;
        return;
      }
      this.setOpen(true);
    });
    this.launcher.addEventListener('pointerdown', (event) => this.startDrag(event, this.launcher, true));
    root.append(style, this.windowElement, this.launcher);
    document.body.append(this.host);
    this.positionWindow();
    this.host.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
    header.addEventListener('pointerdown', (event) => this.startDrag(event, header));
    this.setOpen(true);
  }

  focus(): void {
    this.setOpen(true);
    this.host.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close Vektra settings"]')?.focus();
  }

  setAutoplayEnabled(enabled: boolean): void {
    this.stopAutoplay.hidden = !enabled;
  }

  setContext(context: 'analysis' | 'game'): void {
    if (context === this.context) return;
    this.context = context;
    const frame = this.host.shadowRoot?.querySelector<HTMLIFrameElement>('iframe');
    if (!frame) return;
    const url = new URL(frame.src);
    url.searchParams.set('context', context);
    frame.src = url.toString();
  }

  destroy(): void {
    this.removeFrameMessageListener();
    this.host.remove();
  }

  private setOpen(open: boolean): void {
    this.windowElement.hidden = !open;
    this.launcher.hidden = open;
    this.launcher.setAttribute('aria-expanded', String(open));
    if (!open) this.launcher.focus();
  }

  private positionWindow(): void {
    const board = document.querySelector<HTMLElement>('wc-chess-board');
    const boardRect = board?.getBoundingClientRect();
    const width = this.windowElement.getBoundingClientRect().width;
    const gap = 16;
    let left = Math.max(gap, window.innerWidth - width - gap);
    let top = gap;

    if (boardRect && boardRect.width > 0) {
      const rightRoom = window.innerWidth - boardRect.right - gap * 2;
      const leftRoom = boardRect.left - gap * 2;
      if (rightRoom >= width) {
        left = boardRect.right + gap;
      } else if (leftRoom >= width) {
        left = boardRect.left - width - gap;
      }
      top = boardRect.top;
    }

    top = Math.max(gap, Math.min(window.innerHeight - this.windowElement.offsetHeight - gap, top));
    Object.assign(this.host.style, { left: `${left}px`, top: `${top}px` });
  }

  private keepOnscreen(): void {
    const rect = this.windowElement.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left));
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top));
    Object.assign(this.host.style, { left: `${left}px`, top: `${top}px` });
  }

  private startDrag(event: PointerEvent, handle: HTMLElement, isLauncher = false): void {
    if (
      event.button !== 0 ||
      (!isLauncher && event.target instanceof Element && event.target.closest('button'))
    ) return;
    const rect = this.host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.left;
    const originY = rect.top;
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const left = Math.max(0, Math.min(window.innerWidth - rect.width, originX + next.clientX - startX));
      const top = Math.max(0, Math.min(window.innerHeight - rect.height, originY + next.clientY - startY));
      if (moved) {
        Object.assign(this.host.style, {
          left: `${left}px`,
          top: `${top}px`,
          right: 'auto',
          transform: 'none',
        });
      }
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      if (isLauncher && moved) {
        this.suppressLauncherClick = true;
        window.setTimeout(() => {
          this.suppressLauncherClick = false;
        });
      }
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop, { once: true });
    handle.addEventListener('pointercancel', stop, { once: true });
    event.preventDefault();
  }
}
