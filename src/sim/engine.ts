// Offline replica of the server's match rules (spacetimedb/src/game.ts).
import type { Lexicon } from "../engine/lexicon.js";
import {
  AUCTION_RESERVE,
  BAG_COUNTS,
  LETTER_VALUES,
  STARTING_BALANCE,
  STARTING_RACK_SIZE,
  emptyCounts,
  wordReward,
  A_CODE,
} from "../engine/rules.js";
import { intInRange, type Rng } from "../engine/rng.js";
import type { BotView, Strategy } from "../strategy/types.js";

export type SimKind = "Cheapskate" | "ValueBidder" | "Aggressive";
export type Seat = { kind: "sim"; strategy: SimKind; name: string } | { kind: "bot"; strategy: Strategy };

export const SIM_POOL: { name: string; strategy: SimKind }[] = [
  { name: "Cheapo-sim", strategy: "Cheapskate" },
  { name: "Valor-sim", strategy: "ValueBidder" },
  { name: "Brutus-sim", strategy: "Aggressive" },
  { name: "Hagrid-sim", strategy: "ValueBidder" },
  { name: "Maverick-sim", strategy: "Aggressive" },
  { name: "Snippet-sim", strategy: "Cheapskate" },
];

interface Player {
  seat: Seat;
  rack: number[];
  balance: number;
  score: number;
  unseen: number[];
  wordsPlayed: string[];
  tilesWon: number;
  earlyTiles: number; // tiles won in the first 30 auctions
  spent: number;
}

export interface MatchResult {
  names: string[];
  scores: number[];
  balances: number[];
  tilesWon: number[];
  earlyTiles: number[];
  spent: number[];
  leftover: number[]; // tiles left unplayed
  rounds: number;
  rejectedWords: number;
}

export function simBid(kind: SimKind, letter: number, balance: number, jitter: number): number {
  const value = LETTER_VALUES[letter]!;
  const isVowel = [0, 4, 8, 14, 20].includes(letter);
  let base: number;
  if (kind === "Cheapskate") base = value - 1;
  else if (kind === "ValueBidder") base = value;
  else base = value + (isVowel ? 4 : 2);
  return Math.max(Math.min(Math.max(base + jitter, 1), balance), 0);
}

export function runMatch(lex: Lexicon, seats: Seat[], rng: Rng, auctionType: "Vickrey" | "FirstPrice" = "Vickrey"): MatchResult {
  const bag = [...BAG_COUNTS];
  let bagTotal = bag.reduce((a, b) => a + b, 0);
  const draw = (): number | undefined => {
    if (bagTotal === 0) return undefined;
    let idx = intInRange(rng, 0, bagTotal - 1);
    for (let i = 0; i < 26; i++) {
      if (idx < bag[i]!) {
        bag[i]!--;
        bagTotal--;
        return i;
      }
      idx -= bag[i]!;
    }
    return undefined;
  };

  const players: Player[] = seats.map((seat) => ({
    seat,
    rack: emptyCounts(),
    balance: STARTING_BALANCE,
    score: 0,
    unseen: [...BAG_COUNTS],
    wordsPlayed: [],
    tilesWon: 0,
    earlyTiles: 0,
    spent: 0,
  }));
  for (const p of players) {
    for (let n = 0; n < STARTING_RACK_SIZE; n++) {
      const l = draw();
      if (l === undefined) break;
      p.rack[l]!++;
    }
    for (let i = 0; i < 26; i++) p.unseen[i]! -= p.rack[i]!;
    if (p.seat.kind === "bot") p.seat.strategy.reset?.();
  }

  let rejected = 0;
  const play = (p: Player, word: string): boolean => {
    const w = word.toUpperCase();
    if (w.length < 2 || !lex.isWord(w)) return false;
    const need = emptyCounts();
    for (let i = 0; i < w.length; i++) need[w.charCodeAt(i) - A_CODE]!++;
    for (let i = 0; i < 26; i++) if (need[i]! > p.rack[i]!) return false;
    for (let i = 0; i < 26; i++) p.rack[i]! -= need[i]!;
    const r = wordReward(w);
    p.balance += r;
    p.score += r;
    p.wordsPlayed.push(w);
    return true;
  };

  const view = (p: Player): BotView => ({
    rack: p.rack.slice(),
    balance: p.balance,
    score: p.score,
    bagRemaining: bagTotal,
    unseen: p.unseen.slice(),
    numPlayers: players.length,
    opponents: players.filter((o) => o !== p).map((o, i) => ({ id: String(i), balance: o.balance, score: o.score })),
    auctionType,
  });

  let rounds = 0;
  let letter = draw();
  while (letter !== undefined) {
    rounds++;
    for (const p of players) if (p.unseen[letter]! > 0) p.unseen[letter]!--;
    // Bids (sims bid at open, using their balance then).
    const bids: { player: Player; amount: number }[] = [];
    for (const p of players) {
      if (p.seat.kind === "sim") {
        const jitter = intInRange(rng, -2, 2);
        const amt = simBid(p.seat.strategy, letter, p.balance, jitter);
        if (amt > 0) bids.push({ player: p, amount: amt });
      } else {
        const strat = p.seat.strategy;
        for (const w of strat.chooseWords(view(p))) if (!play(p, w)) rejected++;
        const amt = Math.floor(strat.bid(view(p), letter));
        if (amt > 0 && amt <= p.balance) bids.push({ player: p, amount: amt });
      }
    }
    // Close: shuffle then stable sort desc.
    for (let i = bids.length - 1; i >= 1; i--) {
      const j = intInRange(rng, 0, i);
      [bids[i], bids[j]] = [bids[j]!, bids[i]!];
    }
    bids.sort((a, b) => b.amount - a.amount);
    const [first, second] = bids;
    if (first) {
      const paid =
        auctionType === "FirstPrice" ? first.amount : second ? second.amount : Math.min(AUCTION_RESERVE, first.amount);
      const w = first.player;
      if (w.balance >= paid) {
        w.balance -= paid;
        w.spent += paid;
        w.rack[letter]!++;
        w.tilesWon++;
        if (rounds <= 30) w.earlyTiles++;
        if (w.seat.kind === "sim") {
          // findBestPlayable(rack, 3): longest, then lexicographically first.
          let best: string | null = null;
          for (const c of lex.playable(w.rack, 3)) {
            if (!best || c.word.length > best.length || (c.word.length === best.length && c.word < best)) best = c.word;
          }
          if (best) play(w, best);
        }
      }
    }
    letter = draw();
  }

  return {
    names: players.map((p) => (p.seat.kind === "sim" ? p.seat.name : p.seat.strategy.name)),
    scores: players.map((p) => p.score),
    balances: players.map((p) => p.balance),
    tilesWon: players.map((p) => p.tilesWon),
    earlyTiles: players.map((p) => p.earlyTiles),
    spent: players.map((p) => p.spent),
    leftover: players.map((p) => p.rack.reduce((a, b) => a + b, 0)),
    rounds,
    rejectedWords: rejected,
  };
}
