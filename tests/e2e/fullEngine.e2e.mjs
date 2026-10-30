// End-to-end check of the full-strength engine: downloads the real 99 MB
// wasm from GitHub, verifies and caches it, then runs hints with it.
// Build first with: VEKTRA_E2E_FULL_ENGINE=1 npm run build
// (grants the download hosts so no permission prompt is needed).
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertFreshBuild } from './assertFreshBuild.mjs';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist');
const fixture = (n) => readFileSync(join(root, 'tests/fixtures/chesscom', `${n}.html`), 'utf8');
const proxy = process.env.HTTPS_PROXY;

assertFreshBuild({ fullEngine: true });

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vektra-full-')), {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    ...(proxy ? [`--proxy-server=${proxy}`, '--ignore-certificate-errors'] : []),
  ],
});
await ctx.route('https://www.chess.com/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><body>${fixture('computer-03-board')}${fixture('computer-03-movelist')}</body>`,
  }),
);

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
// What the popup does (its own messages can't reach the worker from inside it).
await sw.evaluate(async () => {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'src/engine/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'test',
    });
  }
  await new Promise((r) => setTimeout(r, 500));
  await chrome.runtime.sendMessage({ type: 'vektra:full-engine:download' }).catch(() => {});
});
let status = null;
for (let i = 0; i < 300 && status?.state !== 'ready' && status?.state !== 'error'; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  status = (await sw.evaluate(() => chrome.storage.local.get('fullEngineStatus'))).fullEngineStatus;
}
let failed = status?.state !== 'ready';
console.log(`${failed ? 'FAIL' : 'PASS'} full engine downloaded, checksum verified, cached (${JSON.stringify(status)})`);

await sw.evaluate(() => chrome.storage.sync.set({ settings: { engine: 'full', hintMode: 'instant' } }));
const p = await ctx.newPage();
const logs = [];
p.on('console', (m) => logs.push(m.text()));
await p.goto('https://www.chess.com/play/computer');
const ok = await p
  .waitForFunction(() => document.querySelectorAll('svg.vektra-overlay polygon').length >= 3, null, { timeout: 120000 })
  .then(() => true, () => false);
const usedFull = logs.some((l) => l.includes('[Vektra] engine: full'));
console.log(`${ok && usedFull ? 'PASS' : 'FAIL'} hints drawn with the full engine (${logs.filter((l) => l.includes('engine:')).join(', ')})`);
failed ||= !ok || !usedFull;
await ctx.close();
process.exit(failed ? 1 : 0);
