import {
  ENGINE_PORT,
  ENGINE_PORT_FULL,
  ENSURE_ENGINE,
  type AnalyzeRequest,
  type ClientMessage,
  type HostMessage,
  type SearchResult,
} from './protocol';
import type { PvLine } from '@core/engine/uci';

interface Pending {
  req: AnalyzeRequest;
  onUpdate?: (lines: PvLine[]) => void;
  resolve: (r: SearchResult | null) => void;
}

/** Times a dropped connection is reopened, and its search sent again, before giving up. */
const MAX_RECONNECTS = 1;

/** False once Vektra was updated or reloaded under this page. */
function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Content-script side of the engine. Only the latest search matters: starting
 * a new one resolves the previous one with null.
 */
export class EngineClient {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port | null> | null = null;
  /** Bumped by disconnect(), so a connect() still in flight knows to give up. */
  private epoch = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private full = false;
  private readyEngine: 'lite' | 'full' | null = null;
  /** Reconnects since the last search that finished. */
  private reconnects = 0;
  onError?: (message: string) => void;

  /**
   * Engine the host actually started for this connection (asking for the full
   * one falls back to lite if it isn't downloaded); null until it is ready.
   */
  get engine(): 'lite' | 'full' | null {
    return this.readyEngine;
  }

  private reportError(message: string): void {
    console.warn('[Vektra] engine error:', message);
    this.onError?.(message);
  }

  /** Switch between the lite and full engine; takes effect on the next search. */
  setFullEngine(full: boolean): void {
    if (full === this.full) return;
    this.full = full;
    this.disconnect();
  }

  /**
   * The port to the engine host, opening it if needed. Resolves to null if
   * disconnect() was called meanwhile; throws if the host could not start.
   */
  private connect(): Promise<chrome.runtime.Port | null> {
    if (this.port) return Promise.resolve(this.port);
    if (this.connecting) return this.connecting;
    const epoch = this.epoch;
    const connecting = (async () => {
      let reply: { ok?: boolean; error?: string } | undefined;
      try {
        reply = await chrome.runtime.sendMessage({ type: ENSURE_ENGINE });
      } catch (error) {
        if (epoch !== this.epoch) return null;
        throw error;
      }
      if (epoch !== this.epoch) return null;
      if (!reply?.ok) throw new Error(reply?.error ?? 'the background worker did not reply');
      const port = chrome.runtime.connect({ name: this.full ? ENGINE_PORT_FULL : ENGINE_PORT });
      // Only the current port counts; one closed by disconnect() is ignored.
      port.onMessage.addListener((msg: HostMessage) => {
        if (port === this.port) this.onMessage(msg);
      });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (port !== this.port) return;
        this.port = null;
        this.readyEngine = null;
        // Vektra was updated or reloaded under this page: say so even when
        // idle, so the page can ask to be reloaded rather than go quiet.
        if (!extensionAlive()) {
          this.cancelAll();
          this.reportError('Extension context invalidated.');
          return;
        }
        // A search was waiting: open a new connection and send it again
        // (the engine page may have restarted, or its worker crashed).
        if (this.pending.size && this.reconnects < MAX_RECONNECTS) {
          this.reconnects++;
          void this.resend();
          return;
        }
        if (error?.message && !/back\/forward cache/i.test(error.message)) {
          if (this.pending.size) this.reportError(`Engine connection closed: ${error.message}`);
        }
        this.cancelAll();
      });
      this.port = port;
      return port;
    })().finally(() => {
      if (this.connecting === connecting) this.connecting = null;
    });
    this.connecting = connecting;
    return connecting;
  }

  private onMessage(msg: HostMessage) {
    if (msg.type === 'ready') {
      console.debug(`[Vektra] engine: ${msg.engine}`);
      this.readyEngine = msg.engine;
      return;
    }
    if (msg.type === 'error') {
      this.reportError(msg.message);
      // An error without a search id closes the connection next; the waiting
      // search is sent again then (see onDisconnect), or given up.
      if (msg.id !== undefined) this.settle(msg.id, null);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'update') p.onUpdate?.(msg.lines);
    else {
      this.reconnects = 0;
      this.settle(msg.id, { bestmove: msg.bestmove, lines: msg.lines });
    }
  }

  private settle(id: number, result: SearchResult | null) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(result);
  }

  private cancelAll() {
    for (const id of [...this.pending.keys()]) this.settle(id, null);
  }

  async analyze(req: AnalyzeRequest, onUpdate?: (lines: PvLine[]) => void): Promise<SearchResult | null> {
    this.cancelAll();
    const id = this.nextId++;
    const result = new Promise<SearchResult | null>((resolve) => this.pending.set(id, { req, onUpdate, resolve }));
    try {
      const port = await this.connect();
      if (!port) this.settle(id, null);
      else if (this.pending.has(id)) port.postMessage({ type: 'analyze', id, ...req } satisfies ClientMessage);
    } catch (err) {
      this.reportError(`Could not connect to the chess engine: ${err instanceof Error ? err.message : String(err)}`);
      this.settle(id, null);
    }
    return result;
  }

  /** Reconnect and send the waiting searches again. */
  private async resend(): Promise<void> {
    let port: chrome.runtime.Port | null = null;
    try {
      port = await this.connect();
    } catch (err) {
      this.reportError(`Could not reconnect to the chess engine: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!port) {
      this.cancelAll();
      return;
    }
    for (const [id, p] of this.pending) port.postMessage({ type: 'analyze', id, ...p.req } satisfies ClientMessage);
  }

  stop(): void {
    this.cancelAll();
    this.port?.postMessage({ type: 'stop' } satisfies ClientMessage);
  }

  disconnect(): void {
    this.epoch++;
    this.connecting = null;
    this.cancelAll();
    this.port?.disconnect();
    this.port = null;
    this.readyEngine = null;
  }
}
