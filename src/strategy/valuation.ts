// Monte Carlo marginal value of a letter: how many final points it adds.
import type { Lexicon } from "../engine/lexicon.js";
import type { Counts } from "../engine/rules.js";
import type { Rng } from "../engine/rng.js";

export interface ValuationParams {
  samples: number; // Monte Carlo samples
  futureShare: number; // fraction of remaining auctions we expect to win
  maxFuture: number; // cap on sampled future tiles
  exactLimit: number; // rack size up to which partition is exact
  evalRack: number; // future tiles are sampled until rack+future reaches this size
}

export class Valuer {
  private cache = new Map<string, number>();

  constructor(
    private lex: Lexicon,
    private rng: Rng,
  ) {}

  /** Partition score, memoised on the rack's letter counts. */
  score(rack: Counts, exactLimit: number): number {
    const key = rack.join(",");
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.lex.partition(rack, false, exactLimit).score;
      if (this.cache.size > 200_000) this.cache.clear();
      this.cache.set(key, v);
    }
    return v;
  }

  futureCount(rackSize: number, bagRemaining: number, p: ValuationParams): number {
    const expected = Math.round(bagRemaining * p.futureShare);
    return Math.max(0, Math.min(expected, p.maxFuture, p.evalRack - rackSize - 1));
  }

  /**
   * E[score(rack + letter + F)] - E[score(rack + F)], F = K random unseen
   * tiles (common random numbers for both terms).
   */
  marginal(rack: Counts, letter: number, unseen: Counts, bagRemaining: number, p: ValuationParams): number {
    let rackSize = 0;
    for (let i = 0; i < 26; i++) rackSize += rack[i]!;
    const k = this.futureCount(rackSize, bagRemaining, p);
    const pool: number[] = [];
    for (let i = 0; i < 26; i++) for (let n = 0; n < unseen[i]!; n++) pool.push(i);
    const kk = Math.min(k, pool.length);
    const samples = kk === 0 ? 1 : p.samples;
    let sum = 0;
    const r = rack.slice();
    for (let s = 0; s < samples; s++) {
      // partial Fisher-Yates
      for (let i = 0; i < kk; i++) {
        const j = i + Math.floor(this.rng() * (pool.length - i));
        const t = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = t;
        r[pool[i]!]!++;
      }
      const without = this.score(r, p.exactLimit);
      r[letter]!++;
      const withL = this.score(r, p.exactLimit);
      r[letter]!--;
      sum += withL - without;
      for (let i = 0; i < kk; i++) r[pool[i]!]!--;
    }
    return sum / samples;
  }
}
