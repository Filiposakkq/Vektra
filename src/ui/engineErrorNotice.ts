const NOTICE_ID = 'vektra-engine-error';

export class EngineErrorNotice {
  private readonly root: HTMLDivElement;
  private readonly message: HTMLSpanElement;
  private readonly retry: HTMLButtonElement;

  constructor() {
    document.getElementById(NOTICE_ID)?.remove();
    this.root = document.createElement('div');
    this.root.id = NOTICE_ID;
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'none',
      alignItems: 'center',
      gap: '10px',
      maxWidth: 'min(520px, calc(100vw - 32px))',
      padding: '12px 14px',
      border: '1px solid #b65b5b',
      borderRadius: '10px',
      background: '#23191b',
      color: '#fff',
      boxShadow: '0 8px 28px rgba(0,0,0,.4)',
      font: '13px/1.4 system-ui, sans-serif',
    });
    this.message = document.createElement('span');
    this.retry = document.createElement('button');
    this.retry.type = 'button';
    this.retry.textContent = 'Retry';
    Object.assign(this.retry.style, {
      flex: 'none',
      padding: '6px 10px',
      border: '1px solid #d88',
      borderRadius: '6px',
      background: '#3a2427',
      color: 'inherit',
      font: '600 12px system-ui, sans-serif',
      cursor: 'pointer',
    });
    this.root.append(this.message, this.retry);
    document.body.append(this.root);
  }

  show(detail: string, onRetry: () => void): void {
    this.message.textContent = 'Vektra could not run the chess engine. Retry the current position.';
    this.root.title = detail;
    this.retry.onclick = onRetry;
    this.root.style.display = 'flex';
  }

  clear(): void {
    this.root.style.display = 'none';
    this.retry.onclick = null;
  }

  destroy(): void {
    this.root.remove();
  }
}
