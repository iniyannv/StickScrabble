// Reconstruct LUCENT's rack over time and test when it plays words.
import * as fs from "node:fs";
import { Lexicon } from "../src/engine/lexicon.js";
const d = JSON.parse(fs.readFileSync(process.argv[2] ?? "data/bot-LUCENT.json", "utf8"));
const me = d.bot.id;
import { countsFromString } from "../src/engine/rules.js";
const lex = Lexicon.load();
const topBid = new Map(d.topBids.map((t: any) => [t.auctionId, t.topBid]));
const leftHist: Record<number, number> = {};
const firstPlayLeft: number[] = [];
const rows: string[] = [];
let bingoAvailEarlier = 0, bingoChecks = 0, lenAtPlay: Record<string, number> = {};
const lateBids: string[] = [];
for (const m of d.matches) {
  const as = d.auctions.filter((a: any) => a.matchId === m.id).sort((a: any, b: any) => a.opensAt - b.opensAt);
  const rs = new Map(d.results.filter((r: any) => r.matchId === m.id).map((r: any) => [r.auctionId, r]));
  const ws = d.words.filter((w: any) => w.matchId === m.id && w.botId === me).sort((a: any, b: any) => a.at - b.at);
  if (!ws.length) continue;
  // starting tiles (lower bound) = used letters - won letters
  const cnt = (s: string) => { const c: Record<string, number> = {}; for (const ch of s) c[ch] = (c[ch] ?? 0) + 1; return c; };
  const used = cnt(ws.map((w: any) => w.word).join(""));
  const won = cnt(as.map((a: any) => rs.get(a.id)).filter((r: any) => r?.winner === me).map((r: any) => r.letter).join(""));
  let start = "";
  for (const [ch, n] of Object.entries(used)) start += ch.repeat(Math.max(0, n - (won[ch] ?? 0)));
  let rack = start; // known part of rack
  let bal = 100, wi = 0, firstSeen = -1;
  const n = as.length;
  for (let i = 0; i < n; i++) {
    const left = n - i;
    // words played during this auction window (before close)
    while (wi < ws.length && ws[wi].at < as[i].closesAt) {
      const w = ws[wi];
      leftHist[left] = (leftHist[left] ?? 0) + 1;
      if (wi === 0) firstPlayLeft.push(left);
      lenAtPlay[`${w.word.length}`] = (lenAtPlay[`${w.word.length}`] ?? 0) + 1;
      if (lex && wi === 0) {
        bingoChecks++;
        if (firstSeen >= 0 && firstSeen > left) bingoAvailEarlier++;
      }
      for (const ch of w.word) rack = rack.replace(ch, "");
      bal += w.reward;
      rows.push(`#${m.id} left=${left} bal=${bal} rack(after)=${rack} played ${w.word}(${w.reward}) firstBingoAvailAt=${firstSeen}`);
      wi++;
    }
    const r: any = rs.get(as[i].id);
    if (r?.winner === me) {
      bal -= r.paid; rack += r.letter;
      if (left <= 8) lateBids.push(`#${m.id} left=${left - 1} ${r.letter} bid ${topBid.get(r.id ?? r.auctionId)} paid ${r.paid} balAfter ${bal}`);
      if (lex && firstSeen < 0 && wi === 0) {
        const has7 = lex.playable(countsFromString(rack), 7).length > 0;
        if (has7) firstSeen = left - 1;
      }
    }
  }
}
console.log("rounds-left at play:", Object.entries(leftHist).sort((a, b) => +b[0] - +a[0]).map(([k, v]) => `${k}:${v}`).join(" "));
console.log("first play rounds-left:", firstPlayLeft.sort((a, b) => b - a).join(" "));
console.log(`first word: 7+ available before it played in ${bingoAvailEarlier}/${bingoChecks}`);
fs.writeFileSync("data/lucent-plays.txt", rows.join("\n") + "\n\nLATE WINS\n" + lateBids.join("\n"));
