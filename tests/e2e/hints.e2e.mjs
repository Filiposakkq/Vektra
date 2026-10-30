// End-to-end check: loads the built extension in Chromium, serves captured
// chess.com markup at real chess.com URLs (no network), and checks that the
// engine runs and arrows are drawn. Run with `npm run e2e` after `npm run build`.
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist');
const fixture = (n) => readFileSync(join(root, 'tests/fixtures/chesscom', `${n}.html`), 'utf8');

const page = (body) => `<!doctype html><html><head><style>
  body { margin: 0; padding: 40px; background: #312e2b; }
  wc-chess-board { display: block; position: relative; width: 480px; height: 480px;
    background: repeating-conic-gradient(#769656 0 25%, #eeeed2 0 50%) 0 0 / 120px 120px; }
  wc-chess-board .piece { position: absolute; width: 12.5%; height: 12.5%; }
  ${pieceCss()}
</style></head><body>${body}</body></html>`;

function pieceCss() {
  let css = '';
  for (let f = 1; f <= 8; f++)
    for (let r = 1; r <= 8; r++)
      css += `.board:not(.flipped) .square-${f}${r}{left:${(f - 1) * 12.5}%;top:${(8 - r) * 12.5}%}` +
        `.board.flipped .square-${f}${r}{left:${(8 - f) * 12.5}%;top:${(r - 1) * 12.5}%}`;
  return css + '.piece{border-radius:50%}.piece[class*=" w"],.piece.wp,.piece.wn,.piece.wb,.piece.wr,.piece.wq,.piece.wk{background:#fff}' +
    '.piece.bp,.piece.bn,.piece.bb,.piece.br,.piece.bq,.piece.bk{background:#000}';
}

const PAGES = {
  'https://www.chess.com/analysis/game/1': page(fixture('analysis-03-board-mate') + fixture('analysis-03-movelist-last-selected')),
  'https://www.chess.com/play/computer': page(fixture('computer-03-board') + fixture('computer-03-movelist')),
  'https://www.chess.com/game/computer/2472370118': page(fixture('computer-03-board') + fixture('computer-03-movelist')),
  'https://www.chess.com/analysis': page(fixture('analysis-04-board-variation') + fixture('analysis-04-movelist-variation-selected')),
  'https://www.chess.com/game/live/42': page(fixture('computer-03-board').replace('board-play-computer', 'board-single') +
    fixture('computer-03-movelist').replace('board-play-computer', 'board-single')),
};

