// Pull one bot's most recent ended matches (current version only) with full public detail.
// npx tsx scripts/fetch-bot.ts --bot LUCENT --matches 50 [--out data/bot-LUCENT.json] [--all-versions]
import * as fs from "node:fs";
import { DbConnection } from "../src/module_bindings/index.js";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const BOT = arg("--bot", "LUCENT")!;
const N = Number(arg("--matches", "50"));
const allVersions = args.includes("--all-versions");
const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const us = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

function sub(c: DbConnection, qs: string[]): Promise<void> {
  return new Promise((res, rej) => c.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error("sub error: " + qs[0]))).subscribe(qs));
}

async function run(c: DbConnection) {
  await sub(c, ["SELECT * FROM bot", "SELECT * FROM bot_version"]);
  const bots = [...c.db.bot.iter()];
  const bot = bots.find((b) => String(b.id) === BOT || b.name.toLowerCase() === BOT.toLowerCase());
  if (!bot) throw new Error("bot not found: " + BOT);
  const versions = [...c.db.botVersion.iter()].filter((v) => v.botId === bot.id).sort((a, b) => a.version - b.version);
  const cur = versions.at(-1);
  console.error(`bot ${bot.name} id=${bot.id} versions=${versions.map((v) => `v${v.version}@${new Date(us(v.startedAt)).toISOString()}`).join(", ")}`);

  await sub(c, [`SELECT * FROM match_participant WHERE bot_id = ${bot.id}`, `SELECT * FROM rating_history WHERE bot_id = ${bot.id}`]);
  const mine = [...c.db.matchParticipant.iter()].filter((p) => p.botId === bot.id).map((p) => p.matchId);
  const ids = [...new Set(mine)].sort((a, b) => Number(b - a));
  await sub(c, ids.slice(0, N * 3).map((id) => `SELECT * FROM match_state WHERE id = ${id}`));
  const startMs = cur && !allVersions ? us(cur.startedAt) : 0;
  const ratingMatches = new Set([...c.db.ratingHistory.iter()].filter((r) => r.botId === bot.id && us(r.at) >= startMs).map((r) => r.matchId));
  const ended = ids.filter((id) => {
    const m = c.db.matchState.id.find(id);
    return m && m.status.tag === "Ended" && (allVersions || ratingMatches.has(id));
  }).slice(0, N);
  console.error(`matches total=${ids.length}, current-version ended picked=${ended.length}`);

  const qs: string[] = [];
  for (const id of ended)
    for (const t of ["match_participant", "auction_result", "auction_top_bid_archive", "word_play", "auction", "rating_history"])
      qs.push(`SELECT * FROM ${t} WHERE match_id = ${id}`);
  for (let i = 0; i < qs.length; i += 60) await sub(c, qs.slice(i, i + 60));

  const set = new Set(ended.map(String));
  const keep = <T extends { matchId: bigint }>(rows: Iterable<T>) => [...rows].filter((r) => set.has(String(r.matchId)));
  const out = {
    fetchedAt: new Date().toISOString(),
    bot: { id: String(bot.id), name: bot.name, version: cur?.version ?? null },
    bots: Object.fromEntries(bots.map((b) => [String(b.id), { name: b.name, sim: b.isSimulated, strategy: b.strategy?.tag ?? null }])),
    matches: ended.map((id) => {
      const m = c.db.matchState.id.find(id)!;
      return { id: String(id), auctionType: m.auctionType.tag, rounds: m.currentRound };
    }),
    participants: keep(c.db.matchParticipant.iter()).map((p) => ({ matchId: String(p.matchId), botId: String(p.botId), score: Number(p.score), balance: Number(p.balance) })),
    auctions: keep(c.db.auction.iter()).map((a) => ({ id: String(a.id), matchId: String(a.matchId), letter: a.letter, opensAt: us(a.opensAt), closesAt: us(a.closesAt) })),
    results: keep(c.db.auctionResult.iter()).map((r) => ({ matchId: String(r.matchId), auctionId: String(r.auctionId), letter: r.letter, winner: r.winnerBotId == null ? null : String(r.winnerBotId), paid: Number(r.paid), closedAt: us(r.closedAt) })),
    topBids: keep(c.db.auctionTopBidArchive.iter()).map((r) => ({ auctionId: String(r.auctionId), topBid: Number(r.topBid) })),
    words: keep(c.db.wordPlay.iter()).map((w) => ({ matchId: String(w.matchId), botId: String(w.botId), word: w.word, reward: Number(w.totalReward), at: us(w.playedAt) })),
    ratings: keep(c.db.ratingHistory.iter()).map((r) => ({ matchId: String(r.matchId), botId: String(r.botId), mu: r.openskillMu, sigma: r.openskillSigma })),
  };
  const file = arg("--out", `data/bot-${bot.name}.json`)!;
  fs.writeFileSync(file, JSON.stringify(out));
  console.error(`wrote ${file}: ${out.matches.length} matches, ${out.results.length} auctions, ${out.words.length} words`);
}

DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(process.env.STDB_DB ?? "scrabblebot")
  .onConnect((c) => run(c).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); }))
  .onConnectError((_c, e) => { console.error("connect error", e.message); process.exit(1); })
  .build();
