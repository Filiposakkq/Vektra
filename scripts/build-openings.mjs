// Builds src/analysis/openings.json from the Lichess opening TSVs in
// data/openings: a map from position key to opening name. Every position on
// the way to a named line is included, so all of them count as book moves.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const dir = new URL('../data/openings/', import.meta.url);
const out = new URL('../src/analysis/openings.json', import.meta.url);

/** Position key: placement, side to move and castling rights. */
const key = (fen) => fen.split(' ').slice(0, 3).join(' ');

const named = new Map();
const lines = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
  for (const row of readFileSync(new URL(file, dir), 'utf8').trim().split('\n').slice(1)) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    for (const san of pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/)) chess.move(san);
    named.set(key(chess.fen()), `${eco} ${name}`);
    lines.push(pgn);
  }
}

// Positions inside a line take the name of the deepest named position so far.
const book = {};
for (const pgn of lines) {
  const chess = new Chess();
  let name = '';
  for (const san of pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/)) {
    chess.move(san);
    const k = key(chess.fen());
    name = named.get(k) ?? name;
    book[k] ??= name;
  }
}
writeFileSync(out, JSON.stringify(book));
console.log(`${Object.keys(book).length} book positions written`);
