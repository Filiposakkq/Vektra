import { CATEGORIES, CATEGORY_LABELS } from '../analysis/classify';
import { accuracyGrade, describeMoveAnalysis, type GameAnalysis, type PhaseSummary } from '../analysis/gameAnalysis';
import { PHASES, PHASE_LABELS } from '../analysis/phases';
import { categoryBadge } from './categoryStyle';
import { renderEvalGraph } from './evalGraph';
import { BODY_FONT, THEME } from './theme';

export interface PanelCallbacks {
  onAnalyze(): void;
  onCancel(): void;
  onExport(): void;
  onExportPdf(): void;
  onSelectPly(ply: number): void;
}

const PANEL_ID = 'vektra-analysis-panel';
const COLLAPSED_KEY = 'analysisPanelCollapsed';
const POSITION_KEY = 'analysisPanelPosition';
const WIDTH = 340;
const GAP = 16;

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
    padding: '7px 12px',
    border: primary ? '0' : `1px solid ${THEME.line}`,
    borderRadius: '7px',
    background: primary ? THEME.brass : THEME.claret,
    color: primary ? THEME.brassText : THEME.bone,
    font: `650 12.5px ${BODY_FONT}`,
    cursor: 'pointer',
  }, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A small section heading inside the panel. */
function heading(text: string): HTMLDivElement {
  return el('div', { margin: '14px 0 6px', color: THEME.muted, font: `650 12px ${BODY_FONT}` }, text);
}

/**
 * Full-game analysis in its own window beside the board: start button,
 * progress, accuracy, eval graph, the selected move, category counts and
 * export. It opens next to the board (right if there is room, else left),
 * can be dragged by its title bar and folded to the bar, and remembers both.
 */
