// npm run sim -- --matches 500 --opp sim,sim,sim,sim,sim --us '{"aggr":1.2}'
import { runBatch } from "./runner.js";

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const presets: Record<string, string> = {
  sims: "sim,sim,sim,sim,sim",
  starter: "starter,starter,starter,starter,starter",
  self: "base,base,base,base,base",
  mix: "sim,sim,starter,base,base",
  live: "sim,sim,sim,hist,hist",
  live2: "sim,sim,sim,base,base",
};
const oppArg = get("opp", "sims");
const t = performance.now();
const summary = await runBatch(
  {
    matches: Number(get("matches", "200")),
    seed: Number(get("seed", "1")),
    opponents: (presets[oppArg] ?? oppArg).split(","),
    us: JSON.parse(get("us", "{}")),
    base: JSON.parse(get("base", "{}")),
    auctionType: args.includes("--fp") ? "FirstPrice" : "Vickrey",
  },
  Number(get("workers", "0")) || undefined,
);
console.log(JSON.stringify(summary, null, 2));
console.log(`(${((performance.now() - t) / 1000).toFixed(1)}s)`);