const userDataDir = mkdtempSync(join(tmpdir(), 'vektra-e2e-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
await ctx.route('https://www.chess.com/**', (route) => {
  const url = route.request().url().split('?')[0];
  const body = PAGES[url];
  return body
    ? route.fulfill({ status: 200, contentType: 'text/html', body })
    : route.fulfill({ status: 404, body: '' });
});

let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

const shotDir = process.env.E2E_SCREENSHOTS;
const suites = new Set(['all', 'board', 'games', 'analysis', 'settings']);
const suite = process.argv[2] ?? 'all';
if (!suites.has(suite)) throw new Error(`Unknown E2E suite: ${suite}`);
const runSuite = (name) => suite === 'all' || suite === name;

if (runSuite('board')) for (const [url, name] of [
  ['https://www.chess.com/play/computer', 'computer'],
  ['https://www.chess.com/game/computer/2472370118', 'computer game route'],
  ['https://www.chess.com/analysis', 'analysis'],
]) {
  const p = await ctx.newPage();
  p.on('console', (m) => m.text().includes('Vektra') && console.log(`  [${name}] ${m.text()}`));
  await p.goto(url);
  const ok = await p
    .waitForFunction(() => document.querySelectorAll('svg.vektra-overlay polygon').length >= 3, null, {
      timeout: 30000,
    })
    .then(() => true, () => false);
  const arrows = await p.$$eval('svg.vektra-overlay polygon', (els) => els.map((e) => `${e.dataset.rank}:${e.dataset.move}`));
  check(ok, `${name}: 3 arrows drawn (${arrows.join(', ')})`);
  if (name === 'computer') {
    const autoplayOff = await p.$eval(
      'wc-chess-board .vektra-autoplay-control',
      (host) => host.shadowRoot?.querySelector('button')?.textContent === 'AUTO · OFF',
    );
    check(autoplayOff, 'computer: arrows are shown while autoplay is off');
    const weakerToggle = p.locator('wc-chess-board .vektra-autoplay-control').locator('button').nth(1);
    await weakerToggle.click();
    const previewShown = await p
      .waitForFunction(() => {
        const primary = document.querySelector('.vektra-move[data-rank="0"]');
        const weaker = document.querySelector('.vektra-move[data-rank="1"][data-weaker="true"]');
        return primary && !primary.hasAttribute('data-weaker') && weaker;
      }, null, { timeout: 15000 })
      .then(() => true, () => false);
    check(previewShown, 'computer: weaker move is always the second purple arrow with autoplay off');
    await weakerToggle.click();
    await p.waitForFunction(
      () =>
        document.querySelector('.vektra-move[data-rank="0"]') &&
        !document.querySelector('.vektra-move[data-weaker="true"]') &&
        document.querySelectorAll('svg.vektra-overlay polygon').length >= 3,
      null,
      { timeout: 15000 },
    );
    const primaryMove = await p.$eval('.vektra-move[data-rank="0"]', (el) => el.dataset.move);
    const highlights = await p.$$eval(
      'svg.vektra-overlay .vektra-square-highlight',
      (els) => els.map((el) => el.dataset.square),
    );
    const from = primaryMove?.slice(0, 2);
    const to = primaryMove?.slice(2, 4);
    check(
      highlights.length === 2 && !!from && !!to && highlights.includes(from) && highlights.includes(to),
      `computer: primary move squares are highlighted (${highlights.join(', ')})`,
    );
    const dashedLine = await p.$eval('.vektra-move[data-rank="0"] .vektra-arrow-line', (el) =>
      el.getAttribute('stroke-dasharray'),
    );
    check(!!dashedLine, 'computer: primary move uses a dashed connector');
    const panelShown = await p.$eval('#vektra-analysis-panel', (e) => e.style.display !== 'none').catch(() => false);
    check(!panelShown, 'computer: analysis panel hidden while the bot game is in progress');
    const legs = (await p.$$('svg.vektra-overlay path.vektra-knight-leg')).length;
    check(legs >= 1, `computer: knight move drawn as an L (${legs} bent arrows)`);
  }
  const bar = await p.$eval('.vektra-evalbar', (e) => e.textContent).catch(() => null);
  check(!!bar, `${name}: eval bar shows ${bar}`);
  if (name === 'computer') {
    // Play 4.c3 as the user (White): the move should get a rating on c3.
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      document.querySelector('wc-chess-board .square-32')?.classList.replace('square-32', 'square-33');
      const row = document.querySelector('.main-line-row[data-whole-move-number="3"]');
      const node = document.createElement('div');
      node.className = 'main-line-row move-list-row light-row';
      node.dataset.wholeMoveNumber = '4';
      node.innerHTML = '4. <div data-node="0-6" class="node white-move main-line-ply"> <span class="node-highlight-content offset-for-annotation-icon selected">c3 </span></div>';
      document.querySelector('.node-highlight-content.selected')?.classList.remove('selected');
      row?.after(node);
    });
    const rated = await p
      .waitForFunction(() => document.querySelector('.vektra-square-badge')?.getAttribute('data-square') === 'c3', null, { timeout: 30000 })
      .then(() => true, () => false);
    const title = await p.$eval('.vektra-square-badge title', (e) => e.textContent).catch(() => null);
    check(rated, `computer: live rating on the user's move 4.c3 (${title})`);
  }
  if (shotDir) await p.screenshot({ path: join(shotDir, `e2e-${name}.png`) });
  await p.close();
}

