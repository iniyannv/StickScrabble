// Run many matches (optionally across worker processes) and summarise.
import { spawn } from "node:child_process";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { Lexicon } from "../engine/lexicon.js";
import { mulberry32 } from "../engine/rng.js";
import { StarterStrategy } from "../strategy/baselines.js";
import { FieldStrategy, HistStrategy } from "../strategy/hist.js";
import { SmartStrategy, type SmartParams } from "../strategy/smart.js";
import { SIM_POOL, runMatch, type Seat } from "./engine.js";

/**
 * Lineup spec: seat 0 is always "us" (SmartStrategy with `us` params).
 * Opponent tokens: "sim" (random sim from the pool, no repeats), "starter",
 * "base" (SmartStrategy with `base` params).
 */
export interface BatchSpec {
  matches: number;
  seed: number;
  opponents: string[]; // e.g. ["sim","sim","starter","base","base"]
  us: Partial<SmartParams>;
  base?: Partial<SmartParams>;
  auctionType?: "Vickrey" | "FirstPrice";
  fieldScale?: number; // bid multiplier for "field" opponents
}

export interface Summary {
  matches: number;
  avgScore: number;
  avgPlace: number;
  winRate: number;
  avgOppScore: number;
  avgBestOpp: number;
  avgTiles: number;
  avgEarlyTiles: number;
  freezeRate: number; // share of matches with <= 2 tiles won in the first 30 auctions
  low60: number; // share of matches scoring under 60
  avgSpent: number;
  avgLeftover: number;
  avgEndBalance: number;
  rejected: number;
  byOpponent: Record<string, { n: number; avgScore: number }>;
}

let LEX: Lexicon | null = null;
function lex() {
  return (LEX ??= Lexicon.load());
}

interface RawStats {
  n: number; score: number; place: number; wins: number; opp: number; bestOpp: number;
  tiles: number; early: number; freeze: number; low: number; spent: number; leftover: number; endBal: number; rejected: number;
  byOpp: Record<string, { n: number; score: number }>;
}

export function runBatchLocal(spec: BatchSpec): RawStats {
  const L = lex();
  const rng = mulberry32(spec.seed);
  const st: RawStats = { n: 0, score: 0, place: 0, wins: 0, opp: 0, bestOpp: 0, tiles: 0, early: 0, freeze: 0, low: 0, spent: 0, leftover: 0, endBal: 0, rejected: 0, byOpp: {} };
  const us = new SmartStrategy(L, mulberry32(spec.seed ^ 0x9e3779b9), spec.us, "us");
  for (let m = 0; m < spec.matches; m++) {
    const pool = [...SIM_POOL].sort(() => rng() - 0.5);
    const seats: Seat[] = [{ kind: "bot", strategy: us }];
    let bi = 0;
    for (const tok of spec.opponents) {
      if (tok === "sim") seats.push({ kind: "sim", ...pool.pop()! });
      else if (tok === "starter") seats.push({ kind: "bot", strategy: new StarterStrategy(L) });
      else if (tok === "hist") seats.push({ kind: "bot", strategy: new HistStrategy(L, mulberry32(spec.seed * 17 + m * 5 + bi++)) });
      else if (tok.startsWith("field")) seats.push({ kind: "bot", strategy: new FieldStrategy(L, mulberry32(spec.seed * 13 + m * 3 + bi++), spec.fieldScale ?? 1) });
      else if (tok === "base") seats.push({ kind: "bot", strategy: new SmartStrategy(L, mulberry32(spec.seed * 31 + m * 7 + bi++), spec.base ?? {}, "base") });
      else throw new Error(`unknown opponent ${tok}`);
    }
    // random seat order (deal order matters slightly)
    const order = seats.map((_, i) => i).sort(() => rng() - 0.5);
    const shuffled = order.map((i) => seats[i]!);
    const r = runMatch(L, shuffled, rng, spec.auctionType ?? "Vickrey");
    const me = order.indexOf(0);
    const my = r.scores[me]!;
    const others = r.scores.filter((_, i) => i !== me);
    st.n++;
    st.score += my;
    st.place += 1 + others.filter((s) => s > my).length;
    if (others.every((s) => s <= my)) st.wins++;
    st.opp += others.reduce((a, b) => a + b, 0) / others.length;
    st.bestOpp += Math.max(...others);
    st.tiles += r.tilesWon[me]!;
    st.early += r.earlyTiles[me]!;
    if (r.earlyTiles[me]! <= 2) st.freeze++;
    if (my < 60) st.low++;
    st.spent += r.spent[me]!;
    st.leftover += r.leftover[me]!;
    st.endBal += r.balances[me]!;
    st.rejected += r.rejectedWords;
    r.names.forEach((name, i) => {
      if (i === me) return;
      const key = name.endsWith("-sim") ? name : name;
      const b = (st.byOpp[key] ??= { n: 0, score: 0 });
      b.n++;
      b.score += r.scores[i]!;
    });
  }
  return st;
}

function summarise(st: RawStats): Summary {
  const n = Math.max(1, st.n);
  const byOpponent: Summary["byOpponent"] = {};
  for (const [k, v] of Object.entries(st.byOpp)) byOpponent[k] = { n: v.n, avgScore: +(v.score / v.n).toFixed(1) };
  return {
    matches: st.n,
    avgScore: +(st.score / n).toFixed(2),
    avgPlace: +(st.place / n).toFixed(3),
    winRate: +(st.wins / n).toFixed(3),
    avgOppScore: +(st.opp / n).toFixed(2),
    avgBestOpp: +(st.bestOpp / n).toFixed(2),
    avgTiles: +(st.tiles / n).toFixed(1),
    avgEarlyTiles: +(st.early / n).toFixed(2),
    freezeRate: +(st.freeze / n).toFixed(3),
    low60: +(st.low / n).toFixed(3),
    avgSpent: +(st.spent / n).toFixed(1),
    avgLeftover: +(st.leftover / n).toFixed(2),
    avgEndBalance: +(st.endBal / n).toFixed(1),
    rejected: st.rejected,
    byOpponent,
  };
}

function merge(a: RawStats, b: RawStats): RawStats {
  const out = { ...a, byOpp: { ...a.byOpp } };
  for (const k of ["n", "score", "place", "wins", "opp", "bestOpp", "tiles", "early", "freeze", "low", "spent", "leftover", "endBal", "rejected"] as const) out[k] = a[k] + b[k];
  for (const [k, v] of Object.entries(b.byOpp)) {
    const o = (out.byOpp[k] ??= { n: 0, score: 0 });
    out.byOpp[k] = { n: o.n + v.n, score: o.score + v.score };
  }
  return out;
}

export async function runBatch(spec: BatchSpec, workers = Math.max(1, os.cpus().length - 1)): Promise<Summary> {
  if (workers <= 1 || spec.matches < workers * 2) return summarise(runBatchLocal(spec));
  const per = Math.ceil(spec.matches / workers);
  const self = fileURLToPath(new URL("./worker.ts", import.meta.url));
  const jobs: Promise<RawStats>[] = [];
  for (let w = 0; w < workers; w++) {
    const n = Math.min(per, spec.matches - w * per);
    if (n <= 0) break;
    const sub: BatchSpec = { ...spec, matches: n, seed: spec.seed * 1000 + w };
    jobs.push(
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", self, JSON.stringify(sub)], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}`))));
      }),
    );
  }
  const parts = await Promise.all(jobs);
  return summarise(parts.reduce(merge));
}
