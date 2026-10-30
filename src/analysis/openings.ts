import book from './openings.json';

/** Position key used by openings.json: placement, side to move, castling. */
export const bookKey = (fen: string) => fen.split(' ').slice(0, 3).join(' ');

/** Opening name (with ECO code) if the position is in the book, else undefined. */
export function openingName(fen: string): string | undefined {
  const name = (book as Record<string, string>)[bookKey(fen)];
  return name === undefined ? undefined : name || 'Opening';
}
