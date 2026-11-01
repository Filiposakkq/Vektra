import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Runs the real updater helper (public/updater/vektra-updater.ps1) against
 * local release zips, and talks to it the way Chrome does. Skipped where no
 * PowerShell is installed.
 */

const windows = process.platform === 'win32';
const shell = windows ? 'powershell.exe' : 'pwsh';
const hasShell = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;
const UPDATER = join(import.meta.dirname, '../public/updater');

const root = mkdtempSync(join(tmpdir(), 'vektra-updater-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function powershell(args: string[]) {
  return spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8' });
}

/** A folder with Vektra's manifest at `version`, the updater, and `files`. */
function folder(name: string, version: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  cpSync(UPDATER, join(dir, 'updater'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'Vektra', version }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

/** A release zip of `files` at `version`, and its checksum file. */
function release(version: string, files: Record<string, string>) {
  const dir = folder(`release-${version}`, version, files);
  const zip = join(root, `vektra-${version}.zip`);
  const made = powershell(['-Command', `Compress-Archive -Path '${join(dir, '*')}' -DestinationPath '${zip}' -Force`]);
  expect(made.status, made.stderr).toBe(0);
  const sha = `${zip}.sha256`;
  writeFileSync(sha, `${createHash('sha256').update(readFileSync(zip)).digest('hex')}  vektra-${version}.zip\n`);
  return { zip, sha };
}

const install = (ext: string, zip: string, sha: string) =>
  powershell(['-File', join(ext, 'updater', 'vektra-updater.ps1'), '-ZipPath', zip, '-ShaPath', sha]);

const version = (ext: string) => JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')).version;

/** Send one native message the way Chrome does (through the .bat on Windows) and read the reply. */
function nativeMessage(ext: string, message: unknown): Promise<unknown> {
  const child = windows
    ? spawn('cmd.exe', ['/d', '/s', '/c', `""${join(ext, 'updater', 'vektra-updater.bat')}" chrome-extension://test/ --parent-window=0"`], {
        windowsVerbatimArguments: true,
      })
    : spawn(shell, ['-NoProfile', '-File', join(ext, 'updater', 'vektra-updater.ps1'), 'chrome-extension://test/']);
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  child.stdin.end(Buffer.concat([header, body]));
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => {
      const out = Buffer.concat(chunks);
      if (out.length < 4) return reject(new Error(`No reply: ${out.toString()}`));
      const length = out.readUInt32LE(0);
      // Exactly one framed reply, nothing else on standard output.
      expect(out.length).toBe(4 + length);
      resolve(JSON.parse(out.subarray(4).toString('utf8')));
    });
  });
}

describe.skipIf(!hasShell)('updater helper', { timeout: 120_000 }, () => {
  it('installs a release over the folder and removes the old files on the next update', () => {
    const ext = folder('ext', '0.1.0', { 'old.js': 'old', 'assets/same.js': 'same' });
    const v2 = release('0.2.0', { 'assets/same.js': 'same', 'assets/new.js': 'new' });
    const first = install(ext, v2.zip, v2.sha);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/Installed Vektra 0\.2\.0/);
    expect(version(ext)).toBe('0.2.0');
    expect(readFileSync(join(ext, 'assets/new.js'), 'utf8')).toBe('new');
    // Kept until Vektra has reloaded: pages may still load it.
    expect(existsSync(join(ext, 'old.js'))).toBe(true);
    expect(readFileSync(join(ext, 'updater/leftovers.txt'), 'utf8')).toMatch(/old\.js/);

    const v3 = release('0.3.0', { 'assets/new.js': 'newer' });
    const second = install(ext, v3.zip, v3.sha);
    expect(second.status, second.stderr).toBe(0);
    expect(version(ext)).toBe('0.3.0');
    expect(existsSync(join(ext, 'old.js'))).toBe(false);
    expect(existsSync(join(ext, 'assets/same.js'))).toBe(true);
    expect(readFileSync(join(ext, 'updater/leftovers.txt'), 'utf8')).toMatch(/assets\/same\.js/);
  });

  it('refuses a download whose checksum does not match', () => {
    const ext = folder('ext-damaged', '0.1.0', {});
    const v2 = release('0.2.1', {});
    writeFileSync(v2.sha, `${'0'.repeat(64)}  vektra-0.2.1.zip\n`);
    const result = install(ext, v2.zip, v2.sha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checksum mismatch/);
    expect(version(ext)).toBe('0.1.0');
  });

  it('answers Chrome with one framed reply', async () => {
    const ext = folder('ext-native', '0.2.0', {});
    expect(await nativeMessage(ext, { type: 'ping' })).toEqual({ ok: true, version: '0.2.0' });
    expect(await nativeMessage(ext, { type: 'dance' })).toEqual({ ok: false, error: 'Unknown request: dance' });
  });
});
