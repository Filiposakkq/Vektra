import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from '../src/engine/client';
import type { HostMessage } from '../src/engine/protocol';

interface FakePort {
  name: string;
  /** Closed by the client (port.disconnect()). */
  closed: boolean;
  posted: unknown[];
  /** A message from the engine host. */
  send: (msg: HostMessage) => void;
  /** The host side closing the port (fires onDisconnect). */
  drop: (lastError?: string) => void;
}

/**
 * A stand-in for chrome.runtime. `reply` answers the ENSURE_ENGINE message
 * (the background worker starting the engine host); the ports let the test
 * act as the host.
 */
function stubRuntime(reply: () => Promise<unknown> = async () => ({ ok: true })) {
  const ports: FakePort[] = [];
  const runtime: { lastError?: { message: string }; [key: string]: unknown } = {
    lastError: undefined,
    sendMessage: () => reply(),
    connect: ({ name }: { name: string }) => {
      const onMessage: ((msg: HostMessage) => void)[] = [];
      const onDisconnect: (() => void)[] = [];
      const fake: FakePort = {
        name,
        closed: false,
        posted: [],
        send: (msg) => onMessage.forEach((f) => f(msg)),
        drop: (lastError) => {
          runtime.lastError = lastError ? { message: lastError } : undefined;
          onDisconnect.forEach((f) => f());
          runtime.lastError = undefined;
        },
      };
      ports.push(fake);
      return {
        onMessage: { addListener: (f: (msg: HostMessage) => void) => onMessage.push(f) },
        onDisconnect: { addListener: (f: () => void) => onDisconnect.push(f) },
        postMessage: (msg: unknown) => fake.posted.push(msg),
        disconnect: () => {
          fake.closed = true;
        },
      };
    },
  };
  vi.stubGlobal('chrome', { runtime });
  return ports;
}

/** A reply the test settles by hand, to act while a connection is starting. */
function deferredReply() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { reply: () => promise, resolve, reject };
}

const openPorts = (ports: FakePort[]) => ports.filter((p) => !p.closed);

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
    ports[0].drop();
    expect(client.engine).toBeNull();

    void client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(2));
    ports[1].send({ type: 'ready', engine: 'full' });
    expect(client.engine).toBe('full');
    client.disconnect();
    expect(client.engine).toBeNull();
  });
});

describe('EngineClient connection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('connects and runs a search', async () => {
    const ports = stubRuntime();
    const client = new EngineClient();
    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports[0]?.posted).toHaveLength(1));
    expect(ports[0].name).toBe('vektra-engine');
    expect(ports[0].posted[0]).toMatchObject({ type: 'analyze', id: 1, fen: REQUEST.fen });
    ports[0].send({ type: 'done', id: 1, bestmove: 'e2e4', lines: [] });
    await expect(search).resolves.toEqual({ bestmove: 'e2e4', lines: [] });
  });

  it('opens no port when disconnected while the engine host is starting', async () => {
    const pending = deferredReply();
    const ports = stubRuntime(pending.reply);
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    const search = client.analyze(REQUEST);
    client.disconnect();
    pending.resolve({ ok: true });
    await expect(search).resolves.toBeNull();
    await Promise.resolve();
    expect(ports).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('reports nothing when the start fails after a disconnect', async () => {
    const pending = deferredReply();
    stubRuntime(pending.reply);
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    const search = client.analyze(REQUEST);
    client.disconnect();
    pending.reject(new Error('worker went away'));
    await expect(search).resolves.toBeNull();
    expect(errors).toEqual([]);
  });

  it('starts a fresh connection for a search after a disconnect mid-start, with the newly selected engine', async () => {
    const first = deferredReply();
    let reply = first.reply;
    const ports = stubRuntime(() => reply());
    const client = new EngineClient();
    const stale = client.analyze(REQUEST);
    client.setFullEngine(true);
    reply = async () => ({ ok: true });
    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    first.resolve({ ok: true });
    await expect(stale).resolves.toBeNull();
    expect(ports).toHaveLength(1);
    expect(ports[0].name).toBe('vektra-engine:full');
    await vi.waitFor(() => expect(ports[0].posted).toHaveLength(1));
    ports[0].send({ type: 'done', id: 2, bestmove: 'd2d4', lines: [] });
    await expect(search).resolves.toEqual({ bestmove: 'd2d4', lines: [] });
  });

  it("ignores a replaced port's messages and disconnect", async () => {
    const ports = stubRuntime();
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    void client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0].send({ type: 'ready', engine: 'lite' });

    client.setFullEngine(true);
    expect(ports[0].closed).toBe(true);
    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports[1]?.posted).toHaveLength(1));
    ports[1].send({ type: 'ready', engine: 'full' });

    ports[0].send({ type: 'ready', engine: 'lite' });
    ports[0].drop('Attempting to use a disconnected port object');
    expect(client.engine).toBe('full');
    expect(errors).toEqual([]);
    expect(openPorts(ports)).toEqual([ports[1]]);

    ports[1].send({ type: 'done', id: 2, bestmove: 'g1f3', lines: [] });
    await expect(search).resolves.toEqual({ bestmove: 'g1f3', lines: [] });
  });

  it('still cancels searches when the current port drops', async () => {
    const ports = stubRuntime();
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports[0]?.posted).toHaveLength(1));
    ports[0].drop('engine host closed');
    await expect(search).resolves.toBeNull();
    expect(errors).toEqual(['Engine connection closed: engine host closed']);
  });

  it('reports the error the background worker sent when the engine host could not start', async () => {
    const ports = stubRuntime(async () => ({ ok: false, error: 'Error: Only a single offscreen document may be created.' }));
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    await expect(client.analyze(REQUEST)).resolves.toBeNull();
    expect(errors).toEqual([
      'Could not connect to the chess engine: Error: Only a single offscreen document may be created.',
    ]);
    expect(ports).toHaveLength(0);
  });

  it('reports a missing reply, and tries again on the next search', async () => {
    let reply: () => Promise<unknown> = async () => undefined;
    const ports = stubRuntime(() => reply());
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    await expect(client.analyze(REQUEST)).resolves.toBeNull();
    expect(errors).toEqual(['Could not connect to the chess engine: the background worker did not reply']);
    expect(ports).toHaveLength(0);

    reply = async () => ({ ok: true });
    const search = client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports[0]?.posted).toHaveLength(1));
    ports[0].send({ type: 'done', id: 2, bestmove: 'e2e4', lines: [] });
    await expect(search).resolves.toEqual({ bestmove: 'e2e4', lines: [] });
  });

  it('reports a rejected message (service worker restarting) and tries again on the next search', async () => {
    let reply: () => Promise<unknown> = async () => {
      throw new Error('The message port closed before a response was received.');
    };
    const ports = stubRuntime(() => reply());
    const errors: string[] = [];
    const client = new EngineClient();
    client.onError = (m) => errors.push(m);
    await expect(client.analyze(REQUEST)).resolves.toBeNull();
    expect(errors).toEqual([
      'Could not connect to the chess engine: The message port closed before a response was received.',
    ]);
    reply = async () => ({ ok: true });
    void client.analyze(REQUEST);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
  });
});
