// Opponent model fitted to live data: bids drawn from the empirical
// distribution of real bots' winning bids for each letter; word play like ours.
import * as fs from "node:fs";
import type { Lexicon } from "../engine/lexicon.js";
import { letterIndex } from "../engine/rules.js";
import type { Rng } from "../engine/rng.js";
import { SmartStrategy } from "./smart.js";
import type { BotView, Strategy } from "./types.js";

let TABLE: number[][] | null = null;

export function histBidTable(file = "data/history.json"): number[][] {
  if (TABLE) return TABLE;
  const h = JSON.parse(fs.readFileSync(file, "utf8"));
  const top = new Map<string, number>();
  for (const r of h.topBids) top.set(r.auctionId, r.topBid);
  const t: number[][] = Array.from({ length: 26 }, () => []);
  for (const r of h.results) {
    if (r.winner == null || h.bots[r.winner]?.sim) continue;
    const b = top.get(r.auctionId);
    if (b !== undefined) t[letterIndex(r.letter)]!.push(b);
  }
  return (TABLE = t);
}

export class HistStrategy implements Strategy {
  readonly name = "hist";
  private words: SmartStrategy;
  constructor(
    lex: Lexicon,
    private rng: Rng,
    private scale = 1,
  ) {
    this.words = new SmartStrategy(lex, rng);
  }
  bid(v: BotView, letter: number): number {
    if (v.bagRemaining === 0) return 0;
    const samples = histBidTable()[letter]!;
    if (samples.length === 0) return 0;
    const b = samples[Math.floor(this.rng() * samples.length)]! * this.scale;
    return Math.min(v.balance, Math.round(b));
  }
  chooseWords(v: BotView): string[] {
    return this.words.chooseWords(v);
  }
}

// ---- "Field" opponent: bids sampled from recent clearing prices ----
//
// Clearing price = what the winner paid (the 2nd-highest bid), bucketed by
// letter and by how far into the match the auction was. Five of these bots
// reproduce the prices a 6-bot all-real lobby produces once `scale` is
// calibrated (see `npm run sim -- --opp field`).

export const PHASES = 7;
const AUCTIONS = 68; // 98 tiles - 6 * 5 dealt

/** Phase bucket for an auction, from tiles left in the bag after its draw. */
export function phaseOf(bagRemaining: number): number {
  const i = Math.max(0, AUCTIONS - 1 - bagRemaining);
  return Math.min(PHASES - 1, Math.floor((i * PHASES) / AUCTIONS));
}

let FIELD: number[][][] | null = null;

/** table[letter][phase] = clearing prices seen in recent real-bot auctions. */
export function fieldTable(file = process.env.FIELD_FILE ?? "data/history.json"): number[][][] {
  if (FIELD) return FIELD;
  const h = JSON.parse(fs.readFileSync(file, "utf8"));
  const t: number[][][] = Array.from({ length: 26 }, () => Array.from({ length: PHASES }, () => []));
  const byMatch = new Map<string, { auctionId: string; letter: string; winner: string | null; paid: number }[]>();
  for (const r of h.results) (byMatch.get(r.matchId) ?? byMatch.set(r.matchId, []).get(r.matchId)!).push(r);
  for (const rs of byMatch.values()) {
    rs.sort((a, b) => Number(BigInt(a.auctionId) - BigInt(b.auctionId)));
    rs.forEach((r, i) => {
      if (r.winner == null || h.bots[r.winner]?.sim) return;
      const ph = Math.min(PHASES - 1, Math.floor((i * PHASES) / AUCTIONS));
      t[letterIndex(r.letter)]![ph]!.push(r.paid);
    });
  }
  return (FIELD = t);
}

export class FieldStrategy implements Strategy {
  readonly name = "field";
  private words: SmartStrategy;
  constructor(
    lex: Lexicon,
    private rng: Rng,
    private scale = 1,
  ) {
    this.words = new SmartStrategy(lex, rng);
  }
  bid(v: BotView, letter: number): number {
    if (v.bagRemaining === 0) return 0;
    const samples = fieldTable()[letter]![phaseOf(v.bagRemaining)]!;
    if (samples.length === 0) return 0;
    const b = samples[Math.floor(this.rng() * samples.length)]! * this.scale;
    return Math.min(v.balance, Math.round(b));
  }
  chooseWords(v: BotView): string[] {
    return this.words.chooseWords(v);
  }
}
