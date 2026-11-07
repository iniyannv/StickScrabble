import { Lexicon } from "../src/engine/lexicon.js";
import { mulberry32 } from "../src/engine/rng.js";
import { SmartStrategy } from "../src/strategy/smart.js";
import { runMatch, type Seat } from "../src/sim/engine.js";
const lex = Lexicon.load();
const params = JSON.parse(process.argv[2] ?? "{}");
const orig = lex.bestPartition.bind(lex);
let calls = 0, ms = 0; const sizes = new Map<number, number>();
lex.bestPartition = (r, w) => { calls++; const n = r.reduce((a, b) => a + b, 0); sizes.set(n, (sizes.get(n) ?? 0) + 1); const t = performance.now(); const x = orig(r, w); ms += performance.now() - t; return x; };
const t = performance.now();
for (let m = 0; m < 4; m++) {
  const seats: Seat[] = Array.from({ length: 6 }, (_, i) => ({ kind: "bot", strategy: new SmartStrategy(lex, mulberry32(m * 10 + i), params) }));
  const r = runMatch(lex, seats, mulberry32(m));
  console.log(r.scores.join(" "), "rounds", r.rounds);
}
console.log(`per match ${((performance.now() - t) / 4).toFixed(0)}ms, partition calls ${calls / 4}, partition ms ${(ms / 4).toFixed(0)}`);
console.log([...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" "));
