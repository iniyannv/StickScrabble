// Pull recent ended matches (public data) for opponent modelling.
// npm run fetch-history -- --matches 300
import * as fs from "node:fs";
import { DbConnection } from "../src/module_bindings/index.js";

const args = process.argv.slice(2);
const N = Number(args[args.indexOf("--matches") + 1] ?? 300) || 300;
const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";

function done(c: DbConnection) {
  const ended = [...c.db.matchState.iter()].filter((m) => m.status.tag === "Ended").sort((a, b) => Number(b.id - a.id));
  const ids = new Set(ended.slice(0, N).map((m) => m.id));
  const minId = ended.length ? ended[Math.min(N, ended.length) - 1]!.id : 0n;
  console.error(`ended matches: ${ended.length}; fetching ${ids.size} (id >= ${minId})`);
  const t = Date.now();
  c.subscriptionBuilder()
    .onApplied(() => {
      console.error(`subscribed in ${Date.now() - t}ms`);
      const bots = Object.fromEntries([...c.db.bot.iter()].map((b) => [String(b.id), { name: b.name, sim: b.isSimulated }]));
      const pick = <T extends { matchId: bigint }>(rows: Iterable<T>) => [...rows].filter((r) => ids.has(r.matchId));
      const out = {
        fetchedAt: new Date().toISOString(),
        bots,
        matches: ended.filter((m) => ids.has(m.id)).map((m) => ({ id: String(m.id), auctionType: m.auctionType.tag, rounds: m.currentRound })),
        participants: pick(c.db.matchParticipant.iter()).map((p) => ({ matchId: String(p.matchId), botId: String(p.botId), score: Number(p.score), balance: Number(p.balance) })),
        results: pick(c.db.auctionResult.iter()).map((r) => ({ matchId: String(r.matchId), auctionId: String(r.auctionId), letter: r.letter, winner: r.winnerBotId == null ? null : String(r.winnerBotId), paid: Number(r.paid) })),
        topBids: pick(c.db.auctionTopBidArchive.iter()).map((r) => ({ auctionId: String(r.auctionId), topBid: Number(r.topBid) })),
        words: pick(c.db.wordPlay.iter()).map((w) => ({ matchId: String(w.matchId), botId: String(w.botId), word: w.word, reward: Number(w.totalReward), at: Number(w.playedAt.microsSinceUnixEpoch / 1000n) })),
      };
      fs.mkdirSync("data", { recursive: true });
      fs.writeFileSync("data/history.json", JSON.stringify(out));
      console.error(`wrote data/history.json: ${out.participants.length} participants, ${out.results.length} auctions, ${out.words.length} words`);
      process.exit(0);
    })
    .onError((_ctx) => {
      console.error("subscription error");
      process.exit(1);
    })
    .subscribe([
      "SELECT * FROM bot",
      `SELECT * FROM match_participant WHERE match_id >= ${minId}`,
      `SELECT * FROM auction_result WHERE match_id >= ${minId}`,
      `SELECT * FROM auction_top_bid_archive WHERE match_id >= ${minId}`,
      `SELECT * FROM word_play WHERE match_id >= ${minId}`,
    ]);
}

DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(process.env.STDB_DB ?? "scrabblebot")
  .onConnect((c) => {
    c.subscriptionBuilder()
      .onApplied(() => done(c))
      .onError(() => {
        console.error("match_state subscription error");
        process.exit(1);
      })
      .subscribe(["SELECT * FROM match_state"]);
  })
  .onConnectError((_c, e) => {
    console.error("connect error", e.message);
    process.exit(1);
  })
  .build();
