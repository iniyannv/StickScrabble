// Live ScrabbleBot client.
//
// First run:   BOT_NAME=<name> BOT_TOKEN=<token from /team> npm start
// Later runs:  BOT_NAME=<name> npm start        (token saved to .token-<name>)
// Tournament:  BOT_NAME=<name> TOURNAMENT_ID=<id> npm start
// Options:     PARAMS=config/params.json  STDB_HOST=...  STDB_DB=scrabblebot  DRY_RUN=1
import * as fs from "node:fs";
import * as path from "node:path";
import { Identity } from "spacetimedb";
import { DbConnection, type ErrorContext } from "../module_bindings/index.js";
import { Lexicon } from "../engine/lexicon.js";
import { mulberry32 } from "../engine/rng.js";
import { BAG_COUNTS, emptyCounts, letterIndex, countsToString, wordReward, A_CODE } from "../engine/rules.js";
import { SmartStrategy, type SmartParams } from "../strategy/smart.js";
import type { BotView } from "../strategy/types.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";
const BOT_TOKEN = process.env.BOT_TOKEN;
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const DRY_RUN = process.env.DRY_RUN === "1"; // connect + log decisions, but never call game reducers
const TOKEN_PATH = path.join(process.cwd(), `.token-${BOT_NAME}`);
const PARAMS_PATH = process.env.PARAMS ?? path.join(process.cwd(), "config", "params.json");

function log(...a: unknown[]) {
  console.log(new Date().toISOString().slice(11, 23), `[${BOT_NAME}]`, ...a);
}

