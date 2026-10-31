import {
  FULL_ENGINE,
  FULL_ENGINE_DOWNLOAD,
  FULL_ENGINE_REMOVE,
  FULL_ENGINE_STATUS,
  FULL_ENGINE_STATUS_KEY,
  type FullEngineStatus,
} from '../engine/fullEngine';
import { ENSURE_ENGINE } from '../engine/protocol';
import {
  DEFAULT_SETTINGS,
  ELO_PRESETS,
  OPEN_SETTINGS,
  PRESETS,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type Settings,
} from '../shared/settings';

/** Settings update the UI immediately; slider writes are coalesced before saving. */

type Key = keyof Settings;
let settings: Settings = DEFAULT_SETTINGS;
let pendingSettings: Partial<Settings> = {};
// Changes made here that storage hasn't confirmed yet. A storage change that
// arrives in the meantime (e.g. an earlier save landing) must not undo them.
let unconfirmedSettings: Partial<Settings> = {};
let settingsSaveTimer: number | null = null;
let settingsSaveQueue: Promise<void> = Promise.resolve();
let settingsSaveError: string | null = null;

const inputs = () => document.querySelectorAll<HTMLInputElement>('form input[name], header input[name]');

function valueFor(name: string): unknown {
  return settings[name as Key];
}

/** Convert an input value to the corresponding setting type. */
function patchFor(input: HTMLInputElement): Partial<Settings> {
  const key = input.name as Key;
  const kind = typeof DEFAULT_SETTINGS[key];
  let value: unknown = input.value;
  if (input.type === 'checkbox') value = input.checked;
  else if (kind === 'boolean') value = input.value === 'true';
  else if (kind === 'number') value = Number(input.value);
  return { [key]: value } as Partial<Settings>;
}

function render() {
  for (const input of inputs()) {
    const value = valueFor(input.name);
    if (input.type === 'checkbox') input.checked = value === true;
    else if (input.type === 'radio') input.checked = input.value === String(value);
    else if (document.activeElement !== input) input.value = String(value);
  }
  for (const out of document.querySelectorAll<HTMLOutputElement>('output[data-for]')) {
    const value = settings[out.dataset.for as Key];
    if (out.dataset.format === 'seconds') out.textContent = `${(Number(value) / 1000).toFixed(1)} s`;
    else if (out.dataset.format === 'decimal-seconds') out.textContent = `${Number(value).toFixed(1)} s`;
    else if (out.dataset.format === 'centipawns') out.textContent = `${(Number(value) / 100).toFixed(2)} pawns`;
    else if (out.dataset.for === 'weakerMoveChancePercent') out.textContent = `${value}%`;
    else out.textContent = String(value);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-show]')) {
    const cond = el.dataset.show!;
    if (cond === 'weakened') {
      el.hidden = !(settings.limitStrength || settings.skillLevel < 20);
      continue;
    }
    const [key, value] = cond.split('=');
    el.hidden = String(settings[key as Key]) !== value;
  }
  if (document.getElementById('engine-status')) renderEngine();
  const status = document.getElementById('status')!;
  status.textContent = settingsSaveError ?? (settings.enabled ? 'Enabled' : 'Paused');
  status.classList.toggle('on', settings.enabled);
  const enabledInput = document.querySelector<HTMLInputElement>('input[name="enabled"]')!;
  enabledInput.setAttribute('aria-label', settings.enabled ? 'Turn Vektra off' : 'Turn Vektra on');
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#presets button')) {
    const preset = PRESETS[btn.dataset.preset!];
    const applied = Object.entries(preset.settings).every(
      ([k, v]) => JSON.stringify(settings[k as Key]) === JSON.stringify(v),
    );
    btn.classList.toggle('applied', applied);
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#strength-presets button')) {
    btn.classList.toggle(
      'applied',
      settings.limitStrength && settings.elo === Number(btn.dataset.elo),
    );
  }
}

