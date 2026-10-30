import {
  ENGINE_PORT,
  ENGINE_PORT_FULL,
  ENSURE_ENGINE,
  type AnalyzeRequest,
  type ClientMessage,
  type HostMessage,
  type SearchResult,
} from './protocol';
import type { PvLine } from './uci';

interface Pending {
  onUpdate?: (lines: PvLine[]) => void;
  resolve: (r: SearchResult | null) => void;
}

/**
 * Content-script side of the engine. Only the latest search matters: starting
 * a new one resolves the previous one with null.
 */
export class EngineClient {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private full = false;
  private readyEngine: 'lite' | 'full' | null = null;
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

  private connect(): Promise<chrome.runtime.Port> {
    if (this.port) return Promise.resolve(this.port);
    this.connecting ??= (async () => {
      await chrome.runtime.sendMessage({ type: ENSURE_ENGINE });
      const port = chrome.runtime.connect({ name: this.full ? ENGINE_PORT_FULL : ENGINE_PORT });
      port.onMessage.addListener((msg: HostMessage) => this.onMessage(msg));
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error?.message && !/back\/forward cache/i.test(error.message)) {
          if (this.pending.size) this.reportError(`Engine connection closed: ${error.message}`);
        }
        this.port = null;
        this.readyEngine = null;
        this.cancelAll();
      });
      this.port = port;
      return port;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private onMessage(msg: HostMessage) {
    if (msg.type === 'ready') {
      console.debug(`[Vektra] engine: ${msg.engine}`);
      this.readyEngine = msg.engine;
      return;
    }
    if (msg.type === 'error') {
      this.reportError(msg.message);
      if (msg.id !== undefined) this.settle(msg.id, null);
      else this.cancelAll();
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'update') p.onUpdate?.(msg.lines);
    else this.settle(msg.id, { bestmove: msg.bestmove, lines: msg.lines });
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
    const result = new Promise<SearchResult | null>((resolve) => this.pending.set(id, { onUpdate, resolve }));
    try {
      const port = await this.connect();
      if (this.pending.has(id)) port.postMessage({ type: 'analyze', id, ...req } satisfies ClientMessage);
    } catch (err) {
      this.reportError(`Could not connect to the chess engine: ${err instanceof Error ? err.message : String(err)}`);
      this.settle(id, null);
    }
    return result;
  }

  stop(): void {
    this.cancelAll();
    this.port?.postMessage({ type: 'stop' } satisfies ClientMessage);
  }

  disconnect(): void {
    this.cancelAll();
    this.port?.disconnect();
    this.port = null;
    this.readyEngine = null;
  }
}
