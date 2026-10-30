import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from '../src/analysis/analysisCache';
import { AnalysisController, type AnalysisEngine } from '../src/content/analysisController';
import type { BoardState } from '../src/content/boardReader';
import { replay } from '../src/chess/replay';
import type { AnalyzeRequest, SearchResult } from '../src/engine/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { installFakeChrome } from './fixtures/chrome';

const SANS = ['e4', 'e5', 'Nf3'];

/**
 * A stand-in engine. `search` answers each request; by default every position
 * is equal and the best move is the one played.
 */
class FakeEngine implements AnalysisEngine {
  engine: 'lite' | 'full' | null = null;
  onError?: (message: string) => void;
  full = false;
  disconnected = false;
  private waiting: ((r: SearchResult | null) => void)[] = [];

  constructor(
    private reports: 'lite' | 'full',
    private search: (req: AnalyzeRequest) => Promise<SearchResult | null> = async (req) => ({
      bestmove: null,
      lines: [{ multipv: 1, depth: req.limit.depth ?? 1, score: { type: 'cp', value: 0 }, pv: ['a2a3'] }],
    }),
  ) {}

  setFullEngine(full: boolean): void {
    this.full = full;
  }

  analyze(req: AnalyzeRequest): Promise<SearchResult | null> {
    this.engine = this.reports;
    return this.search(req);
  }

  /** A search that only ends when the engine is disconnected. */
  hang = (): Promise<SearchResult | null> => new Promise((resolve) => this.waiting.push(resolve));

  disconnect(): void {
    this.disconnected = true;
    this.engine = null;
    for (const resolve of this.waiting.splice(0)) resolve(null);
  }
}

let stored: Record<string, unknown>;

beforeEach(() => {
  stored = installFakeChrome().local.data;
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
});

afterEach(() => {
  document.getElementById('vektra-analysis-panel')?.remove();
  vi.unstubAllGlobals();
  delete (navigator as { hardwareConcurrency?: number }).hardwareConcurrency;
});

function boardState(sans: string[]): BoardState {
  const { fens } = replay(sans);
  return {
    fen: fens[fens.length - 1],
    ply: sans.length,
    source: 'replay',
    flipped: false,
    sans,
    inVariation: false,
    board: document.createElement('div'),
  };
}

/** A controller whose engines are made by `make`; returns every engine it made. */
function setup(settings: Partial<Settings>, make: (made: FakeEngine[]) => FakeEngine) {
  const made: FakeEngine[] = [];
  const controller = new AnalysisController(
    () => ({ ...DEFAULT_SETTINGS, ...settings }),
    () => {
      const engine = make(made);
      made.push(engine);
      return engine;
    },
  );
  controller.update(boardState(SANS));
  return { controller, made };
}

const panelText = () => document.getElementById('vektra-analysis-panel')?.textContent ?? '';

function clickButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#vektra-analysis-panel button')].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button in: ${panelText()}`);
  button.click();
}

const cacheEntries = () => (stored.analysisCache ?? []) as CacheEntry[];

describe('analysis engines', () => {
  it('are all disconnected once an analysis finishes', async () => {
    const { made } = setup({ engine: 'lite' }, () => new FakeEngine('lite'));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(panelText()).toContain('depth'));
    expect(made).toHaveLength(4);
    expect(made.every((e) => e.disconnected)).toBe(true);
  });

  it('keep the label and saved profile of the engine that ran after they are released', async () => {
    const { made } = setup({ engine: 'full' }, () => new FakeEngine('full'));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(cacheEntries()).toHaveLength(1));
    expect(made).toHaveLength(2);
    expect(made.every((e) => e.full && e.disconnected)).toBe(true);
    expect(panelText()).toContain('Stockfish 19, depth');
    expect(cacheEntries()[0].analysis.engine).toBe('Stockfish 19');
    expect(cacheEntries()[0].profile?.engine).toBe('full');
  });

  it('label a full-engine run that fell back to lite as lite', async () => {
    setup({ engine: 'full' }, () => new FakeEngine('lite'));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(cacheEntries()).toHaveLength(1));
    expect(panelText()).toContain('Stockfish 19 lite, depth');
    expect(cacheEntries()[0].profile?.engine).toBe('lite');
  });

  it('are all disconnected when the analysis fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { made } = setup({ engine: 'lite' }, () => new FakeEngine('lite', async () => {
      throw new Error('worker crashed');
    }));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(panelText()).toContain('Analysis failed: worker crashed'));
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((e) => e.disconnected)).toBe(true);
  });

  it('are all disconnected when an engine drops the search', async () => {
    const { made } = setup({ engine: 'lite' }, () => new FakeEngine('lite', async () => null));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(panelText()).toContain('Analysis stopped before completion'));
    expect(made.every((e) => e.disconnected)).toBe(true);
  });

  it('are all disconnected when the analysis is cancelled', async () => {
    const { made } = setup({ engine: 'lite' }, () => {
      const engine: FakeEngine = new FakeEngine('lite', () => engine.hang());
      return engine;
    });
    clickButton('Analyze game');
    await vi.waitFor(() => expect(made).toHaveLength(4));
    expect(made.some((e) => e.disconnected)).toBe(false);
    clickButton('Cancel');
    expect(made.every((e) => e.disconnected)).toBe(true);
    expect(panelText()).toContain('Analysis cancelled.');
    await Promise.resolve();
    expect(cacheEntries()).toEqual([]);
  });

  it('are made fresh for every run', async () => {
    const { made } = setup({ engine: 'lite' }, () => new FakeEngine('lite'));
    clickButton('Analyze game');
    await vi.waitFor(() => expect(panelText()).toContain('depth'));
    const first = [...made];
    clickButton('Analyze again');
    await vi.waitFor(() => expect(made).toHaveLength(8));
    await vi.waitFor(() => expect(panelText()).toContain('depth'));
    expect(made.slice(4).every((e) => !first.includes(e))).toBe(true);
    expect(made.every((e) => e.disconnected)).toBe(true);
  });

  it('are disconnected when the controller is disposed mid-run', async () => {
    const { controller, made } = setup({ engine: 'lite' }, () => {
      const engine: FakeEngine = new FakeEngine('lite', () => engine.hang());
      return engine;
    });
    clickButton('Analyze game');
    await vi.waitFor(() => expect(made).toHaveLength(4));
    controller.dispose();
    expect(made.every((e) => e.disconnected)).toBe(true);
  });
});
