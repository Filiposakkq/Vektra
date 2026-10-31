/**
 * The full-strength Stockfish build (about 99 MB) is too big to ship in the
 * extension, so it is downloaded once on request from the stockfish.js GitHub
 * release, checked against a known SHA-256 and kept in the offscreen
 * document's Cache Storage. Its small loader script ships with the extension.
 */

export const FULL_ENGINE = {
  version: '19.0.1',
  url: 'https://github.com/nmrugg/stockfish.js/releases/download/v19.0.1/stockfish-19-single.wasm',
  sha256: '991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740',
  bytes: 99169054,
  loader: 'engine/stockfish-19-single.js',
  /** Hosts the download goes through; requested as optional permissions. */
  origins: [
    'https://github.com/*',
    'https://release-assets.githubusercontent.com/*',
    'https://objects.githubusercontent.com/*',
  ],
} as const;

export const LITE_ENGINE_LOADER = 'engine/stockfish-19-lite-single.js';

const CACHE_NAME = 'vektra-engine';
const CACHE_KEY = `https://vektra.invalid/stockfish-${FULL_ENGINE.version}-single.wasm`;

export type FullEngineStatus =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

/** Runtime messages about the full engine. */
export const FULL_ENGINE_DOWNLOAD = 'vektra:full-engine:download';
export const FULL_ENGINE_REMOVE = 'vektra:full-engine:remove';
export const FULL_ENGINE_STATUS = 'vektra:full-engine:status';
/** chrome.storage.local key holding the last FullEngineStatus. */
export const FULL_ENGINE_STATUS_KEY = 'fullEngineStatus';

/**
 * How the engine setting follows a change of the full engine's status:
 * 'full' when a download has just finished, 'lite' (if full was selected)
 * when the engine stopped being available, null otherwise, including a
 * status reported again unchanged.
 */
export function engineSettingForStatus(
  previous: FullEngineStatus['state'] | undefined,
  next: FullEngineStatus['state'],
): 'full' | 'lite' | null {
  if (previous === next) return null;
  if (next === 'ready') return previous === 'downloading' ? 'full' : null;
  return next === 'downloading' ? null : 'lite';
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Download, verify and cache the full engine. onProgress gets 0-1. */
export async function downloadFullEngine(onProgress: (fraction: number) => void): Promise<void> {
  const res = await fetch(FULL_ENGINE.url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received - lastReport > 2_000_000) {
      lastReport = received;
      onProgress(Math.min(0.99, received / FULL_ENGINE.bytes));
    }
  }
  const data = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  if ((await sha256Hex(data.buffer)) !== FULL_ENGINE.sha256) {
    throw new Error('The downloaded engine did not match its checksum');
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(CACHE_KEY, new Response(data, { headers: { 'Content-Type': 'application/wasm' } }));
  onProgress(1);
}

export async function hasFullEngine(): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  return !!(await cache.match(CACHE_KEY));
}

export async function removeFullEngine(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

/** Keeps a cached engine Blob URL alive while a worker is using it. */
export class FullEngineUrlLeases {
  private readonly active = new Map<string, number>();
  private readonly retired = new Set<string>();

  constructor(private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {}

  acquire(url: string): () => void {
    this.active.set(url, (this.active.get(url) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.active.get(url) ?? 0;
      if (count > 1) {
        this.active.set(url, count - 1);
      } else {
        this.active.delete(url);
        if (this.retired.delete(url)) this.revoke(url);
      }
    };
  }

  retire(url: string): void {
    if (this.active.has(url)) this.retired.add(url);
    else this.revoke(url);
  }
}

/** Blob URL of the cached full engine, or null if it isn't downloaded. */
export async function fullEngineBlobUrl(): Promise<string | null> {
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(CACHE_KEY);
  if (!res) return null;
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/wasm' }));
}
