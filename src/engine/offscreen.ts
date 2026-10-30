import {
  FULL_ENGINE,
  FULL_ENGINE_DOWNLOAD,
  FULL_ENGINE_REMOVE,
  FULL_ENGINE_STATUS,
  LITE_ENGINE_LOADER,
  downloadFullEngine,
  fullEngineBlobUrl,
  hasFullEngine,
  removeFullEngine,
  FullEngineUrlLeases,
  type FullEngineStatus,
} from './fullEngine';
import { ENGINE_PORT, ENGINE_PORT_FULL, type ClientMessage, type HostMessage } from './protocol';
import { UciEngine } from './uciEngine';
import { describeWorkerError } from './workerError';

/**
 * Offscreen document hosting Stockfish. Content scripts cannot start a worker
 * from the extension's origin, so each tab connects here over a port and gets
 * its own engine worker for as long as the port is open.
 */

/** Offscreen documents can't use chrome.storage; the background worker stores the status. */
function reportStatus(status: FullEngineStatus) {
  void chrome.runtime.sendMessage({ type: FULL_ENGINE_STATUS, status }).catch(() => {});
}

let fullEngineUrl: Promise<string | null> | null = null;
const fullEngineUrlLeases = new FullEngineUrlLeases();

function invalidateFullEngineUrl(): void {
  const previous = fullEngineUrl;
  fullEngineUrl = null;
  if (!previous) return;
  void previous
    .then((url) => {
      if (url) fullEngineUrlLeases.retire(url);
    })
    .catch((error: unknown) => {
      console.error('[Vektra] Could not release the full engine:', error);
    });
}

/** Worker script for the requested engine, falling back to lite if full isn't downloaded. */
async function engineWorker(
  full: boolean,
): Promise<{ url: string; engine: 'lite' | 'full'; release?: () => void }> {
  if (full) {
    const currentUrl = fullEngineUrl ?? (fullEngineUrl = fullEngineBlobUrl());
    const wasm = await currentUrl;
    // The loader takes the wasm location from its URL hash.
    if (wasm) {
      return {
        url: `${chrome.runtime.getURL(FULL_ENGINE.loader)}#${encodeURIComponent(wasm)}`,
        engine: 'full',
        release: fullEngineUrlLeases.acquire(wasm),
      };
    }
    if (fullEngineUrl === currentUrl) fullEngineUrl = null;
    reportStatus({ state: 'missing' });
  }
  return { url: chrome.runtime.getURL(LITE_ENGINE_LOADER), engine: 'lite' };
}

let downloading = false;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === FULL_ENGINE_DOWNLOAD && !downloading) {
    downloading = true;
    reportStatus({ state: 'downloading', progress: 0 });
    downloadFullEngine((progress) => reportStatus({ state: 'downloading', progress }))
      .then(() => {
        invalidateFullEngineUrl();
        reportStatus({ state: 'ready' });
      })
      .catch((err) => reportStatus({ state: 'error', message: String(err?.message ?? err) }))
      .finally(() => {
        downloading = false;
      });
  } else if (msg?.type === FULL_ENGINE_REMOVE) {
    invalidateFullEngineUrl();
    void removeFullEngine().then(() => reportStatus({ state: 'missing' }));
  } else if (msg?.type === FULL_ENGINE_STATUS && msg.query) {
    void hasFullEngine().then((ready) => reportStatus(ready ? { state: 'ready' } : { state: 'missing' }));
  }
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== ENGINE_PORT && port.name !== ENGINE_PORT_FULL) return;

  // Messages that arrive while the worker is starting are queued.
  const queued: ClientMessage[] = [];
  let handle: ((msg: ClientMessage) => void) | null = null;
  port.onMessage.addListener((msg: ClientMessage) => (handle ? handle(msg) : queued.push(msg)));
  let closed = false;
  let worker: Worker | null = null;
  let engine: UciEngine | null = null;
  let releaseEngineUrl: (() => void) | null = null;
  const releaseEngine = () => {
    releaseEngineUrl?.();
    releaseEngineUrl = null;
  };
  const post = (msg: HostMessage) => {
    try {
      port.postMessage(msg);
    } catch {
      // Port closed; the disconnect handler cleans up.
    }
  };
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (error?.message && !/back\/forward cache/i.test(error.message)) {
      console.warn('[Vektra] engine client disconnected:', error.message);
    }
    closed = true;
    engine?.stop();
    worker?.terminate();
    releaseEngine();
  });

  let chosen: Awaited<ReturnType<typeof engineWorker>>;
  try {
    chosen = await engineWorker(port.name === ENGINE_PORT_FULL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Vektra] Could not load the Stockfish engine:', error);
    post({ type: 'error', message });
    port.disconnect();
    return;
  }
  if (closed) {
    chosen.release?.();
    return;
  }
  releaseEngineUrl = chosen.release ?? null;
  try {
    worker = new Worker(chosen.url);
  } catch (error) {
    releaseEngine();
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Vektra] Could not start Stockfish worker:', error);
    post({ type: 'error', message });
    port.disconnect();
    return;
  }
  engine = new UciEngine((cmd) => worker?.postMessage(cmd));
  let workerFailed = false;
  worker.onmessage = (e: MessageEvent) => {
    if (typeof e.data === 'string') engine.handleLine(e.data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (workerFailed) return;
    workerFailed = true;
    const message = describeWorkerError(event);
    console.error('[Vektra] Stockfish worker failed:', message);
    post({ type: 'error', message });
    worker.terminate();
    releaseEngine();
    port.disconnect();
  };

  handle = (msg: ClientMessage) => {
    if (workerFailed) return;
    if (msg.type === 'stop') {
      engine.stop();
      return;
    }
    const { id, type: _type, ...req } = msg;
    engine
      .analyze(req, (lines) => post({ type: 'update', id, lines }))
      .then((result) => result && post({ type: 'done', id, ...result }))
      .catch((err) => post({ type: 'error', id, message: String(err) }));
  };
  post({ type: 'ready', engine: chosen.engine });
  for (const msg of queued.splice(0)) handle(msg);
});
