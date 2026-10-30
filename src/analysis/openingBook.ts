import { BOOK_MAX_PLY } from './config';

/**
 * True if every move up to and including this ply stayed in the opening book,
 * given a lookup of opening names by FEN.
 */
export function isBookLineWith(
  openingName: (fen: string) => string | undefined,
  fens: string[],
  ply: number,
): boolean {
  if (ply > BOOK_MAX_PLY) return false;
  for (let index = 1; index <= ply; index++) {
    if (openingName(fens[index]) === undefined) return false;
  }
  return true;
}

/** isBookLineWith, loading the opening database on first use. */
export async function isBookLine(fens: string[], ply: number): Promise<boolean> {
  if (ply > BOOK_MAX_PLY) return false;
  const { openingName } = await import('./openings');
  return isBookLineWith(openingName, fens, ply);
}
