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