export class AnalysisPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private subtitle: HTMLSpanElement;
  private collapsed = false;
  private analysis: GameAnalysis | null = null;
  private currentPly: number | null = null;
  /** Where the user dragged it, as viewport coordinates; null until then. */
  private position: { left: number; top: number } | null = null;
  private placed = false;
  /** On a finished bot game the action is a review that jumps to your biggest mistake. */
  reviewMode = false;
  /** Whether the legend of the board marks is open. */
  private legendOpen = false;
  private readonly onResize = () => this.keepOnscreen();

  /** findBoard: the board element, to open beside it. */
  constructor(
    private cb: PanelCallbacks,
    private findBoard: () => HTMLElement | null = () => null,
  ) {
    document.getElementById(PANEL_ID)?.remove();
    this.root = el('div', {
      position: 'fixed',
      zIndex: '2147483646',
      width: `${WIDTH}px`,
      maxWidth: `calc(100vw - ${GAP * 2}px)`,
      maxHeight: `calc(100vh - ${GAP * 2}px)`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: THEME.oxblood,
      color: THEME.bone,
      border: '1px solid rgba(255, 245, 235, 0.1)',
      borderRadius: '14px',
      font: `13.5px/1.5 ${BODY_FONT}`,
      boxShadow: '0 18px 48px rgba(0, 0, 0, 0.5)',
    });
    this.root.id = PANEL_ID;

    // The title bar folds the panel on a click and moves it on a drag. It is
    // not a <button>, so the panel's first button stays its main action.
    const header = el('div', {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '11px 14px 10px 16px',
      borderBottom: `1px solid ${THEME.hairline}`,
      cursor: 'grab',
      userSelect: 'none',
      touchAction: 'none',
    });
    header.title = 'Drag to move. Click to fold or unfold.';
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.setAttribute('aria-controls', `${PANEL_ID}-content`);
    const titles = el('div', { display: 'grid', gap: '1px', minWidth: '0' });
    this.subtitle = el('span', {
      color: THEME.muted,
      fontSize: '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    titles.append(el('span', { font: `700 15px/1.25 ${BODY_FONT}` }, 'Game analysis'), this.subtitle);
    const chevron = el('span', {
      flex: 'none',
      width: '7px',
      height: '7px',
      borderRight: `1.6px solid ${THEME.muted}`,
      borderBottom: `1.6px solid ${THEME.muted}`,
      transition: 'transform .15s ease',
    });
    header.append(titles, chevron);

    this.body = el('div', { padding: '12px 16px 16px', overflowY: 'auto', overscrollBehavior: 'contain' });
    this.body.id = `${PANEL_ID}-content`;

    const setCollapsed = (collapsed: boolean) => {
      this.collapsed = collapsed;
      this.body.style.display = collapsed ? 'none' : 'block';
      header.style.borderBottomColor = collapsed ? 'transparent' : THEME.hairline;
      chevron.style.transform = collapsed ? 'translateY(-2px) rotate(45deg)' : 'translateY(2px) rotate(225deg)';
      header.setAttribute('aria-expanded', String(!collapsed));
    };
    setCollapsed(false);
    let dragged = false;
    header.addEventListener('click', () => {
      if (dragged) {
        dragged = false;
        return;
      }
      setCollapsed(!this.collapsed);
      void chrome.storage.local.set({ [COLLAPSED_KEY]: this.collapsed }).catch(() => {});
      this.keepOnscreen();
    });
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      header.click();
    });
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = this.root.getBoundingClientRect();
      const [startX, startY] = [event.clientX, event.clientY];
      const move = (next: PointerEvent) => {
        if (!dragged && Math.abs(next.clientX - startX) + Math.abs(next.clientY - startY) <= 3) return;
        dragged = true;
        header.style.cursor = 'grabbing';
        this.moveTo(rect.left + next.clientX - startX, rect.top + next.clientY - startY);
      };
      const stop = () => {
        header.removeEventListener('pointermove', move);
        header.style.cursor = 'grab';
        if (dragged && this.position) {
          void chrome.storage.local.set({ [POSITION_KEY]: this.position }).catch(() => {});
        }
      };
      header.setPointerCapture?.(event.pointerId);
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', stop, { once: true });
      header.addEventListener('pointercancel', stop, { once: true });
    });

    // Remember whether the panel was folded and where it was put.
    chrome.storage.local
      .get([COLLAPSED_KEY, POSITION_KEY])
      .then((v) => {
        setCollapsed(v[COLLAPSED_KEY] === true);
        const saved = v[POSITION_KEY] as { left?: unknown; top?: unknown } | undefined;
        if (typeof saved?.left === 'number' && typeof saved.top === 'number') {
          this.moveTo(saved.left, saved.top);
        }
      })
      .catch(() => {});

    this.root.append(header, this.body);
    window.addEventListener('resize', this.onResize);
    this.ensureMounted();
  }

  /** Mount on the page and, the first time, open beside the board. */
  ensureMounted(): void {
    if (this.root.parentElement !== document.body) document.body.appendChild(this.root);
    if (!this.placed) this.placeBesideBoard();
  }

  private placeBesideBoard(): void {
    if (this.position) return;
    const board = this.findBoard()?.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - GAP * 2);
    if (!board || board.width <= 0) {
      // No board yet: the bottom-right corner until there is one.
      Object.assign(this.root.style, { left: '', top: '', right: '12px', bottom: '44px' });
      return;
    }
    let left = window.innerWidth - width - GAP;
    if (window.innerWidth - board.right - GAP * 2 >= width) left = board.right + GAP;
    else if (board.left - GAP * 2 >= width) left = board.left - width - GAP;
    this.placed = true;
    this.applyPosition(left, Math.max(GAP, board.top));
  }

  private moveTo(left: number, top: number): void {
    this.placed = true;
    this.position = this.clamp(left, top);
    this.applyPosition(this.position.left, this.position.top);
  }

  private clamp(left: number, top: number): { left: number; top: number } {
    const rect = this.root.getBoundingClientRect();
    const width = rect.width || WIDTH;
    return {
      left: Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, left))),
      top: Math.round(Math.max(8, Math.min(window.innerHeight - 48, top))),
    };
  }

  private applyPosition(left: number, top: number): void {
    Object.assign(this.root.style, {
      left: `${left}px`,
      top: `${top}px`,
      right: '',
      bottom: '',
      // Never past the bottom of the window; the body scrolls instead.
      maxHeight: `calc(100vh - ${top + GAP}px)`,
    });
  }

  private keepOnscreen(): void {
    const rect = this.root.getBoundingClientRect();
    if (!this.placed || rect.width === 0) return;
    const { left, top } = this.clamp(rect.left, rect.top);
    this.applyPosition(left, top);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    if (visible && !this.placed) this.placeBesideBoard();
  }

  showIdle(moveCount: number, stale = false, message?: string): void {
    this.analysis = null;
    this.subtitle.textContent = moveCount ? `${moveCount} moves` : '';
    const note = message ?? (stale
      ? 'The moves changed since the last analysis.'
      : this.reviewMode && moveCount
        ? 'Rate every move of this game and go straight to your biggest mistake.'
        : moveCount
          ? `Rate all ${moveCount} moves and see where the game turned.`
          : 'No moves to analyze yet.');
    const label = stale ? 'Analyze again' : this.reviewMode ? 'Review this game' : 'Analyze game';
    this.body.replaceChildren(
      el('p', { margin: '0 0 12px', color: THEME.muted }, note),
      ...(moveCount ? [button(label, () => this.cb.onAnalyze(), true)] : []),
    );
  }

  showProgress(done: number, total: number): void {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const track = el('div', {
      height: '5px',
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
      el('div', { color: THEME.muted, fontVariantNumeric: 'tabular-nums' }, `Analyzing positions… ${done} of ${total}`),
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
    this.subtitle.textContent = a.opening ?? `${a.moves.length} moves`;
    this.subtitle.title = a.opening ?? '';

    // Accuracy as a light square and a dark square, one per side.
    const acc = el('div', {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1px',
      border: `1px solid ${THEME.line}`,
      borderRadius: '9px',
      overflow: 'hidden',
      background: THEME.line,
    });
    for (const [color, label, bg, fg] of [
      ['w', 'White', '#ebe6df', '#26231f'],
      ['b', 'Black', THEME.ink, THEME.bone],
    ] as const) {
      const box = el('div', { background: bg, color: fg, padding: '10px 12px 11px' });
      const rating = el('div', { fontSize: '11.5px', opacity: '0.7', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }, `Game rating ~${a.summary[color].rating}`);
      rating.title = 'A rough rating for how this side played this game, from its accuracy.';
      box.append(
        el('div', { fontSize: '12px', opacity: '0.7' }, `${label} accuracy`),
        el('div', { font: `750 28px/1.1 ${BODY_FONT}`, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }, `${a.summary[color].accuracy.toFixed(1)}%`),
        rating,
      );
      acc.append(box);
    }

    const graphWrap = el('div', { marginTop: '12px' });
    graphWrap.append(renderEvalGraph(a, this.currentPly, (ply) => this.cb.onSelectPly(ply)));

    // The selected move, as a sentence.
    const current = this.currentPly ? a.moves[this.currentPly - 1] : undefined;
    const info = el('div', {
      marginTop: '12px',
      padding: '10px 12px',
      border: `1px solid ${THEME.hairline}`,
      borderRadius: '9px',
      background: THEME.claret,
    });
    if (current) {
      const num = `${Math.ceil(current.ply / 2)}${current.color === 'w' ? '.' : '...'}`;
      const explanation = describeMoveAnalysis(current);
      const title = el('div', { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '650' });
      title.append(
        categoryBadge(current.category, 18),
        el('span', {}, `${num} ${current.san} was ${articleFor(CATEGORY_LABELS[current.category])}`),
      );
      const better = current.bestSan && current.bestMove !== current.uci && current.category !== 'best'
        ? ` Best was ${current.bestSan}.`
        : '';
      info.append(
        title,
        ...(current.reason ? [el('div', { marginTop: '5px', fontSize: '13px' }, current.reason)] : []),
        el(
          'div',
          { marginTop: '4px', color: THEME.muted, fontSize: '12.5px', fontVariantNumeric: 'tabular-nums' },
          `Move accuracy ${current.accuracy.toFixed(1)}%. Win chance ${current.winBefore.toFixed(1)}% to ${current.winAfter.toFixed(1)}%.${better}`,
        ),
      );
      info.title = explanation;
      info.setAttribute('role', 'group');
      info.setAttribute('aria-label', explanation);
    } else {
      info.append(el('span', { color: THEME.muted }, 'Choose a move or a point on the graph to see how it was rated.'));
    }

    const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });
    const head = el('tr');
    head.append(
      el('th', { textAlign: 'left', fontWeight: '500', color: THEME.muted, paddingBottom: '4px' }, ''),
      el('th', { textAlign: 'right', fontWeight: '500', color: THEME.muted, width: '52px', paddingBottom: '4px' }, 'White'),
      el('th', { textAlign: 'right', fontWeight: '500', color: THEME.muted, width: '52px', paddingBottom: '4px' }, 'Black'),
    );
    table.append(head);
    for (const cat of CATEGORIES) {
      const quiet = !a.summary.w.counts[cat] && !a.summary.b.counts[cat];
      const row = el('tr', { opacity: quiet ? '0.4' : '1', borderTop: `1px solid ${THEME.hairline}` });
      const name = el('td', { padding: '4px 0' });
      const wrap = el('span', { display: 'inline-flex', alignItems: 'center', gap: '8px' });
      wrap.append(categoryBadge(cat, 16), el('span', {}, CATEGORY_LABELS[cat]));
      name.append(wrap);
      row.append(
        name,
        el('td', { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: '600' }, String(a.summary.w.counts[cat])),
        el('td', { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: '600' }, String(a.summary.b.counts[cat])),
      );
      table.append(row);
    }

    // Each part of the game, graded like a move.
    const phases = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });
    phases.append(head.cloneNode(true));
    for (const phase of PHASES) {
      const row = el('tr', { borderTop: `1px solid ${THEME.hairline}` });
      row.append(
        el('td', { padding: '4px 0' }, PHASE_LABELS[phase]),
        phaseCell(a.summary.w.phases[phase]),
        phaseCell(a.summary.b.phases[phase]),
      );
      phases.append(row);
    }

    const actions = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '14px' });
    actions.append(
      button('Export PDF', () => this.cb.onExportPdf(), true),
      button('Export JSON', () => this.cb.onExport()),
      button('Analyze again', () => this.cb.onAnalyze()),
    );

    this.body.replaceChildren(
      acc,
      graphWrap,
      info,
      heading('Phases'),
      phases,
      heading('Move ratings'),
      table,
      actions,
      el(
        'div',
        { marginTop: '10px', color: THEME.muted, fontSize: '11.5px', lineHeight: '1.45' },
        `${a.engine ?? 'Stockfish'}, depth ${a.depth}. Accuracy and ratings are engine estimates, not official ratings.`,
      ),
      this.legendToggle(),
      ...(this.legendOpen ? [legend()] : []),
    );
  }

  /** A link that opens or closes the legend of what Vektra draws. */
  private legendToggle(): HTMLButtonElement {
    const b = el('button', {
      marginTop: '8px',
      padding: '0',
      border: '0',
      background: 'none',
      color: THEME.link,
      font: `600 12px ${BODY_FONT}`,
      cursor: 'pointer',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
    }, this.legendOpen ? 'Hide what the board marks mean' : 'What do the arrows and numbers mean?');
    b.type = 'button';
    b.setAttribute('aria-expanded', String(this.legendOpen));
    b.addEventListener('click', () => {
      this.legendOpen = !this.legendOpen;
      this.render();
    });
    return b;
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}

