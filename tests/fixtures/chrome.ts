import { vi } from 'vitest';

/**
 * A small in-memory stand-in for the chrome.* APIs Vektra uses: runtime
 * messages and ports, storage.local / storage.sync with onChanged, and the
 * odd popup API. installFakeChrome() puts it on globalThis.chrome.
 */

/** A chrome.events.Event that tests can fire. */
export class FakeEvent<Listener extends (...args: never[]) => unknown> {
  readonly listeners: Listener[] = [];
  addListener = (listener: Listener) => void this.listeners.push(listener);
  removeListener = (listener: Listener) => {
    const i = this.listeners.indexOf(listener);
    if (i >= 0) this.listeners.splice(i, 1);
  };
  hasListener = (listener: Listener) => this.listeners.includes(listener);
  /** Call every listener; returns what they returned. */
  emit(...args: Parameters<Listener>): unknown[] {
    return [...this.listeners].map((listener) => listener(...args));
  }
}

type StorageChanges = Record<string, chrome.storage.StorageChange>;
type ChangeListener = (changes: StorageChanges, area: string) => void;

/** A storage area backed by `data`; writes fire onChanged like Chrome. */
export class FakeStorageArea {
  readonly get = vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === undefined || keys === null) return structuredClone(this.data);
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const result: Record<string, unknown> = {};
    for (const name of names) {
      if (name in this.data) result[name] = structuredClone(this.data[name]);
      else if (name in defaults) result[name] = defaults[name];
    }
    return result;
  });

  readonly set = vi.fn(async (items: Record<string, unknown>) => {
    const changes: StorageChanges = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: this.data[key], newValue: structuredClone(value) };
      this.data[key] = structuredClone(value);
    }
    this.onChanged.emit(changes, this.area);
  });

  readonly remove = vi.fn(async (keys: string | string[]) => {
    const changes: StorageChanges = {};
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      if (!(key in this.data)) continue;
      changes[key] = { oldValue: this.data[key] };
      delete this.data[key];
    }
    if (Object.keys(changes).length) this.onChanged.emit(changes, this.area);
  });

  constructor(
    readonly data: Record<string, unknown>,
    private readonly area: 'local' | 'sync',
    private readonly onChanged: FakeEvent<ChangeListener>,
  ) {}
}

/** One end of a runtime port, as the code under test sees it. */
export class FakePort {
  readonly onMessage = new FakeEvent<(msg: never) => void>();
  readonly onDisconnect = new FakeEvent<(port: FakePort) => void>();
  /** Messages the code under test posted. */
  readonly posted: unknown[] = [];
  /** True once the code under test called disconnect(). */
  closed = false;

  constructor(
    readonly name: string,
    private readonly runtime: { lastError?: { message: string } },
  ) {}

  postMessage = (msg: unknown) => {
    if (this.closed) throw new Error('Attempting to use a disconnected port object');
    this.posted.push(structuredClone(msg));
  };

  disconnect = () => {
    this.closed = true;
  };

  /** A message from the other end. */
  deliver(msg: unknown): void {
    this.onMessage.emit(msg as never);
  }

  /** The other end closing the port, optionally with chrome.runtime.lastError set. */
  drop(lastError?: string): void {
    this.runtime.lastError = lastError ? { message: lastError } : undefined;
    this.onDisconnect.emit(this);
    this.runtime.lastError = undefined;
  }
}

export interface FakeChromeOptions {
  sync?: Record<string, unknown>;
  local?: Record<string, unknown>;
  /** Answers chrome.runtime.sendMessage; by default resolves undefined. */
  onSendMessage?: (msg: unknown) => unknown;
  /** Prefix for chrome.runtime.getURL. */
  baseUrl?: string;
}

export function createFakeChrome(options: FakeChromeOptions = {}) {
  const onChanged = new FakeEvent<ChangeListener>();
  const runtime = {
    id: 'test',
    lastError: undefined as { message: string } | undefined,
    getURL: (path: string) => `${options.baseUrl ?? 'chrome-extension://test/'}${path}`,
    sendMessage: vi.fn(async (msg: unknown) => options.onSendMessage?.(msg)),
    onMessage: new FakeEvent<(msg: never, sender: unknown, sendResponse: (reply: unknown) => void) => unknown>(),
    onConnect: new FakeEvent<(port: FakePort) => void>(),
    /** Ports the code under test opened with chrome.runtime.connect. */
    ports: [] as FakePort[],
    connect: vi.fn(({ name }: { name: string }) => {
      const port = new FakePort(name, runtime);
      runtime.ports.push(port);
      return port;
    }),
  };
  const local = new FakeStorageArea(options.local ?? {}, 'local', onChanged);
  const sync = new FakeStorageArea(options.sync ?? {}, 'sync', onChanged);
  const chrome = {
    runtime,
    storage: { local, sync, onChanged },
    commands: { getAll: vi.fn(async () => [] as chrome.commands.Command[]) },
    tabs: {
      query: vi.fn(async () => [] as chrome.tabs.Tab[]),
      sendMessage: vi.fn(async () => undefined),
      create: vi.fn(async () => ({})),
    },
    permissions: { request: vi.fn(async () => true) },
  };

  /** A port the code under test receives through chrome.runtime.onConnect. */
  const connectToHost = (name: string): FakePort => {
    const port = new FakePort(name, runtime);
    runtime.onConnect.emit(port);
    return port;
  };

  return { chrome, runtime, local, sync, onChanged, connectToHost };
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

/** createFakeChrome() installed as globalThis.chrome; undo with vi.unstubAllGlobals(). */
export function installFakeChrome(options?: FakeChromeOptions): FakeChrome {
  const fake = createFakeChrome(options);
  vi.stubGlobal('chrome', fake.chrome);
  return fake;
}
