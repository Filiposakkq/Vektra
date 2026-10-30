import type { AnalyzeRequest, SearchResult } from './protocol';
import { parseBestMove, parseInfo, type PvLine } from './uci';

/**
 * Drives one Stockfish instance over UCI. Searches run one at a time; starting
 * a new search stops the current one and waits for its "bestmove" first, so
 * output from an old search never leaks into a new one.
 */
export class UciEngine {
  private listeners = new Set<(line: string) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private searching = false;
  private hashMb = 16;
  private ready: Promise<void>;

  constructor(private send: (command: string) => void) {
    this.ready = (async () => {
      const ok = this.waitFor((l) => l === 'uciok');
      this.send('uci');
      await ok;
    })();
  }

  /** Feed every line of engine output here. */
  handleLine(line: string): void {
    for (const l of [...this.listeners]) l(line);
  }

  private waitFor(match: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line);
        if (!match(line)) return;
        this.listeners.delete(listener);
        resolve(line);
      };
      this.listeners.add(listener);
    });
  }

  private async isReady(): Promise<void> {
    const ok = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  /**
   * Search a position. onUpdate receives the current lines (sorted by multipv)
   * each time a full set for a new depth arrives. Resolves to null if a newer
   * search or stop() superseded this one.
   */
  analyze(req: AnalyzeRequest, onUpdate?: (lines: PvLine[]) => void): Promise<SearchResult | null> {
    const gen = ++this.generation;
    if (this.searching) this.send('stop');

    const run = async (): Promise<SearchResult | null> => {
      await this.ready;
      if (gen !== this.generation) return null;

      const limited = req.strength.limitStrength;
      const requestedHashMb = req.hashMb === undefined
        ? this.hashMb
        : Math.max(1, Math.min(128, Math.round(req.hashMb)));
      if (requestedHashMb !== this.hashMb) {
        this.send(`setoption name Hash value ${requestedHashMb}`);
        this.hashMb = requestedHashMb;
      }
      this.send(`setoption name MultiPV value ${req.multipv}`);
      this.send(`setoption name UCI_LimitStrength value ${limited}`);
      if (limited) this.send(`setoption name UCI_Elo value ${req.strength.elo}`);
      this.send(`setoption name Skill Level value ${limited ? 20 : req.strength.skillLevel}`);
      await this.isReady();
      if (gen !== this.generation) return null;

      const lines = new Map<number, PvLine>();
      const sorted = () => [...lines.values()].sort((a, b) => a.multipv - b.multipv);
      const onLine = (line: string) => {
        const info = parseInfo(line);
        if (!info) return;
        lines.set(info.multipv, info);
        // Report once the last multipv line of a depth arrives.
        if (info.multipv === req.multipv || lines.size === 1) onUpdate?.(sorted());
      };

      this.send(`position fen ${req.fen}`);
      const done = this.waitFor((l) => parseBestMove(l) !== undefined, onLine);
      const { depth, movetimeMs } = req.limit;
      this.send(
        'go' + (depth ? ` depth ${depth}` : '') + (movetimeMs ? ` movetime ${movetimeMs}` : '') +
          (!depth && !movetimeMs ? ' depth 16' : ''),
      );
      this.searching = true;
      const bestLine = await done;
      this.searching = false;

      if (gen !== this.generation) return null;
      return { bestmove: parseBestMove(bestLine) ?? null, lines: sorted() };
    };

    const result = this.chain.then(run, run);
    this.chain = result;
    return result;
  }

  /** Cancel any running or queued search. */
  stop(): void {
    this.generation++;
    if (this.searching) this.send('stop');
  }
}
