/**
 * Not a unit test: analyses a PGN with the real engine and prints a report,
 * for comparing Vektra's classifications with another tool.
 * Run with: PGN=path/to/game.pgn DEPTH=16 npx vitest run tests/tools
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'vitest';
import {
  analyzeGame,
  classifyGame,
  gameOpening,
  summarize,
  type GameAnalysis,
} from '../../src/analysis/gameAnalysis';
import { replay } from '../../src/content/fen';
import { UciEngine } from '../../src/engine/uciEngine';

const pgnPath = process.env.PGN;

it.runIf(pgnPath)('analyse PGN', { timeout: 1_800_000 }, async () => {
  const require = createRequire(import.meta.url);
  const listeners: ((l: string) => void)[] = [];
  const sf = require('stockfish')(process.env.ENGINE ?? 'lite-single', (l: string) =>
    listeners.forEach((f) => f(l)),
  );
  const engine = new UciEngine((cmd) => sf.processCommand(cmd));
  listeners.push((l) => engine.handleLine(l));

  const text = readFileSync(pgnPath!, 'utf8').replace(/\[.*?\]/g, '').replace(/\{.*?\}/gs, '');
  const sans = text
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  // REUSE=saved.json re-classifies saved engine output without re-running the engine.
  let a: GameAnalysis | null;
  if (process.env.REUSE) {
    const saved = JSON.parse(readFileSync(process.env.REUSE, 'utf8')) as GameAnalysis;
    const { uci } = replay(saved.sans);
    const moves = classifyGame(saved.sans, uci, saved.positions);
    a = { ...saved, moves, opening: gameOpening(saved.positions, moves), summary: summarize(moves) };
  } else {
    a = await analyzeGame(sans, engine, { depth: Number(process.env.DEPTH ?? 16) });
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(a));
  for (const m of a!.moves) {
    console.log(
      `${String(Math.ceil(m.ply / 2)).padStart(2)}${m.color === 'w' ? '. ' : '...'} ${m.san.padEnd(7)} ${m.category.padEnd(10)} loss ${m.loss.toFixed(1).padStart(5)}  before ${m.winBefore.toFixed(0).padStart(3)} after ${m.winAfter.toFixed(0).padStart(3)}  best ${m.bestSan}`,
    );
  }
  console.log('white', a!.summary.w.accuracy.toFixed(1), JSON.stringify(a!.summary.w.counts));
  console.log('black', a!.summary.b.accuracy.toFixed(1), JSON.stringify(a!.summary.b.counts));
  sf.terminate?.();
});
