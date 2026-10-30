import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import type { AnalyzeRequest } from '../src/engine/protocol';
import { UciEngine } from '../src/engine/uciEngine';
import { ELO_PRESETS } from '../src/shared/settings';

const require = createRequire(import.meta.url);
const lines: ((line: string) => void)[] = [];
const stockfish = require('stockfish')('lite-single', (line: string) => lines.forEach((f) => f(line)));
const engine = new UciEngine((command) => stockfish.processCommand(command));
lines.push((line) => engine.handleLine(line));
afterAll(() => stockfish.terminate?.());

const positions = [
  // Hanging material presented to rooks, bishops, and knights from both sides.
  { name: 'rook takes queen on file', fen: 'q6k/8/8/8/8/8/8/R5K1 w - - 0 1', best: 'a1a8' },
  { name: 'rook takes queen on file, other side', fen: 'k6q/8/8/8/8/8/8/K6R w - - 0 1', best: 'h1h8' },
  { name: 'queen takes rook on file', fen: 'r7/7k/8/8/8/8/8/Q5K1 w - - 0 1', best: 'a1a8' },
  { name: 'black rook takes queen on file', fen: 'r7/7k/8/8/8/8/8/Q6K b - - 0 1', best: 'a8a1' },
  { name: 'bishop takes queen diagonally', fen: 'k7/7q/8/8/8/8/8/KB6 w - - 0 1', best: 'b1h7' },
  { name: 'black bishop takes queen diagonally', fen: '6bk/8/8/8/8/1Q6/8/K7 b - - 0 1', best: 'g8b3' },
  { name: 'knight takes queen', fen: 'k7/7q/5N2/8/8/8/8/K7 w - - 0 1', best: 'f6h7' },
  { name: 'black knight takes queen', fen: '7k/8/8/3n4/8/2Q5/8/K7 b - - 0 1', best: 'd5c3' },
  { name: 'rook takes bishop', fen: 'b6k/8/8/8/8/8/8/R5K1 w - - 0 1', best: 'a1a8' },
];

const request = (fen: string, elo: number): AnalyzeRequest => ({
  fen,
  multipv: 1,
  limit: { depth: 12 },
  strength: { skillLevel: 20, limitStrength: true, elo },
});

describe('Elo strength calibration', { timeout: 60000 }, () => {
  it('reports tactical outcomes for all UI strength presets', async () => {
    const misses = Object.fromEntries(ELO_PRESETS.map(({ label }) => [label, 0])) as Record<
      (typeof ELO_PRESETS)[number]['label'],
      number
    >;
    const samples = Object.fromEntries(ELO_PRESETS.map(({ label }) => [label, 0])) as Record<
      (typeof ELO_PRESETS)[number]['label'],
      number
    >;
    const attempts = 12;

    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const position of positions) {
        for (const { label, elo } of ELO_PRESETS) {
          const result = await engine.analyze(request(position.fen, elo));
          samples[label]++;
          if (result?.bestmove !== position.best) misses[label]++;
        }
      }
    }
    const total = positions.length * attempts;
    console.info(
      'Fixed-position tactical miss rate:',
      Object.entries(misses)
        .map(([label, count]) => `${label} ${count}/${total} (${((count / total) * 100).toFixed(1)}%)`)
        .join(' | '),
    );
    expect(Object.values(samples)).toEqual(Array(ELO_PRESETS.length).fill(total));
  });
});
