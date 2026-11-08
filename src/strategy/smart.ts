// Our bot: Monte Carlo letter valuation + hold-and-dump word play.
import type { Lexicon, PartitionResult } from "../engine/lexicon.js";
import { LETTER_VALUES, totalTiles } from "../engine/rules.js";
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
  // ---- v2 (all neutral by default, so v1 params behave as before) ----
  earlyAbove: number; // "early game" = bagRemaining above this
  earlyBoost: number; // bid multiplier in the early game
  earlySamples: number; // Monte Carlo samples in the early game (0 = use `samples`)
  earlyEvalRack: number; // evalRack in the early game (0 = use `evalRack`)
  paceExp: number; // budget pacing strength (0 = off)
  pacePrice: number; // coins we expect to pay per tile
  paceShare: number; // share of remaining auctions we aim to win
  spendN: number; // last N auctions: spend down the balance (0 = off)
  spendFrac: number; // bid at least this share of the balance per useful tile then
  // ---- v3: avoid the early "freeze" and buy higher-value letters ----
  floorBase: number; // bid floor = floorBase + floorSlope * face value (0 slope = off)
  floorSlope: number;
  floorUntil: number; // floor applies while bagRemaining is above this
  floorPace: number; // ...and only while balance / planned spend is at least this
  floorMinValue: number; // ...and only for tiles worth at least this much to us
  faceTilt: number; // add faceTilt * face value to bids on useful tiles
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
  earlyAbove: 47,
  earlyBoost: 1,
  earlySamples: 0,
  earlyEvalRack: 0,
  paceExp: 0,
  pacePrice: 13,
  paceShare: 0.2,
  spendN: 0,
  spendFrac: 0.5,
  floorBase: 6,
  floorSlope: 0,
  floorUntil: 8,
  floorPace: 1,
  floorMinValue: 0.5,
  faceTilt: 0,
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
    const p = this.p;
    if (v.bagRemaining > p.earlyAbove && (p.earlySamples || p.earlyEvalRack)) {
      const q = { ...p, samples: p.earlySamples || p.samples, evalRack: p.earlyEvalRack || p.evalRack };
      return this.valuer.marginal(v.rack, letter, v.unseen, v.bagRemaining, q);
    }
    return this.valuer.marginal(v.rack, letter, v.unseen, v.bagRemaining, p);
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
    if (v.bagRemaining > p.earlyAbove) mult *= p.earlyBoost;
    if (p.paceExp > 0) {
      // > 1 when we hold more coins than we can spend at market prices before the end.
      const pace = v.balance / Math.max(1, v.bagRemaining * p.paceShare * p.pacePrice);
      mult *= Math.pow(Math.min(3, Math.max(0.5, pace)), p.paceExp);
    }
    let amount = Math.round(value * mult);
    const face = LETTER_VALUES[letter]!;
    if (p.faceTilt > 0 && value > 0.5) amount += Math.round(p.faceTilt * face);
    if (p.floorSlope > 0 && v.bagRemaining > p.floorUntil && value >= p.floorMinValue) {
      // Rich for this stage of the game: pay at least a market-level price so we keep buying.
      const pace = v.balance / Math.max(1, v.bagRemaining * p.paceShare * p.pacePrice);
      if (pace >= p.floorPace) amount = Math.max(amount, Math.round(p.floorBase + p.floorSlope * face));
    }
    // Coins are worthless at the end: in the last auctions, pay up for any useful tile.
    if (p.spendN > 0 && v.bagRemaining <= p.spendN && value >= 1) {
      amount = Math.max(amount, Math.floor(v.balance * p.spendFrac));
    }
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