function loadToken(): string | undefined {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function loadParams(): Partial<SmartParams> {
  try {
    const p = JSON.parse(fs.readFileSync(PARAMS_PATH, "utf8"));
    log(`params from ${PARAMS_PATH}`);
    return p;
  } catch {
    log("no params file; using defaults");
    return {};
  }
}

const lex = Lexicon.load();
const strategy = new SmartStrategy(lex, mulberry32(Date.now() & 0xffffffff), loadParams(), BOT_NAME);
log(`lexicon ready: ${lex.words.length} anagram classes`);

let conn: DbConnection | null = null;
let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
const matchSubs = new Map<bigint, { unsubscribe(): void }>();
const handledAuctions = new Set<bigint>();
let reconnectDelay = 1000;

function fail(what: string) {
  return (err: unknown) => log(`${what} failed: ${err instanceof Error ? err.message : err}`);
}

function runningMatchId(c: DbConnection): bigint | null {
  if (myBotId === null) return null;
  for (const p of c.db.matchParticipant.iter()) {
    if (p.botId !== myBotId) continue;
    if (c.db.matchState.id.find(p.matchId)?.status.tag === "Running") return p.matchId;
  }
  return null;
}

function joinLobby(c: DbConnection) {
  if (myBotId === null || DRY_RUN) return;
  if (runningMatchId(c) !== null) return;
  c.reducers.joinLobby({}).catch(fail("joinLobby"));
}

/** Build our view of a match from the subscribed rows. */
function buildView(c: DbConnection, matchId: bigint): { view: BotView; auctionLetters: number } | null {
  const m = c.db.matchState.id.find(matchId);
  if (!m || myBotId === null) return null;
  const rack = emptyCounts();
  for (const h of c.db.myRack.iter()) if (h.matchId === matchId) rack[letterIndex(h.letter)]! += h.count;
  let me: { balance: number; score: number } | null = null;
  const opponents: BotView["opponents"] = [];
  for (const p of c.db.matchParticipant.iter()) {
    if (p.matchId !== matchId) continue;
    if (p.botId === myBotId) me = { balance: Number(p.balance), score: Number(p.score) };
    else opponents.push({ id: String(p.botId), balance: Number(p.balance), score: Number(p.score) });
  }
  if (!me) return null;
  // unseen = bag - starting rack - auctioned letters, where
  // starting rack = rack + letters we've played - letters we've won.
  const start = rack.slice();
  for (const w of c.db.wordPlay.iter()) {
    if (w.matchId !== matchId || w.botId !== myBotId) continue;
    for (let i = 0; i < w.word.length; i++) start[w.word.charCodeAt(i) - A_CODE]!++;
  }
  for (const r of c.db.auctionResult.iter()) {
    if (r.matchId !== matchId || r.winnerBotId !== myBotId) continue;
    start[letterIndex(r.letter)]!--;
  }
  const unseen = [...BAG_COUNTS];
  for (let i = 0; i < 26; i++) unseen[i]! -= Math.max(0, start[i]!);
  let auctionLetters = 0;
  for (const a of c.db.auction.iter()) {
    if (a.matchId !== matchId) continue;
    unseen[letterIndex(a.letter)]!--;
    auctionLetters++;
  }
  for (let i = 0; i < 26; i++) unseen[i] = Math.max(0, unseen[i]!);
  return {
    view: {
      rack,
      balance: me.balance,
      score: me.score,
      bagRemaining: m.bagTotal,
      unseen,
      numPlayers: opponents.length + 1,
      opponents,
      auctionType: m.auctionType.tag === "FirstPrice" ? "FirstPrice" : "Vickrey",
    },
    auctionLetters,
  };
}

function onAuctionOpen(c: DbConnection, auctionId: bigint, matchId: bigint, letter: string, closesAtMicros: bigint) {
  if (handledAuctions.has(auctionId)) return;
  const t0 = performance.now();
  const built = buildView(c, matchId);
  if (!built) return; // not our match (or not subscribed yet)
  handledAuctions.add(auctionId);
  const v = built.view;

  // 1. Words first: the server applies our reducer calls in order, so the
  //    bid below can spend what these earn.
  const words = strategy.chooseWords(v);
  for (const w of words) {
    const need = emptyCounts();
    for (let i = 0; i < w.length; i++) need[w.charCodeAt(i) - A_CODE]!++;
    if (need.some((n, i) => n > v.rack[i]!)) continue;
    for (let i = 0; i < 26; i++) v.rack[i]! -= need[i]!;
    const r = wordReward(w);
    v.balance += r;
    v.score += r;
    log(`match ${matchId}: play ${w} (+${r})`);
    if (!DRY_RUN) c.reducers.submitWord({ matchId, word: w }).catch(fail(`word ${w}`));
  }

  // 2. Bid.
  const L = letterIndex(letter);
  const amount = Math.max(0, Math.min(Math.floor(strategy.bid(v, L)), v.balance));
  const computeMs = performance.now() - t0;
  const msLeft = Number(closesAtMicros / 1000n) - Date.now();
  log(
    `match ${matchId} r${built.auctionLetters} bag ${v.bagRemaining} '${letter}': bid ${amount} ` +
      `(bal ${v.balance}, score ${v.score}, rack ${countsToString(v.rack)}) ${computeMs.toFixed(0)}ms, ~${msLeft}ms left`,
  );
  if (amount > 0 && !DRY_RUN) {
    const sent = performance.now();
    c.reducers
      .submitBid({ auctionId, amount: BigInt(amount) })
      .then(() => {
        const rtt = performance.now() - sent;
        if (rtt > 400) log(`slow bid ack: ${rtt.toFixed(0)}ms`);
      })
      .catch(fail(`bid on ${auctionId}`));
  }
}

function subscribeMatch(c: DbConnection, matchId: bigint) {
  if (matchSubs.has(matchId)) return;
  const q = (t: string) => `SELECT * FROM ${t} WHERE match_id = ${matchId}`;
  const handle = c
    .subscriptionBuilder()
    .onApplied(() => {
      log(`match ${matchId}: subscribed`);
      for (const a of c.db.auction.iter()) {
        if (a.matchId === matchId && a.status.tag === "Open") onAuctionOpen(c, a.id, a.matchId, a.letter, a.closesAt.microsSinceUnixEpoch);
      }
    })
    .onError((_ctx: ErrorContext) => log(`match ${matchId}: subscription error`))
    .subscribe([
      `SELECT * FROM match_state WHERE id = ${matchId}`,
      q("match_participant"),
      q("auction"),
      q("auction_result"),
      q("word_play"),
    ]);
  matchSubs.set(matchId, handle);
}

function onMatchEnded(c: DbConnection, matchId: bigint) {
  let mine = 0;
  const scores: number[] = [];
  for (const p of c.db.matchParticipant.iter()) {
    if (p.matchId !== matchId) continue;
    scores.push(Number(p.score));
    if (p.botId === myBotId) mine = Number(p.score);
  }
  scores.sort((a, b) => b - a);
  const place = 1 + scores.filter((s) => s > mine).length;
  log(`match ${matchId} ENDED: score ${mine}, place ${place}/${scores.length}, scores [${scores.join(", ")}]`);
  fs.mkdirSync("logs", { recursive: true });
  fs.appendFileSync("logs/results.jsonl", JSON.stringify({ at: new Date().toISOString(), matchId: String(matchId), mine, place, scores }) + "\n");
  // Drop the per-match subscription a little later (rows no longer needed).
  setTimeout(() => {
    matchSubs.get(matchId)?.unsubscribe();
    matchSubs.delete(matchId);
  }, 2000);
  joinLobby(c);
}

function onReady(c: DbConnection) {
  log(`acting as bot ${myBotId}`);
  // Our participations (to discover new matches) + our rack.
  c.subscriptionBuilder()
    .onApplied(() => {
      log("participant subscription applied");
      if (TOURNAMENT_ID && !DRY_RUN) {
        c.reducers
          .registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
          .then(() => log(`registered for tournament ${TOURNAMENT_ID}`))
          .catch(fail(`register for tournament ${TOURNAMENT_ID}`));
      }
      // Resubscribe to any running match (e.g. after a reconnect).
      for (const p of c.db.matchParticipant.iter()) {
        if (p.botId === myBotId) subscribeMatch(c, p.matchId);
      }
      joinLobby(c);
    })
    .subscribe([`SELECT * FROM match_participant WHERE bot_id = ${myBotId}`, "SELECT * FROM my_rack"]);

  c.db.matchParticipant.onInsert((_ctx, p) => {
    if (p.botId === myBotId && !matchSubs.has(p.matchId)) {
      log(`seated in match ${p.matchId}`);
      subscribeMatch(c, p.matchId);
    }
  });
  c.db.auction.onInsert((_ctx, a) => {
    if (a.status.tag === "Open") onAuctionOpen(c, a.id, a.matchId, a.letter, a.closesAt.microsSinceUnixEpoch);
  });
  c.db.matchState.onUpdate((_ctx, old, neu) => {
    if (old.status.tag !== "Ended" && neu.status.tag === "Ended") onMatchEnded(c, neu.id);
  });
  c.db.matchState.onInsert((_ctx, m) => {
    // Subscribed after it already ended (reconnect): nothing to do but rejoin.
    if (m.status.tag === "Ended") {
      matchSubs.get(m.id)?.unsubscribe();
      matchSubs.delete(m.id);
    }
  });

  // Safety net: lobbies can be cancelled, joins can fail. joinLobby is
  // idempotent, so retry while idle.
  setInterval(() => {
    if (conn === c && runningMatchId(c) === null) joinLobby(c);
  }, 15_000);
}

function connect() {
  log(`connecting to ${DB_NAME} at ${HOST}${DRY_RUN ? " (DRY RUN)" : ""}`);
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(BOT_TOKEN ?? loadToken())
    .onConnect((c, identity, token) => {
      conn = c;
      reconnectDelay = 1000;
      myIdentity = identity;
      fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
      log(`connected as ${identity.toHexString().slice(0, 16)}…`);
      c.subscriptionBuilder()
        .onApplied(() => {
          myBotId = c.db.botCredential.identity.find(myIdentity!)?.botId ?? null;
          if (myBotId === null) {
            log("No bot for this token. Generate one at https://scrabblebot.spacetimedb.com/team and pass BOT_TOKEN.");
            process.exit(1);
          }
          onReady(c);
        })
        .subscribe([`SELECT * FROM bot_credential WHERE identity = 0x${identity.toHexString()}`]);
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      log(`connect error: ${err.message}`);
      if (/401|unauthori[sz]ed/i.test(err.message)) {
        log(
          "The server rejected this token. Use the token from 'Generate token' on " +
            "https://scrabblebot.spacetimedb.com/team (a long string starting with 'eyJ'), " +
            "not an identity hex. Delete .token-" + BOT_NAME + " if it holds a bad token.",
        );
        process.exit(1);
      }
      scheduleReconnect();
    })
    .onDisconnect(() => {
      log("disconnected");
      conn = null;
      matchSubs.clear();
      scheduleReconnect();
    })
    .build();
}

let reconnectTimer: NodeJS.Timeout | null = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

connect();