function flushSettings(): Promise<void> {
  if (settingsSaveTimer !== null) {
    window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  const patch = pendingSettings;
  pendingSettings = {};
  if (!Object.keys(patch).length) return settingsSaveQueue;

  settingsSaveQueue = settingsSaveQueue.then(async () => {
    await saveSettings(patch);
    settingsSaveError = null;
    render();
  }).catch((error: unknown) => {
    settingsSaveError = 'Settings could not be saved';
    console.error('[Vektra] Could not save settings:', error);
    render();
  }).finally(() => confirmSettings(patch));
  return settingsSaveQueue;
}

/** Stop protecting the keys of `patch` unless a newer change has replaced them. */
function confirmSettings(patch: Partial<Settings>) {
  for (const key of Object.keys(patch) as Key[]) {
    if (unconfirmedSettings[key] === patch[key]) delete unconfirmedSettings[key];
  }
}

function save(patch: Partial<Settings>, debounce = false): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  pendingSettings = { ...pendingSettings, ...patch };
  unconfirmedSettings = { ...unconfirmedSettings, ...patch };
  render();
  if (debounce) {
    if (settingsSaveTimer !== null) window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = window.setTimeout(() => void flushSettings(), 500);
    return Promise.resolve();
  }
  return flushSettings();
}

function renderPresets() {
  const box = document.getElementById('presets')!;
  box.replaceChildren(
    ...Object.entries(PRESETS).map(([name, preset]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = name;
      b.append(name);
      const small = document.createElement('small');
      small.textContent = preset.description;
      b.append(small);
      b.addEventListener('click', () => void save(preset.settings));
      return b;
    }),
  );
}

function renderStrengthPresets() {
  const box = document.getElementById('strength-presets')!;
  box.replaceChildren(
    ...ELO_PRESETS.map(({ label, elo }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.elo = String(elo);
      b.textContent = label;
      b.title = `Set approximate engine strength to ${elo} Elo`;
      b.addEventListener('click', () => void save({ limitStrength: true, elo }));
      return b;
    }),
  );
}

function selectTab(tab: string) {
  const availableTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  if (!availableTabs.some((button) => button.dataset.tab === tab)) tab = 'hints';
  for (const button of availableTabs) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const p of document.querySelectorAll<HTMLElement>('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  if (new URLSearchParams(location.search).get('floating') === '1') {
    document.scrollingElement?.scrollTo({ top: 0 });
  }
  try {
    localStorage.setItem('vektra-tab', tab);
  } catch {
    // Not important if it can't be remembered.
  }
}

function pageContext(pathname: string): 'analysis' | 'game' | null {
  if (/^\/(analysis|game\/review)(\/|$)/i.test(pathname)) return 'analysis';
  if (/^\/(play|game|live|daily|variants)(\/|$)/i.test(pathname)) return 'game';
  return null;
}

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const box = document.getElementById('shortcuts')!;
  box.replaceChildren(
    ...commands
      .filter((c) => c.name && c.description)
      .flatMap((c) => {
        const label = document.createElement('span');
        label.textContent = c.description!;
        const key = document.createElement('kbd');
        key.textContent = c.shortcut || 'not set';
        return [label, key];
      }),
  );
  for (const kbd of document.querySelectorAll<HTMLElement>('kbd[data-command]')) {
    kbd.textContent = commands.find((c) => c.name === kbd.dataset.command)?.shortcut || 'the shortcut';
  }
}

let engineStatus: FullEngineStatus = { state: 'missing' };

function renderEngine() {
  const st = engineStatus;
  const full = document.getElementById('engine-full') as HTMLInputElement;
  full.disabled = st.state !== 'ready';
  const text = document.getElementById('engine-status')!;
  const download = document.getElementById('engine-download') as HTMLButtonElement;
  const remove = document.getElementById('engine-remove')!;
  const bar = document.getElementById('engine-progress')!;
  download.hidden = st.state === 'ready';
  download.disabled = st.state === 'downloading';
  remove.hidden = st.state !== 'ready';
  bar.hidden = st.state !== 'downloading';
  if (st.state === 'downloading') {
    const progress = Math.round(st.progress * 100);
    (bar.firstElementChild as HTMLElement).style.width = `${progress}%`;
    bar.setAttribute('aria-valuenow', String(progress));
  } else {
    bar.setAttribute('aria-valuenow', '0');
  }
  text.textContent = {
    missing: 'Lite is a quick, compact engine. The full engine is a larger one-time download and uses more memory.',
    downloading: `Downloading… ${st.state === 'downloading' ? Math.round(st.progress * 100) : 0}%`,
    ready: settings.engine === 'full' ? 'Full engine selected.' : 'Full engine ready. Select it above to use it.',
    error: `Download failed: ${st.state === 'error' ? st.message : ''}`,
  }[st.state];
}

