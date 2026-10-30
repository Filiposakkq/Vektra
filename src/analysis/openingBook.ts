import { BOOK_MAX_PLY } from './config';

export async function isBookLine(fens: string[], ply: number): Promise<boolean> {
  if (ply > BOOK_MAX_PLY) return false;
  const { openingName } = await import('./openings');
  for (let index = 1; index <= ply; index++) {
    if (openingName(fens[index]) === undefined) return false;
  }
  return true;
}
