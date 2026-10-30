import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from '../src/engine/client';
import type { HostMessage } from '../src/engine/protocol';

/** A stand-in for chrome.runtime whose port lets the test send host messages. */
function stubRuntime() {
  const ports: { name: string; send: (msg: HostMessage) => void; disconnect: () => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      sendMessage: async () => undefined,
      connect: ({ name }: { name: string }) => {
        const onMessage: ((msg: HostMessage) => void)[] = [];
        const onDisconnect: (() => void)[] = [];
        const port = {
          onMessage: { addListener: (f: (msg: HostMessage) => void) => onMessage.push(f) },
          onDisconnect: { addListener: (f: () => void) => onDisconnect.push(f) },
          postMessage: () => {},
          disconnect: () => {},
        };
        ports.push({
          name,
          send: (msg) => onMessage.forEach((f) => f(msg)),
          disconnect: () => onDisconnect.forEach((f) => f()),
        });
        return port;
      },
    },
  });
  return ports;
}

const REQUEST = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  multipv: 1,
  limit: { depth: 1 },
  strength: { skillLevel: 20, limitStrength: false, elo: 3190 },
};

describe('EngineClient engine', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the engine the host started, including a lite fallback for full', async () => {
    const ports = stubRuntime();
    const client = new EngineClient();
    client.setFullEngine(true);
    expect(client.engine).toBeNull();

    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    expect(ports[0].name).toBe('vektra-engine:full');
    ports[0].send({ type: 'ready', engine: 'lite' });
    expect(client.engine).toBe('lite');
    ports[0].send({ type: 'done', id: 1, bestmove: 'e2e4', lines: [] });
    await expect(search).resolves.toEqual({ bestmove: 'e2e4', lines: [] });
  });

  it('forgets it when the connection closes or is replaced', async () => {
    const ports = stubRuntime();
    const client = new EngineClient();
    void client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0].send({ type: 'ready', engine: 'lite' });
    expect(client.engine).toBe('lite');
    ports[0].disconnect();
    expect(client.engine).toBeNull();

    void client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(2));
    ports[1].send({ type: 'ready', engine: 'full' });
    expect(client.engine).toBe('full');
    client.disconnect();
    expect(client.engine).toBeNull();
  });
});
