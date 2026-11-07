import * as fs from "node:fs";
const h = JSON.parse(fs.readFileSync("data/history.json", "utf8"));
const bots: Record<string, { name: string; sim: boolean }> = h.bots;
const top = new Map<string, number>(); for (const r of h.topBids) top.set(r.auctionId, r.topBid);
const byMatch = new Map<string, any[]>();
for (const p of h.participants) (byMatch.get(p.matchId) ?? byMatch.set(p.matchId, []).get(p.matchId)!).push(p);
let realCounts: Record<number, number> = {};
const scoreByName = new Map<string, number[]>();
const placeByName = new Map<string, number[]>();
for (const [, ps] of byMatch) {
  const real = ps.filter((p) => !bots[p.botId]?.sim).length;
  realCounts[real] = (realCounts[real] ?? 0) + 1;
  for (const p of ps) {
    const n = bots[p.botId]?.name ?? p.botId;
    (scoreByName.get(n) ?? scoreByName.set(n, []).get(n)!).push(p.score);
    (placeByName.get(n) ?? placeByName.set(n, []).get(n)!).push(1 + ps.filter((o) => o.score > p.score).length);
  }
}
console.log("real bots per match:", realCounts);
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const rows = [...scoreByName.entries()].filter(([, s]) => s.length >= 15).map(([n, s]) => [n, s.length, avg(s), avg(placeByName.get(n)!)] as const).sort((a, b) => a[3] - b[3]);
console.log("bot (n, avgScore, avgPlace) top 15:"); for (const r of rows.slice(0, 15)) console.log(`  ${String(r[0]).padEnd(20)} ${r[1]} ${r[2].toFixed(1)} ${r[3].toFixed(2)}`);
// per-letter prices
const per: Record<string, { paid: number[]; top: number[]; nobid: number }> = {};
for (const r of h.results) {
  const e = (per[r.letter] ??= { paid: [], top: [], nobid: 0 });
  if (r.winner == null) { e.nobid++; continue; }
  e.paid.push(r.paid); const t = top.get(r.auctionId); if (t !== undefined) e.top.push(t);
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
console.log("letter: n  paid(avg/med)  topBid(avg/med/p90) nobid");
for (const l of Object.keys(per).sort()) {
  const e = per[l]!; const st = [...e.top].sort((a, b) => a - b);
  console.log(`  ${l} ${String(e.paid.length).padStart(5)}  ${avg(e.paid).toFixed(1).padStart(5)}/${med(e.paid)}   ${avg(e.top).toFixed(1).padStart(5)}/${med(e.top)}/${st[Math.floor(st.length * 0.9)]}  ${e.nobid}`);
}
// paid vs round
const roundsPaid: number[][] = Array.from({ length: 7 }, () => []);
const idx = new Map<string, number>();
for (const r of h.results) { const k = r.matchId; const i = idx.get(k) ?? 0; idx.set(k, i + 1); if (r.winner != null) roundsPaid[Math.min(6, Math.floor(i / 10))]!.push(r.paid); }
console.log("avg paid by round decile:", roundsPaid.map((a) => avg(a).toFixed(1)).join(" "));
// word length distribution for top-5 bots and timing
const topNames = new Set(rows.slice(0, 8).map((r) => r[0]));
const lens: Record<number, number> = {}; let wc = 0;
for (const w of h.words) { const n = bots[w.botId]?.name; if (!topNames.has(n!)) continue; lens[w.word.length] = (lens[w.word.length] ?? 0) + 1; wc++; }
console.log("top-bot word lengths:", lens, "words per match-bot:", (wc / rows.slice(0, 8).reduce((a, r) => a + r[1], 0)).toFixed(1));
const sample = h.words.filter((w: any) => topNames.has(bots[w.botId]?.name)).slice(0, 25).map((w: any) => `${bots[w.botId]!.name}:${w.word}(${w.reward})`);
console.log(sample.join(" "));
