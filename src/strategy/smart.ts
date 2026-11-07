// Our bot: Monte Carlo letter valuation + hold-and-dump word play.
import type { Lexicon, PartitionResult } from "../engine/lexicon.js";
import { totalTiles } from "../engine/rules.js";
import type { Rng } from "../engine/rng.js";
import type { BotView, Strategy } from "./types.js";
import { Valuer, type ValuationParams } from "./valuation.js";

export interface SmartParams extends ValuationParams {
  aggr: number; // bid = V * aggr (mid-game)
  endAggr: number; // multiplier once bagRemaining <= endgameN
  endgameN: number;
  richBoost: number; // extra multiplier per unit of "excess" balance
  expectedPrice: number; // coins per tile we expect to pay (for richness)
  minBidUseful: number; // floor bid when V > 0.5
  playLen: number; // play words of at least this length mid-game
  lowBalance: number; // below this, cash in the best word
  dumpAt: number; // dump everything when bagRemaining <= dumpAt
  fpShade: number; // first-price auctions: bid this fraction of the Vickrey bid
}

export const DEFAULT_SMART: SmartParams = {
  samples: 8,
  futureShare: 0.3,
  maxFuture: 8,
  exactLimit: 11,
  evalRack: 11,
  aggr: 1.0,
  endAggr: 1.5,
  endgameN: 8,
  richBoost: 0.5,
  expectedPrice: 4,
  minBidUseful: 1,
  playLen: 7,
  lowBalance: 10,
  dumpAt: 1,
  fpShade: 0.6,
};

export class SmartStrategy implements Strategy {
  readonly name: string;
  private valuer: Valuer;
  readonly p: SmartParams;
  private partCache = new Map<string, PartitionResult>();

  constructor(
    private lex: Lexicon,
    rng: Rng,
    params: Partial<SmartParams> = {},
    name = "smart",
  ) {
    this.p = { ...DEFAULT_SMART, ...params };
    this.valuer = new Valuer(lex, rng);
    this.name = name;
  }

  value(v: BotView, letter: number): number {
    return this.valuer.marginal(v.rack, letter, v.unseen, v.bagRemaining, this.p);
  }

  bid(v: BotView, letter: number): number {
    const p = this.p;
    // The final auction's tile arrives as the match ends: worthless.
    if (v.bagRemaining === 0) return 0;
    const value = this.value(v, letter);
    if (value <= 0.25) return 0;
    let mult = v.bagRemaining <= p.endgameN ? p.endAggr : p.aggr;
    const need = Math.max(1, v.bagRemaining * p.futureShare * p.expectedPrice);
    const richness = v.balance / need;
    if (richness > 1) mult *= 1 + p.richBoost * Math.min(richness - 1, 3);
    let amount = Math.round(value * mult);
    if (v.auctionType === "FirstPrice") amount = Math.round(amount * p.fpShade);
    if (value > 0.5) amount = Math.max(amount, p.minBidUseful);
    return Math.max(0, Math.min(amount, v.balance));
  }

  chooseWords(v: BotView): string[] {
    const p = this.p;
    if (totalTiles(v.rack) < 2) return [];
    const key = v.rack.join(",");
    let part = this.partCache.get(key);
    if (!part) {
      part = this.lex.partition(v.rack, true, 16);
      if (this.partCache.size > 50_000) this.partCache.clear();
      this.partCache.set(key, part);
    }
    if (v.bagRemaining <= p.dumpAt) return part.words.map((w) => w.word);
    const out = part.words.filter((w) => w.word.length >= p.playLen).map((w) => w.word);
    if (out.length === 0 && v.balance < p.lowBalance && part.words.length > 0) {
      const best = [...part.words].sort((a, b) => b.reward - a.reward)[0]!;
      out.push(best.word);
    }
    return out;
  }
}
