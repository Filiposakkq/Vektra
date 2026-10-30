// Copies the single-threaded lite Stockfish build into public/engine so Vite
// ships it with the extension. Run automatically before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('stockfish/package.json'));
const outDir = fileURLToPath(new URL('../public/engine/', import.meta.url));
mkdirSync(outDir, { recursive: true });
// The full engine's 99 MB wasm is downloaded on request; only its loader ships.
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'stockfish-19-single.js']) {
  copyFileSync(join(pkgDir, 'bin', file), join(outDir, file));
}
copyFileSync(join(pkgDir, 'Copying.txt'), join(outDir, 'STOCKFISH-LICENSE.txt'));
console.log('Copied Stockfish engine to public/engine');