if (runSuite('games')) {
{
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/game/live/42');
  const active = await p
    .waitForFunction(() => document.querySelectorAll('svg.vektra-overlay polygon').length >= 3, null, {
      timeout: 30000,
    })
    .then(() => true, () => false);
  check(active, 'human game: hints are drawn while the game is in progress');
  check(
    (await p.locator('wc-chess-board .vektra-autoplay-control').count()) === 1,
    'human game: autoplay control is available',
  );
  if (shotDir) await p.screenshot({ path: join(shotDir, 'e2e-human.png') });
}

{
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/game/computer/2472370118');
  await p.waitForFunction(() => document.querySelectorAll('svg.vektra-overlay polygon').length >= 3, null, {
    timeout: 30000,
  });
  await p.evaluate(() => {
    history.pushState({}, '', '/game/computer/2472370119');
    const oldBoard = document.querySelector('wc-chess-board');
    const board = document.createElement('wc-chess-board');
    board.className = 'board';
    board.id = oldBoard.id;
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let file = 1; file <= 8; file++) {
      for (const [rank, color, type] of [
        [1, 'w', backRank[file - 1]],
        [2, 'w', 'p'],
        [7, 'b', 'p'],
        [8, 'b', backRank[file - 1]],
      ]) {
        const piece = document.createElement('div');
        piece.className = `piece ${color}${type} square-${file}${rank}`;
        board.append(piece);
      }
    }
    const oldList = document.querySelector('.move-list');
    const list = document.createElement('wc-simple-move-list');
    list.className = 'move-list chessboard-pkg-move-list-component';
    list.setAttribute('board-id', board.id);
    oldBoard.replaceWith(board);
    oldList.replaceWith(list);
  });
  const recovered = await p
    .waitForFunction(
      () => {
        const board = document.querySelector('wc-chess-board');
        return location.pathname.endsWith('2472370119') &&
          board?.querySelectorAll('svg.vektra-overlay polygon').length >= 3 &&
          board.querySelector('.vektra-autoplay-control');
      },
      null,
      { timeout: 30000 },
    )
    .then(() => true, () => false);
  check(recovered, 'navigation: hints and board controls recover on a second game in the same tab');
  const searchComplete = await p
    .waitForFunction(
      () =>
        document.querySelector('wc-chess-board .vektra-autoplay-control')
          ?.shadowRoot?.querySelector('.think-time')?.textContent !== 'Think: —',
      null,
      { timeout: 30000 },
    )
    .then(() => true, () => false);
  check(searchComplete, 'navigation: second-game engine search finishes');
  await p.evaluate(() => history.pushState({}, '', '/game/computer/2472370120'));
  const routeRefresh = await p
    .waitForFunction(
      () =>
        document.querySelector('wc-chess-board .vektra-autoplay-control')
          ?.shadowRoot?.querySelector('.think-time')?.textContent === 'Think: —',
      null,
      { timeout: 5000 },
    )
    .then(() => true, () => false);
  check(routeRefresh, 'navigation: a URL-only game change refreshes the current position');
  if (shotDir) await p.screenshot({ path: join(shotDir, 'e2e-second-game.png') });
  await p.close();
}
}

// Full-game analysis on a finished game.
if (runSuite('analysis')) {
{
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/analysis/game/1');
  await p.waitForSelector('#vektra-analysis-panel button', { timeout: 10000 });
  await p.click('#vektra-analysis-panel button');
  const done = await p
    .waitForFunction(() => document.querySelectorAll('.vektra-move-badge').length === 7, null, { timeout: 120000 })
    .then(() => true, () => false);
  check(done, 'analysis: all 7 moves get a badge');
  const cats = await p.$$eval('.vektra-move-badge', (els) => els.map((e) => e.dataset.category));
  check(cats[5] === 'blunder' && cats[6] === 'best', `analysis: Nf6 blunder, Qxf7# best (${cats.join(' ')})`);
  const panelText = await p.$eval('#vektra-analysis-panel', (e) => e.textContent);
  check(/White accuracy/.test(panelText) && /Blunder/.test(panelText), 'analysis: panel shows estimated accuracy and counts');
  check((await p.$$('#vektra-analysis-panel svg[aria-label="Evaluation graph"]')).length === 1, 'analysis: eval graph drawn');
  const [download] = await Promise.all([
    p.waitForEvent('download', { timeout: 10000 }),
    p.click('#vektra-analysis-panel button:has-text("Export JSON")'),
  ]);
  const json = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check(json.format === 'vektra-analysis' && json.moves.length === 7, `analysis: JSON export (${download.suggestedFilename()})`);
  const [pdf] = await Promise.all([
    p.waitForEvent('download', { timeout: 15000 }),
    p.click('#vektra-analysis-panel button:has-text("Export PDF")'),
  ]);
  const pdfHead = readFileSync(await pdf.path()).subarray(0, 4).toString();
  check(pdfHead === '%PDF', `analysis: PDF export (${pdf.suggestedFilename()})`);
  if (shotDir) await pdf.saveAs(join(shotDir, 'e2e-analysis.pdf'));
  const sqBadge = await p.$eval('.vektra-square-badge', (e) => e.dataset.square).catch(() => null);
  check(sqBadge === 'f7', `analysis: board icon on the last move's square (${sqBadge})`);
  if (shotDir) await p.screenshot({ path: join(shotDir, 'e2e-game-analysis.png') });
  // A reload shows the saved analysis without running the engine again.
  await p.reload();
  const cached = await p
    .waitForFunction(() => /White accuracy/.test(document.getElementById('vektra-analysis-panel')?.textContent ?? ''), null, { timeout: 5000 })
    .then(() => true, () => false);
  check(cached, 'analysis: saved analysis shown again after a reload');
  await p.close();
}
}