/** One side's grade for a phase: a rating badge and its accuracy, Book, or a dash when it wasn't reached. */
function phaseCell(p: PhaseSummary): HTMLTableCellElement {
  const cell = el('td', { textAlign: 'right', width: '70px', fontVariantNumeric: 'tabular-nums', fontWeight: '600' });
  if (!p.moves) {
    cell.textContent = '–';
    cell.style.color = THEME.muted;
    return cell;
  }
  const wrap = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px' });
  if (p.accuracy === null) wrap.append(categoryBadge('book', 14), el('span', {}, 'Book'));
  else wrap.append(categoryBadge(accuracyGrade(p.accuracy), 14), el('span', {}, `${Math.round(p.accuracy)}%`));
  cell.append(wrap);
  return cell;
}

/** What the analysis draws on the board, and what the numbers are. */
function legend(): HTMLDivElement {
  const box = el('div', {
    marginTop: '8px',
    padding: '10px 12px',
    border: `1px solid ${THEME.hairline}`,
    borderRadius: '9px',
    background: THEME.claret,
    fontSize: '12.5px',
    lineHeight: '1.5',
  });
  const items: [string, string][] = [
    ['Numbered arrows', "The engine's best line from the position shown: 1 is the move to play, 2 the reply, 3 the move after."],
    ['Score on arrow 1', "From White's side: +1.5 means White is 1.5 pawns better, -1.5 Black. M3 means mate in 3."],
    ['Tinted squares', 'Where move 1 goes from and to.'],
    ['Badge on a square', 'How the move just played was rated, Brilliant to Blunder.'],
    ['Eval graph', "White's winning chances through the game. Click it to go to a move; dots mark the notable ones."],
    ['Accuracy', "How close each side's moves were to the engine's, 0 to 100%. Fitted to land near Chess.com's Game Review."],
    ['Game rating', 'A rough rating for how a side played this one game, from its accuracy.'],
    ['Phases', "Accuracy in the opening, middlegame and endgame, with the badge it would get as a move. A dash: not reached."],
  ];
  for (const [term, text] of items) {
    const row = el('div', { marginTop: term === items[0][0] ? '0' : '6px' });
    row.append(el('b', { fontWeight: '650' }, `${term}. `), el('span', { color: THEME.muted }, text));
    box.append(row);
  }
  return box;
}

/** "a mistake", "an inaccuracy", "the best move" style wording for a category label. */
function articleFor(label: string): string {
  const lower = label.toLowerCase();
  if (lower === 'best') return 'the best move';
  if (lower === 'book') return 'a book move';
  if (lower === 'miss') return 'a miss';
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}${['brilliant', 'great', 'excellent', 'good'].includes(lower) ? ' move' : ''}`;
}