async function startDownload() {
  // Must run in the click handler: Chrome only shows the permission prompt for a user gesture.
  const granted = await chrome.permissions.request({ origins: [...FULL_ENGINE.origins] });
  if (!granted) {
    engineStatus = { state: 'error', message: 'permission to download from GitHub was not given' };
    renderEngine();
    return;
  }
  await chrome.runtime.sendMessage({ type: ENSURE_ENGINE });
  await chrome.runtime.sendMessage({ type: FULL_ENGINE_DOWNLOAD });
}

async function initializePopup() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !('settings' in changes)) return;
    settings = sanitizeSettings({ ...(changes.settings.newValue as Partial<Settings>), ...unconfirmedSettings });
    render();
  });
  document.getElementById('engine-download')!.addEventListener('click', () => void startDownload());
  // The background switches the engine setting when the full engine is
  // downloaded or removed (see recordEngineStatus); the popup only shows it.
  document.getElementById('engine-remove')!.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: FULL_ENGINE_REMOVE });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(FULL_ENGINE_STATUS_KEY in changes)) return;
    engineStatus = (changes[FULL_ENGINE_STATUS_KEY].newValue as FullEngineStatus | undefined) ?? { state: 'missing' };
    renderEngine();
  });

  document.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.name) return;
    if (input.type === 'number' && input.value === '') return;
    void save(patchFor(input), input.type === 'range');
  });

  document.addEventListener('change', () => {
    void flushSettings();
    render();
  });
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  for (const [index, button] of tabs.entries()) {
    button.addEventListener('click', () => selectTab(button.dataset.tab!));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTab(next.dataset.tab!);
      next.focus();
    });
  }
  document.getElementById('edit-shortcuts')!.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  document.getElementById('reset-settings')!.addEventListener('click', () => {
    if (!window.confirm('Reset all Vektra settings to their defaults?')) return;
    void save(DEFAULT_SETTINGS);
  });

  const requestedContext = new URLSearchParams(location.search).get('context');
  let context = requestedContext === 'analysis' || requestedContext === 'game'
    ? requestedContext
    : null;
  if (!context) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      context = pageContext(new URL(activeTab?.url ?? '').pathname);
    } catch {
      context = null;
    }
  }
  let initialTab = context === 'analysis' ? 'analysis' : 'hints';
  try {
    if (!context) initialTab = localStorage.getItem('vektra-tab') ?? 'hints';
  } catch {
    // Use the default tab.
  }
  selectTab(initialTab);
  renderPresets();
  renderStrengthPresets();
  settings = await loadSettings();
  render();
  void renderShortcuts();
  engineStatus =
    ((await chrome.storage.local.get(FULL_ENGINE_STATUS_KEY))[FULL_ENGINE_STATUS_KEY] as FullEngineStatus | undefined) ??
    { state: 'missing' };
  renderEngine();
  void chrome.runtime
    .sendMessage({ type: ENSURE_ENGINE })
    .then(() => chrome.runtime.sendMessage({ type: FULL_ENGINE_STATUS, query: true }))
    .catch(() => {});
}

async function openFloatingSettings(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      await initializePopup();
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: OPEN_SETTINGS });
    window.close();
  } catch (error) {
    if (!(error instanceof Error && /Could not establish connection|Receiving end does not exist/i.test(error.message))) {
      console.warn('[Vektra] Could not open settings on this page; using the toolbar popup.', error);
    }
    await initializePopup();
  }
}

const isFloating = new URLSearchParams(location.search).get('floating') === '1';
document.documentElement.classList.toggle('floating-page', isFloating);
document.body.classList.toggle('floating-page', isFloating);

if (isFloating) {
  let resizeFrame = 0;
  const reportContentHeight = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      // The parent is the host page, so the extension origin is not a valid target origin.
      const height = Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height);
      window.parent.postMessage(
        { type: 'vektra:settings-content-height', height },
        '*',
      );
    });
  };
  new ResizeObserver(reportContentHeight).observe(document.body);
  new MutationObserver(reportContentHeight).observe(document.body, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener('load', reportContentHeight);
  window.addEventListener('resize', reportContentHeight);
  reportContentHeight();
}

if (isFloating) {
  document.addEventListener(
    'wheel',
    (event) => {
      const scroller = document.scrollingElement;
      if (!scroller) return;
      const atTop = scroller.scrollTop <= 0 && event.deltaY < 0;
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    },
    { passive: false },
  );
}

if (new URLSearchParams(location.search).get('launch') === '1') {
  void openFloatingSettings();
} else {
  void initializePopup();
}
