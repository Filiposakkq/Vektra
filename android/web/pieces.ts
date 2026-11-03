/**
 * The review board's pieces: the cburnett set (Colin M.L. Burnett, GPLv2+;
 * see pieces/README.md), the classic set Lichess and Wikipedia use.
 */
const FILES = import.meta.glob('./pieces/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A piece as an SVG element string; `piece` is a FEN letter (upper case is White). */
export function pieceSvg(piece: string): string {
  const name = (piece === piece.toUpperCase() ? 'w' : 'b') + piece.toUpperCase();
  return (FILES[`./pieces/${name}.svg`] ?? '').replace('<svg ', '<svg class="piece" aria-hidden="true" ');
}
