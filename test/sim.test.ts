import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../src/engine/lexicon.js";
import { mulberry32 } from "../src/engine/rng.js";
import { BAG_SIZE, STARTING_BALANCE, letterIndex } from "../src/engine/rules.js";
import { runMatch, simBid } from "../src/sim/engine.js";
import type { BotView, Strategy } from "../src/strategy/types.js";
import { SmartStrategy } from "../src/strategy/smart.js";

const lex = Lexicon.load();

class Fixed implements Strategy {
  views: BotView[] = [];
  constructor(readonly name: string, private amount: number, private words = false) {}
  bid(v: BotView) { this.views.push(v); return Math.min(this.amount, v.balance); }
  chooseWords(v: BotView) { return this.words ? lex.bestPartition(v.rack).words.map((w) => w.word) : []; }
}

test("sim bot bids mirror the server's decideBid", () => {
  assert.equal(simBid("Cheapskate", letterIndex("A"), 100, 0), 1); // max(0,1)
  assert.equal(simBid("ValueBidder", letterIndex("Z"), 100, 2), 12);
  assert.equal(simBid("Aggressive", letterIndex("E"), 100, -2), 3);
  assert.equal(simBid("Aggressive", letterIndex("Q"), 5, 0), 5); // capped by balance
});

test("no-bid tiles are discarded; match has 98 - dealt rounds", () => {
  const a = new Fixed("a", 0), b = new Fixed("b", 0);
  const r = runMatch(lex, [{ kind: "bot", strategy: a }, { kind: "bot", strategy: b }], mulberry32(1));
  assert.equal(r.rounds, BAG_SIZE - 10);
  assert.deepEqual(r.balances, [STARTING_BALANCE, STARTING_BALANCE]);
});

test("vickrey: winner pays second price; sole bidder pays 1", () => {
  const a = new Fixed("a", 5), b = new Fixed("b", 3);
  const r = runMatch(lex, [{ kind: "bot", strategy: a }, { kind: "bot", strategy: b }], mulberry32(2));
  // a wins at price 3 until its balance runs low; it always pays 3.
  assert.ok(r.tilesWon[0]! > 20);
  assert.equal(r.spent[0], 3 * r.tilesWon[0]!);
  const solo = runMatch(lex, [{ kind: "bot", strategy: new Fixed("s", 2) }, { kind: "bot", strategy: new Fixed("z", 0) }], mulberry32(3));
  assert.equal(solo.spent[0], solo.tilesWon[0]);
});

test("bagRemaining counts down to 0 on the final auction", () => {
  const a = new Fixed("a", 0), b = new Fixed("b", 0);
  runMatch(lex, [{ kind: "bot", strategy: a }, { kind: "bot", strategy: b }], mulberry32(4));
  assert.equal(a.views.at(-1)!.bagRemaining, 0);
  assert.equal(a.views[0]!.bagRemaining, BAG_SIZE - 11);
});

test("smart strategy never bids on the final tile and plays only valid words", () => {
  const s = new SmartStrategy(lex, mulberry32(5));
  const v: BotView = { rack: Array(26).fill(0), balance: 50, score: 0, bagRemaining: 0, unseen: Array(26).fill(1), numPlayers: 6, opponents: [] };
  assert.equal(s.bid(v, letterIndex("E")), 0);
  const r = runMatch(lex, [{ kind: "bot", strategy: s }, { kind: "sim", strategy: "Aggressive", name: "Brutus-sim" }], mulberry32(6));
  assert.equal(r.rejectedWords, 0);
  assert.ok(r.leftover[0]! <= 3, `left ${r.leftover[0]} tiles unplayed`);
});