// Floating settings window: change settings and check the open tab follows.
if (runSuite('settings')) {
{
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const game = await ctx.newPage();
  await game.setViewportSize({ width: 1280, height: 1200 });
  game.on('pageerror', (error) => console.error(`[autoplay page error] ${error.message}`));
  await game.goto('https://www.chess.com/play/computer');
  await game.waitForFunction(() => document.querySelectorAll('svg.vektra-overlay polygon').length >= 3, null, { timeout: 30000 });
  const boardControls = game.locator('wc-chess-board .vektra-autoplay-control');
  const weakerToggle = boardControls.locator('button').nth(1);
  check((await weakerToggle.textContent()) === 'WEAKER · OFF', 'weaker moves: board toggle starts off');
  await weakerToggle.click();
  check(
    await game.waitForFunction(
      () => document.querySelector('wc-chess-board .vektra-autoplay-control')?.shadowRoot?.querySelectorAll('button')[1]?.textContent === 'WEAKER · ON',
      null,
      { timeout: 5000 },
    ),
    'weaker moves: board toggle immediately reflects enabled state',
  );

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.chess.com/play/computer' });
    await chrome.tabs.sendMessage(tab.id, { type: 'vektra:open-settings' });
  });
  await game.waitForSelector('#vektra-floating-settings iframe', { timeout: 10000 });
  const settings = game.frameLocator('#vektra-floating-settings iframe');
  const weakerMoves = settings.locator('input[name="occasionalWeakerMoves"]');
  const hintsTab = settings.locator('[role="tab"][data-tab="hints"]');
  check(
    (await hintsTab.getAttribute('aria-selected')) === 'true' &&
      (await settings.locator('[role="tab"]').count()) === 3 &&
      (await settings.locator('#context-hint').count()) === 0,
    'settings: opens on live-game controls for a live game',
  );
  check(
    await settings.locator('body').evaluate((body) =>
      getComputedStyle(body.querySelector('.brand-mark')).display === 'none' &&
      getComputedStyle(body.querySelector('.brand-copy')).display === 'none',
    ),
    'floating settings: avoids repeating the title and brand text',
  );
  const extraCandidates = settings.locator('input[name="weakenedShowsTopMoves"]');
  check(await extraCandidates.isVisible(), 'settings: candidate-move toggle is visible at full engine strength');
  await extraCandidates.check();
  const fullStrengthCandidates = await game
    .waitForFunction(
      () => document.querySelectorAll('svg.vektra-overlay .vektra-move').length >= 5,
      null,
      { timeout: 15000 },
    )
    .then(() => true, () => false);
  check(fullStrengthCandidates, 'settings: candidate-move toggle displays extra lines at full strength');
  await extraCandidates.uncheck();
  await weakerMoves.uncheck();
  const presets = settings.locator('details.presets-disclosure');
  const stableLayout = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const contentHeight = await settings.locator('body').evaluate((body) => body.scrollHeight);
      const frameHeight = await game.locator('#vektra-floating-settings iframe').evaluate((frame) => frame.clientHeight);
      if (Math.abs(Math.ceil(contentHeight) - frameHeight) <= 2) return { contentHeight, frameHeight };
      await game.waitForTimeout(50);
    }
    throw new Error('Floating settings frame did not match its content height');
  };
  const initialLayout = await stableLayout();
  const initialContentHeight = initialLayout.contentHeight;
  const initialFrameHeight = initialLayout.frameHeight;
  await presets.locator('summary').click();
  const expandedContentHeight = await settings.locator('body').evaluate(async (body, initialHeight) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (body.scrollHeight > initialHeight) return body.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Expanding presets did not increase the content height');
  }, initialContentHeight);
  const expandedFrameHeight = await game.locator('#vektra-floating-settings iframe').evaluate(async (frame, initialHeight) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (frame.clientHeight > initialHeight + 2) return frame.clientHeight;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return frame.clientHeight;
  }, initialFrameHeight);
  const presetBounds = await presets.evaluate((details) => {
    const buttons = details.querySelector('.presets').getBoundingClientRect();
    const section = details.parentElement.querySelector('section').getBoundingClientRect();
    return { presetLeft: buttons.left, sectionLeft: section.left };
  });
  check(
    Math.abs(presetBounds.presetLeft - presetBounds.sectionLeft) <= 1,
    'settings: expanded presets align with the content cards',
  );
  check(
    (await settings.locator('input[name="hintMode"]').count()) === 2 &&
      (await settings.locator('details:has-text("Hint delay settings")').count()) === 0,
    'settings: hint delays are removed while instant and on-demand modes remain',
  );
  await presets.locator('summary').click();
  const collapsedContentHeight = await settings.locator('body').evaluate(async (body, expandedHeight) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (body.scrollHeight < expandedHeight) return body.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Collapsing presets did not reduce the content height');
  }, expandedContentHeight);
  check(
    collapsedContentHeight === initialContentHeight,
    `floating settings: content shrinks after closing presets (${initialContentHeight} → ${expandedContentHeight} → ${collapsedContentHeight})`,
  );
  const collapsedFrameHeight = await game.locator('#vektra-floating-settings iframe').evaluate(async (frame, expandedHeight) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (frame.clientHeight < expandedHeight - 2) return frame.clientHeight;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return frame.clientHeight;
  }, expandedFrameHeight);
  check(
    expandedFrameHeight > initialFrameHeight + 2 && collapsedFrameHeight <= initialFrameHeight + 2,
    `floating settings: host window grows and shrinks with content (${initialFrameHeight} → ${expandedFrameHeight} → ${collapsedFrameHeight})`,
  );
  const fittedFrame = {
    contentHeight: await settings.locator('body').evaluate((body) => body.getBoundingClientRect().height),
    frameHeight: await game.locator('#vektra-floating-settings iframe').evaluate((frame) => frame.clientHeight),
  };
  check(
    fittedFrame.contentHeight <= fittedFrame.frameHeight &&
      (await game.locator('#vektra-floating-settings [aria-label="Resize Vektra settings"]').count()) === 0,
    `floating settings: fits content without a resize handle or inner scrollbar (${JSON.stringify(fittedFrame)})`,
  );
  await weakerMoves.check();
  await game.setViewportSize({ width: 1280, height: 720 });
  await settings.locator('[role="tab"][data-tab="engine"]').click();
  const engineTuning = settings.locator('details.advanced-settings');
  check(
    !(await engineTuning.evaluate((details) => details.open)),
    'settings: engine strength controls start collapsed',
  );
  await engineTuning.locator('summary').click();
  check(
    await settings.locator('input[name="skillLevel"]').isVisible(),
    'settings: strength controls are available when expanded',
  );
  await settings.locator('details.inline-advanced summary').last().click();
  check(
    await settings.locator('input[name="depth"]').isVisible(),
    'settings: search limits are available in a separate collapsible',
  );
  const engineScroll = await settings.locator('html').evaluate(async (html) => {
    const root = document.scrollingElement;
    const frameHeight = innerHeight;
    const contentHeight = html.scrollHeight;
    root.scrollTo({ top: contentHeight });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const depth = document.querySelector('input[name="depth"]').getBoundingClientRect();
    return {
      scrollable: root.scrollTop > 0 && contentHeight > frameHeight,
      searchControlReachable: depth.bottom <= innerHeight,
    };
  });
  check(
    engineScroll.scrollable && engineScroll.searchControlReachable,
    'settings: tall Engine tab scrolls to the search controls instead of clipping them',
  );
  await settings.locator('html').evaluate((html) => document.scrollingElement.scrollTo({ top: 0 }));
  await settings.locator('[role="tab"][data-tab="hints"]').click();
  await hintsTab.focus();
  await hintsTab.press('ArrowRight');
  check(
    (await settings.locator('[role="tab"][data-tab="engine"]').getAttribute('aria-selected')) === 'true' &&
      (await settings.locator('[role="tabpanel"]#panel-engine').isVisible()),
    'settings: arrow keys switch tabs and expose the selected Engine panel',
  );
  await settings.locator('[role="tab"][data-tab="engine"]').press('ArrowLeft');
  check(
    (await hintsTab.getAttribute('aria-selected')) === 'true',
    'settings: left arrow returns to the previous tab',
  );
  await game.waitForSelector('#vektra-floating-settings', { timeout: 10000 });
  check(
    (await game.locator('#vektra-floating-settings, #vektra-floating-panel').count()) === 1,
    'floating settings: only one Vektra window and launcher is mounted',
  );
  const boardBox = await game.locator('wc-chess-board').boundingBox();
  const windowBox = await game.locator('#vektra-floating-settings').boundingBox();
  check(
    !!boardBox && !!windowBox &&
      (windowBox.x >= boardBox.x + boardBox.width || windowBox.x + windowBox.width <= boardBox.x),
    'floating settings: opens beside the board instead of covering it',
  );
  check(
    (await settings.locator('[role="tab"]').count()) === 3 &&
      (await settings.locator('[data-tab="look"], #panel-look, input[type="color"]').count()) === 0,
    'settings: removes the unnecessary Display tab and arrow customization',
  );

  const floatingRect = await game.locator('#vektra-floating-settings').boundingBox();
  const floatingHeader = await game.locator('#vektra-floating-settings').locator('header').boundingBox();
  if (floatingRect && floatingHeader) {
    await game.mouse.move(floatingHeader.x + 150, floatingHeader.y + 20);
    await game.mouse.down();
    await game.mouse.move(floatingHeader.x + 80, floatingHeader.y + 45, { steps: 4 });
    await game.mouse.up();
  }
  const movedRect = await game.locator('#vektra-floating-settings').boundingBox();
  check(
    !!floatingRect && !!movedRect && movedRect.x < floatingRect.x - 30,
    'floating settings: title bar drags the window',
  );

  await settings.locator('[data-tab="engine"]').click();
  await settings.locator('input[name="depth"]').evaluate((input) => {
    input.value = '24';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settings.locator('label:has(input[name="limitStrength"][value="true"])').click();
  const provisional = await game
    .waitForFunction(
      () => document.querySelector('svg.vektra-overlay g[data-provisional="true"] path[stroke-dasharray]') !== null,
      null,
      { timeout: 10000 },
    )
    .then(() => true, () => false);
  check(provisional, 'floating settings: Elo mode shows a provisional arrow before the final weakened choice');

  await settings.locator('[data-tab="hints"]').click();
  check(await weakerMoves.isVisible(), 'settings: weaker-move toggle is visible without expanding a disclosure');
  await weakerMoves.uncheck();
  await settings.locator('[data-tab="engine"]').click();
  await settings.locator('label:has(input[name="limitStrength"][value="true"])').click();
  await settings.locator('[data-tab="hints"]').click();
  await weakerMoves.check();
  check(await extraCandidates.isVisible(), 'settings: candidate-line option is available with reduced strength');
  await extraCandidates.check();
  const candidateLinesShown = await game
    .waitForFunction(
      () => document.querySelectorAll('svg.vektra-overlay .vektra-move').length >= 3,
      null,
      { timeout: 15000 },
    )
    .then(() => true, () => false);
  check(candidateLinesShown, 'settings: enabling candidate lines displays multiple reduced-strength suggestions');
  await extraCandidates.uncheck();
  await weakerMoves.check();
  await settings.locator('label:has(input[name="hintMode"][value="hotkey"])').click();
  await game.waitForTimeout(3000);
  const hidden = (await game.$$('svg.vektra-overlay polygon')).length === 0;
  check(hidden, 'floating settings: hotkey mode hides hints until the shortcut');

  // What the background worker does when the "show hint" shortcut is pressed.
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.chess.com/play/computer' });
    await chrome.tabs.sendMessage(tab.id, { type: 'vektra:show-hint' });
  });
  const shown = await game
    .waitForFunction(
      () =>
        document.querySelectorAll('svg.vektra-overlay polygon').length >= 2 &&
        document.querySelector('.vektra-move[data-rank="1"][data-weaker="true"]'),
      null,
      { timeout: 30000 },
    )
    .then(() => true, () => false);
  check(shown, 'show-hint shortcut reveals the primary move and weaker second arrow');

  await game.locator('#vektra-floating-settings').locator('button[aria-label="Show hint now"]').click();
  check(
    (await game.locator('#vektra-floating-settings, #vektra-floating-panel').count()) === 1,
    'floating settings: the single window provides a manual hint action',
  );

  const autoplay = settings.locator('input[name="autoPlay"]');
  check(!(await autoplay.isChecked()), 'autoplay: off by default');
  check(await weakerMoves.isChecked(), 'occasional weaker moves: board toggle synchronizes with settings');
  await weakerMoves.uncheck();
  check(
    await game.waitForFunction(
      () => document.querySelector('wc-chess-board .vektra-autoplay-control')?.shadowRoot?.querySelectorAll('button')[1]?.textContent === 'WEAKER · OFF',
      null,
      { timeout: 5000 },
    ),
    'weaker moves: settings toggle synchronizes back to board',
  );
  await weakerMoves.check();
  const weakerChance = settings.locator('input[name="weakerMoveChancePercent"]');
  const weakerLoss = settings.locator('input[name="weakerMoveMaxLossCp"]');
  check(
    (await weakerChance.isVisible()) &&
      (await weakerLoss.isVisible()) &&
      (await weakerChance.inputValue()) === '50' &&
      (await weakerLoss.inputValue()) === '200',
    'occasional weaker moves: Hints exposes the higher chance and wider playable-loss defaults',
  );
  await settings.locator('[data-tab="hints"]').click();
  await weakerMoves.uncheck();
  await settings.locator('[data-tab="engine"]').click();
  await settings.locator('input[name="depth"]').evaluate((input) => {
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settings.locator('[data-tab="hints"]').click();
  const minDelay = settings.locator('input[name="autoPlayMinDelaySec"]');
  const maxDelay = settings.locator('input[name="autoPlayMaxDelaySec"]');
  check(
    (await minDelay.inputValue()) === '0.5' && (await maxDelay.inputValue()) === '2',
    'autoplay: minimum and maximum delay sliders have defaults',
  );
  await settings.locator('label:has(input[name="hintMode"][value="instant"])').click();
  for (const [input, value] of [[minDelay, '8'], [maxDelay, '8']]) {
    await input.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  const delayRangeUpdated = await maxDelay.evaluate(async (input) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const minimum = document.querySelector('input[name="autoPlayMinDelaySec"]')?.value;
      if (minimum === '8' && input.value === '8') return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });
  check(delayRangeUpdated, 'autoplay: custom delay range is saved');
  check(
    (await game
      .locator('wc-chess-board .vektra-autoplay-control')
      .evaluate((host) => host.shadowRoot?.querySelector('button')?.textContent)) === 'AUTO · OFF',
    'autoplay: clear board control starts off',
  );
  await game.evaluate(() => {
    window.__vektraAutoplayEvents = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      document.querySelector('wc-chess-board')?.addEventListener(type, () => {
        window.__vektraAutoplayEvents.push(type);
      });
    }
  });
  await autoplay.check();
  const stopAutoplay = game.locator('#vektra-floating-settings button[aria-label="Stop autoplay"]');
  check(await stopAutoplay.isVisible(), 'autoplay: visible stop control when enabled');
  check(
    (await game
      .locator('wc-chess-board .vektra-autoplay-control')
      .evaluate((host) => host.shadowRoot?.querySelector('button')?.textContent)) === 'AUTO · ON',
    'autoplay: board control reflects enabled state',
  );
  await game.locator('#vektra-floating-settings button[aria-label="Show hint now"]').click();
  const selectedDelay = await game
    .waitForFunction(
      () => {
        const host = document.querySelector('wc-chess-board .vektra-autoplay-control');
        const delay = host?.shadowRoot?.querySelector('.move-delay')?.textContent;
        return delay !== undefined && delay !== 'Delay: —' ? delay : false;
      },
      null,
      { timeout: 120000 },
    )
    .then((handle) => handle.jsonValue(), () => null);
  check(
    typeof selectedDelay === 'string' &&
      Number(selectedDelay.match(/[\d.]+/)?.[0]) === 8,
    `autoplay: selected move delay is shown within the configured range (${selectedDelay})`,
  );
  await game
    .locator('#vektra-floating-settings button[aria-label="Close Vektra settings"]')
    .click();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.chess.com/play/computer' });
    await chrome.tabs.sendMessage(tab.id, { type: 'vektra:open-settings' });
  });
  const settingsReopened = await game
    .waitForFunction(
      () => {
        const host = document.querySelector('#vektra-floating-settings');
        const frame = host?.shadowRoot?.querySelector('iframe');
        const control = document.querySelector('wc-chess-board .vektra-autoplay-control');
        return frame && getComputedStyle(frame).display !== 'none' &&
          control?.shadowRoot?.querySelector('.move-delay')?.textContent === 'Delay: 8.00 s';
      },
      null,
      { timeout: 5000 },
    )
    .then(() => true, () => false);
  check(settingsReopened, 'autoplay: opening settings preserves the queued move and its delay');
  const searchTime = await game
    .waitForFunction(
      () => {
        const host = document.querySelector('wc-chess-board .vektra-autoplay-control');
        const time = host?.shadowRoot?.querySelector('.think-time')?.textContent;
        return time !== undefined && time !== 'Think: —' ? time : false;
      },
      null,
      { timeout: 30000 },
    )
    .then((handle) => handle.jsonValue(), () => null);
  check(
    typeof searchTime === 'string' && /^Think: \d+\.\d{2} s$/.test(searchTime),
    `autoplay: board control displays engine think time in seconds (${searchTime})`,
  );
  await settings.locator('input[name="liveRatings"]').uncheck();
  const settingsUpdated = await sw.evaluate(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const { settings } = await chrome.storage.sync.get('settings');
      if (settings?.liveRatings === false) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });
  check(settingsUpdated, 'autoplay: live setting change reached the active tab');
  await autoplay.uncheck();
  const delayCleared = await game
    .waitForFunction(
      () =>
        document.querySelector('wc-chess-board .vektra-autoplay-control')
          ?.shadowRoot?.querySelector('.move-delay')?.textContent === 'Delay: —',
      null,
      { timeout: 5000 },
    )
    .then(() => true, () => false);
  check(delayCleared, 'autoplay: a settings change cancels the previously scheduled move');
  await game.waitForTimeout(8200);
  check(
    (await game.evaluate(() => window.__vektraAutoplayEvents.length)) === 0,
    'autoplay: does not submit the stale move after a settings change',
  );
  await autoplay.check();
  const played = await game
    .waitForFunction(() => window.__vektraAutoplayEvents.length >= 5, null, { timeout: 30000 })
    .then(() => true, () => false);
  check(played, 'autoplay: submits the final engine choice as board input');
  await game.locator('#vektra-floating-settings button[aria-label="Show hint now"]').click();
  await game.waitForTimeout(100);
  check(
    (await game.evaluate(() => window.__vektraAutoplayEvents.length)) === 5,
    'autoplay: submits at most one move for a position',
  );
  await stopAutoplay.click();
  const stopped = await autoplay.evaluate(async (input) => {
    for (let attempt = 0; attempt < 40 && input.checked; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !input.checked;
  });
  check(stopped, 'autoplay: stop control disables automatic moves');

  await settings.locator('.switch').click();
  const paused = await game
    .waitForFunction(
      () => document.querySelectorAll('svg.vektra-overlay polygon').length === 0,
      null,
      { timeout: 5000 },
    )
    .then(() => true, () => false);
  check(paused, 'floating settings: switching off pauses hints');
  if (shotDir) await game.screenshot({ path: join(shotDir, 'e2e-floating-settings.png'), fullPage: true });
  const stored = await sw.evaluate(() => chrome.storage.sync.get('settings'));
  check(stored.settings?.arrows === 3 && stored.settings?.hintMode === 'instant' &&
    stored.settings?.enabled === false && stored.settings?.autoPlay === false &&
    stored.settings?.autoPlayMinDelaySec === 8 && stored.settings?.autoPlayMaxDelaySec === 8,
    'floating settings: changes saved to chrome.storage.sync');
  await game.locator('#vektra-floating-settings').locator('button[aria-label="Close Vektra settings"]').click();
  const launcher = game.locator('#vektra-floating-settings').locator('#vektra-settings-launcher');
  check(await launcher.isVisible(), 'floating settings: close leaves a small launcher');
  const launcherRect = await launcher.boundingBox();
  if (launcherRect) {
    await game.mouse.move(launcherRect.x + 30, launcherRect.y + 15);
    await game.mouse.down();
    await game.mouse.move(launcherRect.x - 25, launcherRect.y + 45, { steps: 4 });
    await game.mouse.up();
  }
  const movedLauncherRect = await launcher.boundingBox();
  check(
    !!launcherRect && !!movedLauncherRect && movedLauncherRect.x < launcherRect.x - 20,
    'floating settings: launcher can be dragged',
  );
  await launcher.click();
  check(
    await game.locator('#vektra-floating-settings').locator('iframe').isVisible(),
    'floating settings: clicking launcher reopens settings',
  );
  game.once('dialog', (dialog) => void dialog.accept());
  await settings.locator('#reset-settings').click();
  const reset = await sw.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    return settings?.enabled === true &&
      settings?.arrows === 3 &&
      settings?.autoPlay === false &&
      settings?.occasionalWeakerMoves === false;
  });
  check(reset, 'settings: reset action restores defaults');
  await game.close();
}

{
  const analysisPage = await ctx.newPage();
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await analysisPage.goto('https://www.chess.com/analysis');
  await analysisPage.waitForFunction(
    () => document.querySelectorAll('svg.vektra-overlay polygon').length > 0,
    null,
    { timeout: 30000 },
  );
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.chess.com/analysis' });
    await chrome.tabs.sendMessage(tab.id, { type: 'vektra:open-settings' });
  });
  const settingsFrame = analysisPage.locator('#vektra-floating-settings iframe');
  await settingsFrame.waitFor({ state: 'visible', timeout: 10000 });
  const analysisSettings = analysisPage.frameLocator('#vektra-floating-settings iframe');
  const contextTab = await analysisSettings
    .locator('[data-tab="analysis"]')
    .getAttribute('aria-selected');
  check(
    contextTab === 'true' && (await analysisSettings.locator('[role="tab"]').count()) === 3,
    'settings: opens on analysis tools on analysis pages',
  );
  await analysisPage.close();
}
}

await ctx.close();
process.exit(failed ? 1 : 0);
