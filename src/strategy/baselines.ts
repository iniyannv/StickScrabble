// Reference opponents: the official starter's strategy.
import type { Lexicon } from "../engine/lexicon.js";
import { LETTER_VALUES } from "../engine/rules.js";
import type { BotView, Strategy } from "./types.js";

/** bot-starter/src/strategy.ts: face value (+2 if missing), play longest word ASAP. */
export class StarterStrategy implements Strategy {
  readonly name = "starter";
  constructor(private lex: Lexicon) {}
  bid(v: BotView, letter: number): number {
    const value = LETTER_VALUES[letter]!;
    const want = v.rack[letter]! === 0 ? value + 2 : Math.max(1, value);
    return Math.min(want, Math.max(0, v.balance));
  }
  chooseWords(v: BotView): string[] {
    // longest playable word (any length >= 2)
    let best: string | null = null;
    for (const c of this.lex.playable(v.rack, 2)) {
      if (!best || c.word.length > best.length) best = c.word;
    }
    return best ? [best] : [];
  }
}
