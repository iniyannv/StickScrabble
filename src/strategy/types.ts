import type { Counts } from "../engine/rules.js";

export interface OpponentView {
  id: string;
  balance: number;
  score: number;
}

/** What a bot knows when deciding. */
export interface BotView {
  rack: Counts;
  balance: number;
  score: number;
  /** Tiles left in the bag after the current auction's letter was drawn. */
  bagRemaining: number;
  /** Letters we have not seen (could still be drawn or are hidden in opponents' starting racks). */
  unseen: Counts;
  numPlayers: number;
  opponents: OpponentView[];
  /** "Vickrey" (pay 2nd price; lobby default) or "FirstPrice" (pay own bid). */
  auctionType?: "Vickrey" | "FirstPrice";
}

export interface Strategy {
  readonly name: string;
  /** Called at match start. */
  reset?(): void;
  /** Words to submit now (called when an auction opens and after our rack changes). */
  chooseWords(v: BotView): string[];
  /** Bid for `letter` (0-25) in the open auction. 0 = no bid. */
  bid(v: BotView, letter: number): number;
}
