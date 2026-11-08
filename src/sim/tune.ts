// Sweep one or more params: npm run tune -- --param aggr --values 0.8,1,1.2 --opp self --matches 400
// Or coordinate descent across a grid: --grid '{"aggr":[0.8,1,1.2],"playLen":[6,7,8]}' --rounds 2
import { runBatch, type Summary } from "./runner.js";
import { DEFAULT_SMART, type SmartParams } from "../strategy/smart.js";

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const presets: Record<string, string> = {
  sims: "sim,sim,sim,sim,sim",
  self: "base,base,base,base,base",
  mix: "sim,starter,base,base,base",
  live: "sim,sim,sim,hist,hist",
  live2: "sim,sim,sim,base,base",
  field: "field,field,field,field,field",
  today: "field,field,field,base,base",
};
const opp = (presets[get("opp", "self")] ?? get("opp", "self")).split(",");
const matches = Number(get("matches", "400"));
const seed = Number(get("seed", "7"));
let current: Partial<SmartParams> = JSON.parse(get("start", "{}"));
const baseFixed = args.includes("--base") ? JSON.parse(get("base", "{}")) : null;

async function evalParams(us: Partial<SmartParams>, base: Partial<SmartParams>): Promise<Summary> {
  return runBatch({ matches, seed, opponents: opp, us, base, auctionType: args.includes("--fp") ? "FirstPrice" : "Vickrey", fieldScale: Number(get("field-scale", "1")) });
}

function line(label: string, s: Summary) {
  console.log(
    `${label.padEnd(28)} place ${s.avgPlace.toFixed(3)}  win ${(s.winRate * 100).toFixed(1)}%  score ${s.avgScore.toFixed(1)}  opp ${s.avgOppScore.toFixed(1)}  tiles ${s.avgTiles}  early ${s.avgEarlyTiles}  freeze ${(s.freezeRate * 100).toFixed(0)}%  low60 ${(s.low60 * 100).toFixed(0)}%  spent ${s.avgSpent}  endBal ${s.avgEndBalance}  left ${s.avgLeftover}`,
  );
}

const grid: Record<string, number[]> = args.includes("--grid")
  ? JSON.parse(get("grid", "{}"))
  : { [get("param", "aggr")]: get("values", "1").split(",").map(Number) };
const rounds = Number(get("rounds", "1"));

for (let r = 0; r < rounds; r++) {
  for (const [k, values] of Object.entries(grid)) {
    let best: { v: number; s: Summary } | null = null;
    const cur = (current as Record<string, number>)[k] ?? (DEFAULT_SMART as unknown as Record<string, number>)[k];
    const candidates = cur !== undefined && !values.includes(cur) && !baseFixed ? [cur, ...values] : values;
    for (const v of candidates) {
      const us = { ...current, [k]: v };
      const s = await evalParams(us, baseFixed ?? current);
      line(`${k}=${v}`, s);
      if (!best || s.avgPlace < best.s.avgPlace) best = { v, s };
    }
    current = { ...current, [k]: best!.v };
    console.log(`-> ${k}=${best!.v}   current ${JSON.stringify(current)}`);
  }
}
console.log("FINAL", JSON.stringify({ ...DEFAULT_SMART, ...current }));
