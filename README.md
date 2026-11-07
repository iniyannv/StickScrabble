# StickScrabble: a ScrabbleBot (SpacetimeDB) bot

A bot for the [ScrabbleBot challenge](https://scrabblebot.spacetimedb.com/docs). It connects to the
`scrabblebot` database on SpacetimeDB maincloud, buys letters in 1-second auctions, and plays words from its rack.

## Running it

1. Link your spacetimedb.com identity at <https://scrabblebot.spacetimedb.com/account>.
2. Create a team at `/team/new`, then click **Generate token** on `/team`. The token is shown once.
3. Start the bot:

```bash
npm install
```

```bash
BOT_NAME=stick BOT_TOKEN=<token from /team> npm start
```

The token is saved to `.token-stick` (gitignored), so later runs only need `BOT_NAME=stick npm start`.

| Env var | Meaning |
|---|---|
| `BOT_NAME` | Local name, used for the token file and log prefix |
| `BOT_TOKEN` | Token from `/team` (first run only) |
| `TOURNAMENT_ID` | Register for that tournament on connect |
| `PARAMS` | Strategy params JSON (default `config/params.json`, tuned in the simulator) |
| `DRY_RUN=1` | Connect and log decisions, but never call game reducers |

Match results are appended to `logs/results.jsonl`.

## Game rules, verified against the server source

The server module lives at `spacetimedb/src/game.ts` in clockworklabs/scrabblebot.

- A match has 6 seats. Real bots fill them first, and idle sim bots pad the rest when the lobby times out.
- Each bot is dealt 5 hidden tiles and starts with 100 coins. The bag holds 98 tiles, with no blanks.
- **Auctions are Vickrey** (sealed bid, the winner pays the 2nd-highest bid, or 1 as the only bidder). Ties are broken at random, and a bid must be no more than your balance.
- A tile that nobody bids on is discarded.
- The match ends when the auction that empties the bag closes. So **the last tile can never be played**, and every word must be submitted before that close.
- Words come from your rack at any time; there is no board. The reward is the sum of letter values × a length multiplier (1x for 3 letters or fewer, 1.5x / 2x / 2.5x for 4 / 5 / 6 letters, 3x for 7 or more), rounded down.
- The reward is added to both score and balance. Ranking (OpenSkill) uses only your finishing place, so coins and tiles left at the end are worthless.

## How the bot plays

- **Lexicon** (`src/engine/lexicon.ts`): a trie over sorted letters. It finds the exact **best partition** of a rack into disjoint words with a DP over sub-multisets, in about 1–5ms for 12–14 tiles. Larger racks take the greedy best word first.
- **Valuation** (`src/strategy/valuation.ts`): a letter's value is the expected gain in final partition score from owning it. This is estimated by Monte Carlo over future tiles drawn from the letters we haven't seen.
- **Bidding** (`src/strategy/smart.ts`):
  - Bid = value × an aggressiveness factor, boosted when we're rich and in the endgame.
  - Bid 0 on the final tile, since it can't be played.
  - In first-price matches (tournaments can use them), the bid is shaded.
- **Word play**: hold tiles to build 7+ letter words (3x), cash in a word when the balance runs low, and dump the whole best partition as the bag empties.

## Simulator and tuning

`src/sim/engine.ts` copies the server's rules: dealing, Vickrey close with random ties, discarded no-bid tiles, the end condition, and the sim bots' exact bidding and word play.

```bash
npm run sim -- --matches 500 --opp live
```

Lineups: `sims` (5 server sim bots), `starter` (the official starter strategy), `self` (5 copies of our bot), `live2` (3 sims plus 2 copies), and `live` (3 sims plus 2 bots that bid from real history).

```bash
npm run tune -- --opp live2 --param aggr --values 1.2,1.6,2
```

`npm run fetch-history -- --matches 400` pulls recent public match data (top bids are public once a match ends) into `data/history.json`. `npx tsx scripts/analyze-history.ts` prints per-letter prices and stats for the top bots.

## Tests

```bash
npm test
```

## Regenerating bindings

`src/module_bindings/` was copied from the clockworklabs/scrabblebot repo, generated with spacetime CLI 2.12. If the module changes, install the [spacetime CLI](https://spacetimedb.com/install), clone the repo, and run:

```bash
spacetime generate --lang typescript --out-dir src/module_bindings --module-path <repo>/spacetimedb
```
