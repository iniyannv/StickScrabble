// Decision-latency benchmark for the live bot: npm run bench [-- params.json]
import * as fs from "node:fs";
import { Lexicon } from "../src/engine/lexicon.js";
import { mulberry32 } from "../src/engine/rng.js";
import { BAG_COUNTS, emptyCounts } from "../src/engine/rules.js";
import { SmartStrategy } from "../src/strategy/smart.js";
import type { BotView } from "../src/strategy/types.js";

const t0 = performance.now();
const lex = Lexicon.load();
console.log(`lexicon load ${(performance.now() - t0).toFixed(0)}ms`);
const file = process.argv[2] ?? "config/params.json";
const params = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const rng = mulberry32(42);
const bag: number[] = [];
BAG_COUNTS.forEach((n, i) => { for (let k = 0; k < n; k++) bag.push(i); });

for (const size of [5, 8, 11, 14, 17, 20]) {
  const times: number[] = [];
  for (let t = 0; t < 30; t++) {
    const s = new SmartStrategy(lex, rng, params);
    const b = bag.slice(); const rack = emptyCounts();
    for (let k = 0; k < size; k++) { const j = Math.floor(rng() * b.length); rack[b[j]!]!++; b.splice(j, 1); }
    const unseen = emptyCounts(); for (const l of b) unseen[l]!++;
    const v: BotView = { rack, balance: 60, score: 0, bagRemaining: 40, unseen, numPlayers: 6, opponents: [] };
    const st = performance.now();
    const words = s.chooseWords(v);
    s.bid(v, b[0]!);
    times.push(performance.now() - st);
    void words;
  }
  times.sort((a, b) => a - b);
  console.log(`rack ${String(size).padStart(2)}: decision median ${times[15]!.toFixed(1)}ms  p90 ${times[27]!.toFixed(1)}ms  max ${times[29]!.toFixed(1)}ms`);
}
