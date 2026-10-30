import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeChrome, type FakeChrome, type FakePort } from './fixtures/chrome';

/** A stand-in Stockfish worker: records commands and can answer like UCI. */
class FakeWorker {
  static all: FakeWorker[] = [];
  readonly commands: string[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: Partial<ErrorEvent> & { preventDefault: () => void }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWorker.all.push(this);
  }

  postMessage(command: string): void {
    this.commands.push(command);
    // Enough of UCI for UciEngine to start a search.
    if (command === 'uci') queueMicrotask(() => this.emit('uciok'));
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'));
  }

  emit(line: string): void {
    this.onmessage?.({ data: line });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const REQUEST = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  multipv: 1,
  limit: { depth: 5 },
  strength: { skillLevel: 20, limitStrength: false, elo: 3190 },
};

let fake: FakeChrome;
const revoked: string[] = [];

beforeEach(async () => {
  FakeWorker.all = [];
  revoked.length = 0;
  fake = installFakeChrome();
  vi.stubGlobal('Worker', FakeWorker);
  // A downloaded full engine in Cache Storage.
  vi.stubGlobal('caches', {
    open: async () => ({ match: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }) }),
    delete: async () => true,
  });
  class TestURL extends URL {
    static createObjectURL = () => 'blob:chrome-extension://test/engine';
    static revokeObjectURL = (url: string) => void revoked.push(url);
  }
  vi.stubGlobal('URL', TestURL);
  vi.resetModules();
  await import('../src/engine/offscreen');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const types = (port: FakePort) => port.posted.map((m) => (m as { type: string }).type);

describe('offscreen engine host', () => {
  it('queues searches sent before the worker is ready, then runs them', async () => {
    const port = fake.connectToHost('vektra-engine');
    port.deliver({ type: 'analyze', id: 1, ...REQUEST });
    expect(FakeWorker.all).toHaveLength(0);

    await vi.waitFor(() => expect(types(port)).toEqual(['ready']));
    expect(port.posted[0]).toEqual({ type: 'ready', engine: 'lite' });
    const worker = FakeWorker.all[0];
    expect(worker.url).toBe('chrome-extension://test/engine/stockfish-19-lite-single.js');
    await vi.waitFor(() => expect(worker.commands).toContain('go depth 5'));
    expect(worker.commands.indexOf('uci')).toBeLessThan(worker.commands.indexOf('go depth 5'));

    worker.emit('info depth 5 multipv 1 score cp 30 pv e2e4 e7e5');
    worker.emit('bestmove e2e4');
    await vi.waitFor(() => expect(types(port)).toContain('done'));
    expect(port.posted.at(-1)).toMatchObject({ type: 'done', id: 1, bestmove: 'e2e4' });
  });

  it('reports a worker error to the client and closes the port', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = fake.connectToHost('vektra-engine');
    await vi.waitFor(() => expect(types(port)).toEqual(['ready']));
    const worker = FakeWorker.all[0];
    const preventDefault = vi.fn();

    worker.onerror?.({ message: 'RuntimeError: unreachable', filename: 'stockfish.wasm', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(port.posted.at(-1)).toEqual({ type: 'error', message: 'RuntimeError: unreachable (stockfish.wasm)' });
    expect(worker.terminated).toBe(true);
    expect(port.closed).toBe(true);

    // A second error from the same worker is not reported again.
    worker.onerror?.({ message: 'again', preventDefault });
    expect(types(port).filter((t) => t === 'error')).toHaveLength(1);
  });

  it('stops the worker when the client disconnects', async () => {
    const port = fake.connectToHost('vektra-engine');
    await vi.waitFor(() => expect(types(port)).toEqual(['ready']));
    port.drop();
    expect(FakeWorker.all[0].terminated).toBe(true);
  });

  it('starts no worker for a client that disconnected while it was loading', async () => {
    const port = fake.connectToHost('vektra-engine');
    port.drop();
    await flush();
    expect(FakeWorker.all).toHaveLength(0);
    expect(port.posted).toEqual([]);
  });

  it('releases the full engine file when its last client disconnects', async () => {
    const port = fake.connectToHost('vektra-engine:full');
    await vi.waitFor(() => expect(port.posted[0]).toEqual({ type: 'ready', engine: 'full' }));
    expect(FakeWorker.all[0].url).toContain(encodeURIComponent('blob:chrome-extension://test/engine'));

    // Removing the engine retires its file, but a client is still using it.
    for (const listener of fake.runtime.onMessage.listeners) listener({ type: 'vektra:full-engine:remove' } as never, {}, () => {});
    await flush();
    expect(revoked).toEqual([]);

    port.drop();
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(revoked).toEqual(['blob:chrome-extension://test/engine']);
  });

  it('ignores ports that are not engine ports', async () => {
    fake.connectToHost('something-else');
    await flush();
    expect(FakeWorker.all).toHaveLength(0);
  });
});
