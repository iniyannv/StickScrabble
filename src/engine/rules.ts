// Mirrors spacetimedb/src/letters.ts and constants in game.ts on the server.

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const A_CODE = 65;

export const LETTER_VALUES: readonly number[] = [
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10,
];

// Standard Scrabble distribution, no blanks. 98 tiles.
export const BAG_COUNTS: readonly number[] = [
  9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2, 1,
];
export const BAG_SIZE = 98;

export const STARTING_BALANCE = 100;
export const STARTING_RACK_SIZE = 5;
export const LOBBY_MAX_SIZE = 6;
export const AUCTION_RESERVE = 1;

export function letterIndex(c: string): number {
  return c.charCodeAt(0) - A_CODE;
}

export function letterValue(c: string): number {
  return LETTER_VALUES[letterIndex(c)] ?? 0;
}

// (numerator, denominator) — reward = floor(base * num / den).
export function lengthMultiplier(len: number): [number, number] {
  if (len <= 3) return [1, 1];
  if (len === 4) return [3, 2];
  if (len === 5) return [2, 1];
  if (len === 6) return [5, 2];
  return [3, 1];
}

export function baseScore(word: string): number {
  let s = 0;
  for (let i = 0; i < word.length; i++) s += LETTER_VALUES[word.charCodeAt(i) - A_CODE]!;
  return s;
}

export function wordReward(word: string): number {
  const [n, d] = lengthMultiplier(word.length);
  return Math.floor((baseScore(word) * n) / d);
}

export type Counts = number[]; // length 26

export function emptyCounts(): Counts {
  return new Array<number>(26).fill(0);
}

export function countsFromString(s: string): Counts {
  const c = emptyCounts();
  for (let i = 0; i < s.length; i++) c[s.charCodeAt(i) - A_CODE]!++;
  return c;
}

export function countsToString(c: Counts): string {
  let s = "";
  for (let i = 0; i < 26; i++) s += ALPHABET[i]!.repeat(c[i]!);
  return s;
}

export function countsFromMap(m: Map<string, number>): Counts {
  const c = emptyCounts();
  for (const [l, n] of m) {
    const i = letterIndex(l);
    if (i >= 0 && i < 26) c[i]! += n;
  }
  return c;
}

export function totalTiles(c: Counts): number {
  let t = 0;
  for (let i = 0; i < 26; i++) t += c[i]!;
  return t;
}
