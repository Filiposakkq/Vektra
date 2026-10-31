import { CATEGORIES, CATEGORY_LABELS } from '../analysis/classify';
import { describeMoveAnalysis, type GameAnalysis } from '../analysis/gameAnalysis';
import { categoryBadge } from './categoryStyle';
import { renderEvalGraph } from './evalGraph';
import { BODY_FONT, DISPLAY_FONT, THEME, boardEdge } from './theme';

export interface PanelCallbacks {
  onAnalyze(): void;
  onCancel(): void;
  onExport(): void;
  onExportPdf(): void;
  onSelectPly(ply: number): void;
}

const PANEL_ID = 'vektra-analysis-panel';
const COLLAPSED_KEY = 'analysisPanelCollapsed';


function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', {
    padding: '8px 12px',
    border: `1px solid ${primary ? THEME.brass : THEME.line}`,
    borderRadius: '7px',
    background: primary ? THEME.brass : THEME.claret,
    color: primary ? THEME.oxblood : THEME.bone,
    font: `600 12px ${BODY_FONT}`,
    cursor: 'pointer',
  }, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Floating panel for full-game analysis: start button, progress, accuracy,
 * eval graph, category counts and export.
 */
export class AnalysisPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private collapsed = false;
  private analysis: GameAnalysis | null = null;
  private currentPly: number | null = null;

  /**
   * findSidebar: chess.com's right-hand sidebar to dock in, if the page has
   * one (the content script knows the page's markup).
   */
  constructor(
    private cb: PanelCallbacks,
    private findSidebar: () => HTMLElement | null = () => null,
  ) {
    document.getElementById(PANEL_ID)?.remove();
    this.root = el('div', {
      overflowY: 'auto',
      overflowX: 'hidden',
      background: THEME.oxblood,
      color: THEME.bone,
      border: `1px solid ${THEME.line}`,
      borderRadius: '12px',
      font: `13px/1.5 ${BODY_FONT}`,
      boxShadow: '0 8px 24px rgba(0,0,0,.24)',
    });
    this.root.id = PANEL_ID;

    const header = el('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      background: `linear-gradient(120deg, ${THEME.claret}, ${THEME.oxblood})`,
      cursor: 'pointer',
      userSelect: 'none',
      borderBottom: `1px solid ${THEME.line}`,
    });
    header.title = 'Expand or collapse the Vektra analysis panel';
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.setAttribute('aria-controls', `${PANEL_ID}-content`);
    header.append(el('span', {     font: `600 16px/1.2 ${DISPLAY_FONT}` }, 'Vektra · Game analysis'));
    const toggle = el('span', { color: THEME.brass, font: `600 18px/1 ${BODY_FONT}` }, '−');
    header.append(toggle);
    const setCollapsed = (collapsed: boolean) => {
      this.collapsed = collapsed;
      this.body.style.display = collapsed ? 'none' : 'block';
      toggle.textContent = collapsed ? '+' : '−';
      header.setAttribute('aria-expanded', String(!collapsed));
    };
    header.addEventListener('click', () => {
      setCollapsed(!this.collapsed);
      void chrome.storage.local.set({ [COLLAPSED_KEY]: this.collapsed }).catch(() => {});
    });
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      header.click();
    });
    // Remember whether the panel was folded away.
    chrome.storage.local
      .get(COLLAPSED_KEY)
      .then((v) => setCollapsed(v[COLLAPSED_KEY] === true))
      .catch(() => {});

    this.body = el('div', { padding: '14px' });
    this.body.id = `${PANEL_ID}-content`;
    this.root.append(header, boardEdge(), this.body);
    this.ensureMounted();
  }

  /**
   * Dock at the top of chess.com's right-hand sidebar when there is one, so
   * the panel sits beside the board instead of over the page; otherwise float
   * in the bottom-right corner. Called again on updates because chess.com can
   * re-render its sidebar.
   */
  ensureMounted(): void {
    const sidebar = this.findSidebar();
    if (sidebar) {
      if (this.root.parentElement === sidebar) return;
      Object.assign(this.root.style, {
        position: 'relative',
        right: '',
        bottom: '',
        width: 'auto',
        maxHeight: '48vh',
        zIndex: '1',
        margin: '0 0 8px',
        borderRadius: '12px',
        boxShadow: 'none',
      });
      sidebar.prepend(this.root);
    } else if (this.root.parentElement !== document.body) {
      Object.assign(this.root.style, {
        position: 'fixed',
        right: '12px',
        bottom: '44px',
        width: '300px',
        maxHeight: 'calc(100vh - 100px)',
        zIndex: '2147483646',
        margin: '0',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,.4)',
      });
      document.body.appendChild(this.root);
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  showIdle(moveCount: number, stale = false, message?: string): void {
    this.analysis = null;
    const note = message ?? (stale
      ? 'The moves changed since the last analysis.'
      : moveCount
        ? `Analyze all ${moveCount} moves with Stockfish.`
        : 'No moves to analyze yet.');
    this.body.replaceChildren(
      el('p', { margin: '0 0 10px', color: THEME.muted }, note),
      ...(moveCount ? [button(stale ? 'Analyze again' : 'Analyze game', () => this.cb.onAnalyze(), true)] : []),
    );
  }

  showProgress(done: number, total: number): void {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const track = el('div', {
      height: '6px',
      background: THEME.ink,
      borderRadius: '3px',
      overflow: 'hidden',
      margin: '8px 0 12px',
    });
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Game analysis progress');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(total));
    track.setAttribute('aria-valuenow', String(done));
    track.append(el('div', { height: '100%', width: `${pct}%`, background: THEME.brass, transition: 'width .2s' }));
    this.body.replaceChildren(
      el('div', { color: THEME.muted }, `Analyzing positions… ${done} of ${total}`),
      track,
      button('Cancel', () => this.cb.onCancel()),
    );
  }

  showResult(analysis: GameAnalysis, currentPly: number | null): void {
    this.analysis = analysis;
    this.currentPly = currentPly;
    this.render();
  }

  setCurrentPly(ply: number | null): void {
    if (ply === this.currentPly || !this.analysis) return;
    this.currentPly = ply;
    this.render();
  }

  private render(): void {
    const a = this.analysis;
    if (!a) return;

    // Accuracy as a light square and a dark square, one per side.
    const acc = el('div', { display: 'flex', gap: '1px', marginBottom: '12px', border: `1px solid ${THEME.line}`, borderRadius: '8px', overflow: 'hidden', background: THEME.line });
    for (const [color, label, bg, fg] of [
      ['w', 'White', THEME.bone, THEME.oxblood],
      ['b', 'Black', THEME.ink, THEME.bone],
    ] as const) {
      const box = el('div', { flex: '1', background: bg, color: fg, padding: '10px 11px' });
      box.append(
        el('div', { fontSize: '11px', opacity: '0.75', letterSpacing: '.02em' }, `${label} accuracy`),
        el('div', { font: `400 26px/1.1 ${DISPLAY_FONT}`, fontVariantNumeric: 'tabular-nums' }, `${a.summary[color].accuracy.toFixed(1)}%`),
      );
      acc.append(box);
    }

    const opening = a.opening
      ? el('div', { color: THEME.bone, font: `400 13px/1.3 ${DISPLAY_FONT}`, margin: '0 0 10px' }, a.opening)
      : null;
    const graph = renderEvalGraph(a, this.currentPly, (ply) => this.cb.onSelectPly(ply));

    const current = this.currentPly ? a.moves[this.currentPly - 1] : undefined;
    const info = el('div', {
      minHeight: '20px',
      margin: '10px 0',
      padding: '9px 10px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      border: `1px solid ${THEME.line}`,
      borderRadius: '8px',
      background: THEME.claret,
    });
    if (current) {
      const num = `${Math.ceil(current.ply / 2)}${current.color === 'w' ? '.' : '...'}`;
      const explanation = describeMoveAnalysis(current);
      info.append(
        categoryBadge(current.category, 16),
        el('span', {}, `${num} ${current.san}: ${CATEGORY_LABELS[current.category].toLowerCase()}`),
        el(
          'span',
          { color: THEME.muted },
          `Move accuracy ${current.accuracy.toFixed(1)}% · win chances ${current.winBefore.toFixed(1)}% → ${current.winAfter.toFixed(1)}%`,
        ),
      );
      info.title = explanation;
      info.setAttribute('role', 'group');
      info.setAttribute('aria-label', explanation);
      if (current.bestSan && current.bestMove !== current.uci && current.category !== 'best') {
        info.append(el('span', { color: THEME.muted }, `(best: ${current.bestSan})`));
      }
    } else {
      info.append(el('span', { color: THEME.muted }, 'Click a move or the graph to see how it was rated.'));
    }

    const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '10px' });
    const head = el('tr');
    head.append(
      el('th', { textAlign: 'left', fontWeight: '400', color: THEME.muted }, ''),
      el('th', { textAlign: 'right', fontWeight: '400', color: THEME.muted, width: '48px' }, 'White'),
      el('th', { textAlign: 'right', fontWeight: '400', color: THEME.muted, width: '48px' }, 'Black'),
    );
    table.append(head);
    for (const cat of CATEGORIES) {
      const quiet = !a.summary.w.counts[cat] && !a.summary.b.counts[cat];
      const row = el('tr', { opacity: quiet ? '0.45' : '1', borderTop: `1px solid ${THEME.claret}` });
      const name = el('td', { padding: '3px 0' });
      const wrap = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px' });
      wrap.append(categoryBadge(cat, 16), el('span', {}, CATEGORY_LABELS[cat]));
      name.append(wrap);
      row.append(
        name,
        el('td', { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, String(a.summary.w.counts[cat])),
        el('td', { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, String(a.summary.b.counts[cat])),
      );
      table.append(row);
    }

    const actions = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' });
    actions.append(
      button('Export PDF', () => this.cb.onExportPdf(), true),
      button('Export JSON', () => this.cb.onExport()),
      button('Analyze again', () => this.cb.onAnalyze()),
    );

    this.body.replaceChildren(
      acc,
      ...(opening ? [opening] : []),
      graph,
      info,
      table,
      actions,
      el(
        'div',
        { marginTop: '8px', color: THEME.muted, fontSize: '11px' },
        `${a.engine ?? 'Stockfish'}, depth ${a.depth}. Accuracy and move ratings are engine estimates, not official ratings.`,
      ),
    );
  }

  destroy(): void {
    this.root.remove();
  }
}
