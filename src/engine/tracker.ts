// Per-match knowledge from one bot's point of view.
import { BAG_COUNTS, type Counts } from "./rules.js";

export class LetterTracker {
  /** Letters not yet seen by us: full bag - our starting rack - auctioned. */
  readonly unseen: Counts = [...BAG_COUNTS];
  private seenAuctions = new Set<string>();
  private initialised = false;

  /** Our dealt rack (call once, at match start). */
  setStartingRack(rack: Counts) {
    if (this.initialised) return;
    this.initialised = true;
    for (let i = 0; i < 26; i++) this.unseen[i] = Math.max(0, this.unseen[i]! - rack[i]!);
  }

  get hasStartingRack() {
    return this.initialised;
  }

  /** An auctioned letter, keyed by auction id so repeats are ignored. */
  seeAuction(auctionId: string, letter: number) {
    if (this.seenAuctions.has(auctionId)) return;
    this.seenAuctions.add(auctionId);
    if (this.unseen[letter]! > 0) this.unseen[letter]!--;
  }
}
