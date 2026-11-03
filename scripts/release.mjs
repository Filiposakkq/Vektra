// Releases Vektra: `npm run release -- 0.4.1` (or patch, minor, major).
//
// 1. Checks you're on bot-only with nothing uncommitted, and that CHANGELOG.md
//    says what changed (under "Unreleased").
// 2. Turns "Unreleased" into this version's section, dated today, and puts a
//    fresh empty "Unreleased" back.
// 3. Sets the version (package.json; the app takes it from there), commits,
//    tags vX.Y.Z and pushes. GitHub's release workflow then builds the
//    extension and the signed app and publishes the release, with this
//    version's changelog section as its notes.
//
// It asks before publishing; --yes skips the question.
// `node scripts/release.mjs notes 0.4.1` prints a version's notes (the
// release workflow uses it).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const changelogPath = resolve(repo, 'CHANGELOG.md');
const TEMPLATE = `## Unreleased

> One line about what this release is for.

### ✨ New

### 🎨 Improved

### 🐛 Fixed
`;

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

/** A section of the changelog: from its heading to the next "---" divider or version heading. */
function section(changelog, heading) {
  const start = changelog.indexOf(`\n${heading}`);
  if (start < 0) return null;
  const ends = ['\n---', '\n## '].map((mark) => changelog.indexOf(mark, start + 2)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) : changelog.length;
  return { start: start + 1, end, text: changelog.slice(start + 1, end) };
}

/** The section's body without its heading, and without the sub-sections left empty. */
function body(text) {
  const lines = text.split('\n').slice(1);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('### ')) {
      const next = lines.slice(i + 1).findIndex((l) => l.startsWith('### '));
      const block = lines.slice(i + 1, next < 0 ? undefined : i + 1 + next);
      if (!block.some((l) => l.trim().startsWith('- '))) {
        i += block.length;
        continue;
      }
    }
    kept.push(lines[i]);
  }
  return kept.join('\n').trim();
}

const changelog = readFileSync(changelogPath, 'utf8');
const [mode, arg] = process.argv.slice(2);

if (mode === 'notes') {
  const found = section(changelog, `## ${arg} ·`);
  if (!found) fail(`CHANGELOG.md has no section for ${arg}.`);
  process.stdout.write(`${body(found.text)}\n\n**Full list of changes:** see [CHANGELOG.md](https://github.com/Filiposakkq/Vektra/blob/bot-only/CHANGELOG.md).\n`);
  process.exit(0);
}

// The release itself.
const wanted = mode;
if (!wanted) fail('Say which version: npm run release -- 0.4.1 (or patch, minor, major).');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'bot-only') fail('Releases are made from the bot-only branch.');
if (git('status', '--porcelain')) fail('Commit or put away your changes first (git status shows them).');

const current = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).version;
const [major, minor, patch] = current.split('.').map(Number);
const version = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[wanted] ?? wanted;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${wanted}" isn't a version (like 0.4.1) or patch, minor, major.`);
if (git('tag', '--list', `v${version}`)) fail(`v${version} was already released.`);

const unreleased = section(changelog, '## Unreleased');
if (!unreleased) fail('CHANGELOG.md has no "## Unreleased" section.');
const notes = body(unreleased.text);
if (!notes.split('\n').some((l) => l.trim().startsWith('- '))) {
  fail('Write what changed under "Unreleased" in CHANGELOG.md first (at least one "- " line), and commit it.');
}

console.log(`\nVektra ${current} → ${version}\n\n${notes}\n`);
if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Publish Vektra ${version} on GitHub? Anyone can download it. [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') fail('Nothing was released.');
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  changelog.slice(0, unreleased.start) + `${TEMPLATE}\n---\n\n## ${version} · ${today}\n\n${notes}\n` + changelog.slice(unreleased.end),
);
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', version, '--no-git-tag-version'], { cwd: repo, stdio: 'ignore', shell: process.platform === 'win32' });
git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json');
git('commit', '-m', `Release ${version}`);
git('tag', `v${version}`);
git('push', 'origin', 'bot-only');
git('push', 'origin', `v${version}`);
console.log(
  `\n✓ Vektra ${version} is on its way. GitHub builds and publishes it in about 4 minutes:\n` +
    `  progress  https://github.com/Filiposakkq/Vektra/actions\n` +
    `  release   https://github.com/Filiposakkq/Vektra/releases/tag/v${version}\n`,
);
