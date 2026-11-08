// Profile one bot's behaviour from data/bot-<name>.json
import * as fs from "node:fs";
import { LETTER_VALUES, wordReward } from "../src/engine/rules.js";
const file = process.argv[2] ?? "data/bot-LUCENT.json";
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const me = d.bot.id as string;
const by = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => ((m[k(x)] ??= []).push(x), m), {} as Record<string, T[]>);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f = (x: number, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : "-");
const topBid = new Map(d.topBids.map((t: any) => [t.auctionId, t.topBid]));
const parts = by(d.participants, (p: any) => p.matchId);
const res = by(d.results, (r: any) => r.matchId);
const words = by(d.words, (w: any) => w.matchId);
const auctions = by(d.auctions, (a: any) => a.matchId);

// --- outcomes
let place: number[] = [], score: number[] = [], wins = 0, oppReal: number[] = [];
const oppNames: Record<string, number> = {};
for (const m of d.matches) {
  const ps = parts[m.id] ?? [];
  const sorted = [...ps].sort((a: any, b: any) => b.score - a.score);
  const mine = ps.find((p: any) => p.botId === me);
  const pl = sorted.findIndex((p: any) => p.botId === me) + 1;
  place.push(pl); score.push(mine.score); if (pl === 1) wins++;
  let real = 0;
  for (const p of ps) if (p.botId !== me) { const b = d.bots[p.botId] ?? { sim: false, name: p.botId }; if (!b.sim) { real++; oppNames[b.name] = (oppNames[b.name] ?? 0) + 1; } }
  oppReal.push(real);
}
console.log(`matches ${d.matches.length}  avgPlace ${f(mean(place), 2)}  win ${wins}  avgScore ${f(mean(score))}  real opps/match ${f(mean(oppReal), 2)}`);
console.log("auction types", JSON.stringify(by(d.matches, (m: any) => m.auctionType), (k, v) => (Array.isArray(v) ? v.length : v)));
console.log("frequent real opponents", Object.entries(oppNames).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}:${c}`).join(" "));

// --- bidding when it won (its bid = topBid, paid = 2nd)
type Row = { letter: string; bid: number; paid: number; round: number; left: number; won: boolean };
const rows: Row[] = [];
let tilesWon: number[] = [], spent: number[] = [];
for (const m of d.matches) {
  const rs = [...(res[m.id] ?? [])].sort((a: any, b: any) => Number(a.auctionId) - Number(b.auctionId));
  const n = rs.length;
  let tw = 0, sp = 0;
  rs.forEach((r: any, i: number) => {
    if (r.winner === me) { tw++; sp += r.paid; rows.push({ letter: r.letter, bid: topBid.get(r.auctionId) as number, paid: r.paid, round: i, left: n - 1 - i, won: true }); }
  });
  tilesWon.push(tw); spent.push(sp);
}
console.log(`tiles won/match ${f(mean(tilesWon))}  spent/match ${f(mean(spent))}  avg paid/tile ${f(mean(rows.map((r) => r.paid)))}`);
console.log("\nletter  val  nWon  bidMed bidMean bidMin bidMax  paidMean  | lost-to (topBid mean, n)");
const lostTop = by(d.results.filter((r: any) => r.winner && r.winner !== me), (r: any) => r.letter);
for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  const rr = rows.filter((r) => r.letter === L).map((r) => r.bid).sort((a, b) => a - b);
  const lt = (lostTop[L] ?? []).map((r: any) => topBid.get(r.auctionId) as number);
  console.log(`${L}  ${String(LETTER_VALUES[L]).padStart(5)}  ${String(rr.length).padStart(4)}  ${f(rr[rr.length >> 1] ?? NaN).padStart(6)} ${f(mean(rr)).padStart(7)} ${String(rr[0] ?? "-").padStart(6)} ${String(rr.at(-1) ?? "-").padStart(6)}  ${f(mean(rows.filter((r) => r.letter === L).map((r) => r.paid))).padStart(8)}  | ${f(mean(lt))} (${lt.length})`);
}
// bids by phase
console.log("\nphase(left)   nWon  bidMean  paidMean");
for (const [lo, hi] of [[60, 99], [40, 59], [20, 39], [10, 19], [5, 9], [1, 4], [0, 0]]) {
  const rr = rows.filter((r) => r.left >= lo && r.left <= hi);
  console.log(`${lo}-${hi}`.padEnd(12), String(rr.length).padStart(5), f(mean(rr.map((r) => r.bid))).padStart(8), f(mean(rr.map((r) => r.paid))).padStart(8));
}
// bid distribution overall (values)
const hist: Record<number, number> = {};
for (const r of rows) hist[r.bid] = (hist[r.bid] ?? 0) + 1;
console.log("\nwinning-bid histogram", Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(" "));

// --- words
const myWords = d.words.filter((w: any) => w.botId === me);
const lenH: Record<number, number> = {};
for (const w of myWords) lenH[w.word.length] = (lenH[w.word.length] ?? 0) + 1;
console.log(`\nwords/match ${f(myWords.length / d.matches.length)}  avg reward ${f(mean(myWords.map((w: any) => w.reward)))}  length hist ${Object.entries(lenH).map(([k, v]) => `${k}:${v}`).join(" ")}`);
// timing: when in the match words are played (rounds left at play time)
const timing: Record<string, number> = {};
const perMatchDetail: string[] = [];
for (const m of d.matches.slice(0, 50)) {
  const as = [...(auctions[m.id] ?? [])].sort((a: any, b: any) => a.opensAt - b.opensAt);
  const rs = [...(res[m.id] ?? [])].sort((a: any, b: any) => Number(a.auctionId) - Number(b.auctionId));
  const n = as.length;
  const ws = (words[m.id] ?? []).filter((w: any) => w.botId === me).sort((a: any, b: any) => a.at - b.at);
  const mine = parts[m.id].find((p: any) => p.botId === me);
  const sorted = [...parts[m.id]].sort((a: any, b: any) => b.score - a.score);
  const desc: string[] = [];
  let wi = 0;
  const won: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = rs[i];
    while (wi < ws.length && ws[wi].at < as[i].closesAt) {
      const left = n - i;
      const bucket = left > 40 ? ">40" : left > 20 ? "21-40" : left > 8 ? "9-20" : left > 2 ? "3-8" : "1-2";
      timing[bucket] = (timing[bucket] ?? 0) + 1;
      desc.push(`[${left}]${ws[wi].word}(${ws[wi].reward})`);
      wi++;
    }
    if (r?.winner === me) { won.push(r.letter); desc.push(`+${r.letter}${topBid.get(r.auctionId)}/${r.paid}`); }
  }
  while (wi < ws.length) { desc.push(`[end]${ws[wi].word}(${ws[wi].reward})`); timing["after"] = (timing["after"] ?? 0) + 1; wi++; }
  const pl = sorted.findIndex((p: any) => p.botId === me) + 1;
  perMatchDetail.push(`#${m.id} place ${pl} score ${mine.score} bal ${mine.balance} won ${won.length}: ${desc.join(" ")}`);
}
console.log("word timing (rounds left when played)", JSON.stringify(timing));
fs.writeFileSync(file.replace(".json", "-timeline.txt"), perMatchDetail.join("\n\n"));
console.log("end balance mean", f(mean(d.matches.map((m: any) => parts[m.id].find((p: any) => p.botId === me).balance))));
