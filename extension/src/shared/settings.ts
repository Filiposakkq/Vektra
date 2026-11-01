/**
 * User settings, stored in chrome.storage.sync and edited in the popup. The
 * settings themselves (fields, defaults, checks) are shared: core/settings.ts.
 */
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@core/settings';

export * from '@core/settings';

const STORAGE_KEY = 'settings';
const MIGRATIONS_KEY = 'settingsMigrations';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function migrateWeakerMoveDefaults(): Promise<void> {
  const [stored, local] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEY),
    chrome.storage.local.get(MIGRATIONS_KEY),
  ]);
  const migrations = (local[MIGRATIONS_KEY] as Record<string, boolean> | undefined) ?? {};
  const saved = stored[STORAGE_KEY];
  const updated = isRecord(saved) ? { ...saved } : null;
  const nextMigrations = { ...migrations };

  if (!migrations.weakerMovesV1) {
    if (
      updated &&
      'weakerMoveChancePercent' in updated &&
      'weakerMoveMaxLossCp' in updated &&
      updated.weakerMoveChancePercent === 20 &&
      updated.weakerMoveMaxLossCp === 100
    ) {
      updated.weakerMoveChancePercent = DEFAULT_SETTINGS.weakerMoveChancePercent;
      updated.weakerMoveMaxLossCp = DEFAULT_SETTINGS.weakerMoveMaxLossCp;
    }
    nextMigrations.weakerMovesV1 = true;
  }

  if (!migrations.analysisSpeedV1) {
    if (updated?.analysisDepth === 16) updated.analysisDepth = DEFAULT_SETTINGS.analysisDepth;
    nextMigrations.analysisSpeedV1 = true;
  }

  if (updated && JSON.stringify(updated) !== JSON.stringify(saved)) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: updated });
  }
  if (JSON.stringify(nextMigrations) !== JSON.stringify(migrations)) {
    await chrome.storage.local.set({ [MIGRATIONS_KEY]: nextMigrations });
  }
}

/*
 * Settings have a single writer: the background worker. Every other context
 * (popup, floating settings, content scripts) sends its changes there, where
 * one queue applies them one at a time, so changes made in different places
 * at once can't overwrite each other's fields.
 */

/** Runtime message asking the background worker to apply a settings patch. */
export const SAVE_SETTINGS = 'vektra:save-settings';
/** Runtime message asking the background worker to run the one-time settings migrations. */
export const MIGRATE_SETTINGS = 'vektra:migrate-settings';

type SettingsReply = { ok: true; settings?: Settings } | { ok: false; error: string };

/** True in the background worker (see becomeSettingsWriter). */
let isWriter = false;
let writeQueue: Promise<void> = Promise.resolve();
let migratedHere = false;

/** Run `task` after every task queued before it has finished. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Inside a queued task: the migrations, once per worker lifetime. */
async function migrateOnce(): Promise<void> {
  if (migratedHere) return;
  await migrateWeakerMoveDefaults();
  migratedHere = true;
}

/** Call once in the background worker: it then writes settings itself. */
export function becomeSettingsWriter(): void {
  isWriter = true;
}

/**
 * Background worker only: read, merge, sanitize and write the settings, after
 * every earlier patch has been written. `patch` may be a function of the
 * current settings, for changes like toggling a field.
 */
export function applySettingsPatch(
  patch: Partial<Settings> | ((current: Settings) => Partial<Settings>),
): Promise<Settings> {
  return enqueue(async () => {
    await migrateOnce();
    const current = sanitizeSettings((await chrome.storage.sync.get(STORAGE_KEY))[STORAGE_KEY]);
    const next = sanitizeSettings({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    return next;
  });
}

/**
 * Background worker only: answers SAVE_SETTINGS and MIGRATE_SETTINGS. Returns
 * true when it will reply (for chrome.runtime.onMessage).
 */
export function handleSettingsMessage(msg: unknown, sendResponse: (reply: SettingsReply) => void): boolean {
  if (!isRecord(msg) || (msg.type !== SAVE_SETTINGS && msg.type !== MIGRATE_SETTINGS)) return false;
  // sanitizeSettings drops anything in a patch that isn't a valid setting.
  const patch = isRecord(msg.patch) ? (msg.patch as Partial<Settings>) : {};
  const work: Promise<Settings | undefined> =
    msg.type === SAVE_SETTINGS ? applySettingsPatch(patch) : enqueue(migrateOnce).then(() => undefined);
  work.then(
    (settings) => sendResponse({ ok: true, settings }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
}

async function sendToWriter(message: { type: string; patch?: Partial<Settings> }): Promise<Settings | undefined> {
  const reply = (await chrome.runtime.sendMessage(message)) as SettingsReply | undefined;
  if (!reply) throw new Error('the background worker did not reply');
  if (!reply.ok) throw new Error(reply.error);
  return reply.settings;
}

let migration: Promise<void> | null = null;

/** The one-time migrations, run by the writer; asked for once per context. */
function migrated(): Promise<void> {
  migration ??= (isWriter ? enqueue(migrateOnce) : sendToWriter({ type: MIGRATE_SETTINGS }).then(() => undefined)).catch(
    () => {
      // Reading settings must not fail because of this; try again next time.
      migration = null;
    },
  );
  return migration;
}

export async function loadSettings(): Promise<Settings> {
  await migrated();
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return sanitizeSettings(stored[STORAGE_KEY]);
}

/** This context's patches, sent one after another so they arrive in order. */
let sendChain: Promise<void> = Promise.resolve();

/** Apply `patch` to the stored settings; resolves with the settings saved. */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  if (isWriter) return applySettingsPatch(patch);
  const send = sendChain.then(async () => {
    const settings = await sendToWriter({ type: SAVE_SETTINGS, patch });
    if (!settings) throw new Error('the background worker did not return the saved settings');
    return settings;
  });
  sendChain = send.then(() => undefined, () => undefined);
  return send;
}

/** Calls back with the new settings whenever they change anywhere. */
export function onSettingsChanged(callback: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && STORAGE_KEY in changes) callback(sanitizeSettings(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Messages from the background worker to content scripts for keyboard shortcuts. */
export const SHOW_HINT = 'vektra:show-hint';
export const OPEN_SETTINGS = 'vektra:open-settings';
