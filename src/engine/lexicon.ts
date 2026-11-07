// Anagram trie over sorted letters + exact best-partition solver.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { A_CODE, type Counts, wordReward } from "./rules.js";

const MAX_WORD_LEN = 20;

export interface Play {
  word: string;
  reward: number;
}

export interface PartitionResult {
  score: number;
  words: Play[];
}

// A playable word found inside a specific rack.
interface Candidate {
  word: string;
  reward: number;
  code: number; // mixed-radix code relative to the rack
  letters: number[]; // distinct letter indices in the word
  need: number[]; // count per entry of `letters`
}

export class Lexicon {
  // Trie on sorted letter sequences. children[node*26+l] = child node or 0.
  private children: Int32Array;
  private wordAt: Int32Array; // node -> index into words (best reward anagram), -1 none
  private nodeCount = 1;
  readonly words: string[] = [];
  readonly rewards: number[] = [];
  private wordSet: Set<string>;

  constructor(wordList: string[]) {
    let cap = 1 << 19;
    this.children = new Int32Array(cap * 26);
    this.wordAt = new Int32Array(cap).fill(-1);
    this.wordSet = new Set();
    for (const raw of wordList) {
      const w = raw.trim().toUpperCase();
      if (w.length < 2 || w.length > MAX_WORD_LEN || !/^[A-Z]+$/.test(w)) continue;
      this.wordSet.add(w);
      const sorted = [...w].sort().join("");
      let node = 0;
      for (let i = 0; i < sorted.length; i++) {
        const l = sorted.charCodeAt(i) - A_CODE;
        let child = this.children[node * 26 + l]!;
        if (child === 0) {
          if (this.nodeCount >= cap) {
            cap *= 2;
            const nc = new Int32Array(cap * 26);
            nc.set(this.children);
            this.children = nc;
            const nw = new Int32Array(cap).fill(-1);
            nw.set(this.wordAt);
            this.wordAt = nw;
          }
          child = this.nodeCount++;
          this.children[node * 26 + l] = child;
        }
        node = child;
      }
      if (this.wordAt[node] === -1) {
        this.wordAt[node] = this.words.length;
        this.words.push(w);
        this.rewards.push(wordReward(w));
      }
    }
  }

  static load(file?: string): Lexicon {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const p = file ?? path.join(here, "..", "..", "data", "wordlist.txt");
    return new Lexicon(fs.readFileSync(p, "utf8").split("\n"));
  }

  isWord(w: string): boolean {
    return this.wordSet.has(w.toUpperCase());
  }

  /** All anagram classes spellable from `rack` (one representative word each). */
  playable(rack: Counts, minLen = 2): Candidate[] {
    const strides = new Array<number>(26);
    let s = 1;
    for (let i = 0; i < 26; i++) {
      strides[i] = s;
      s *= rack[i]! + 1;
    }
    const out: Candidate[] = [];
    const used = new Array<number>(26).fill(0);
    const children = this.children;
    const wordAt = this.wordAt;
    const words = this.words;
    const rewards = this.rewards;

    const dfs = (node: number, from: number, depth: number, code: number) => {
      const wi = wordAt[node]!;
      if (wi >= 0 && depth >= minLen) {
        const letters: number[] = [];
        const need: number[] = [];
        for (let i = 0; i < 26; i++) if (used[i]! > 0) {
          letters.push(i);
          need.push(used[i]!);
        }
        out.push({ word: words[wi]!, reward: rewards[wi]!, code, letters, need });
      }
      for (let l = from; l < 26; l++) {
        if (used[l]! >= rack[l]!) continue;
        const child = children[node * 26 + l]!;
        if (child === 0) continue;
        used[l]!++;
        dfs(child, l, depth + 1, code + strides[l]!);
        used[l]!--;
      }
    };
    dfs(0, 0, 0, 0);
    return out;
  }

  /** Highest-reward single word spellable from the rack. */
  bestWord(rack: Counts, minLen = 2): Play | null {
    let best: Play | null = null;
    for (const c of this.playable(rack, minLen)) {
      if (!best || c.reward > best.reward || (c.reward === best.reward && c.word.length > best.word.length)) {
        best = { word: c.word, reward: c.reward };
      }
    }
    return best;
  }

  /**
   * Exact maximum total reward from playing disjoint words out of the rack.
   * DP over sub-multisets (mixed-radix codes). Each state branches on its
   * lowest remaining letter: discard one copy of it, or play a word whose
   * (sorted) first letter is it, found by walking the trie within the
   * remaining counts.
   */
  bestPartition(rack: Counts, wantWords = true): PartitionResult {
    const strides = new Array<number>(26);
    let total = 1;
    for (let i = 0; i < 26; i++) {
      strides[i] = total;
      total *= rack[i]! + 1;
    }
    const useArray = total <= 1 << 22;
    const memoArr = useArray ? new Int32Array(total).fill(-1) : null;
    const memoMap = useArray ? null : new Map<number, number>();
    const choiceArr = wantWords && useArray ? new Int32Array(total) : null;
    const choiceMap = wantWords && !useArray ? new Map<number, number>() : null;
    const avail = rack.slice();
    const children = this.children;
    const wordAt = this.wordAt;
    const rewards = this.rewards;
    const DISCARD = -2;

    const solve = (code: number): number => {
      if (code === 0) return 0;
      const cached = memoArr ? memoArr[code]! : memoMap!.get(code);
      if (cached !== undefined && cached >= 0) return cached;
      let low = 0;
      while (avail[low] === 0) low++;
      avail[low]!--;
      let best = solve(code - strides[low]!);
      let bestChoice = DISCARD;
      const first = children[low]!; // root is node 0
      if (first !== 0) {
        const wordCodeStart = strides[low]!;
        const walk = (node: number, from: number, wcode: number) => {
          const wi = wordAt[node]!;
          if (wi >= 0) {
            const v = rewards[wi]! + solve(code - wcode);
            if (v > best) {
              best = v;
              bestChoice = wi;
            }
          }
          for (let l = from; l < 26; l++) {
            if (avail[l] === 0) continue;
            const child = children[node * 26 + l]!;
            if (child === 0) continue;
            avail[l]!--;
            walk(child, l, wcode + strides[l]!);
            avail[l]!++;
          }
        };
        walk(first, low, wordCodeStart);
      }
      avail[low]!++;
      if (memoArr) memoArr[code] = best;
      else memoMap!.set(code, best);
      if (choiceArr) choiceArr[code] = bestChoice;
      else if (choiceMap) choiceMap.set(code, bestChoice);
      return best;
    };

    const full = total - 1;
    const score = solve(full);
    const out: Play[] = [];
    if (wantWords) {
      let code = full;
      const cur = rack.slice();
      while (code > 0) {
        const c = choiceArr ? choiceArr[code]! : choiceMap!.get(code)!;
        if (c === DISCARD || c === undefined) {
          let low = 0;
          while (cur[low] === 0) low++;
          cur[low]!--;
          code -= strides[low]!;
        } else {
          const w = this.words[c]!;
          let wc = 0;
          for (let i = 0; i < w.length; i++) {
            const l = w.charCodeAt(i) - A_CODE;
            wc += strides[l]!;
            cur[l]!--;
          }
          out.push({ word: w, reward: this.rewards[c]! });
          code -= wc;
        }
      }
    }
    out.sort((a, b) => b.word.length - a.word.length);
    return { score, words: out };
  }

  /** Greedy: repeatedly play the highest-reward word. Fast for big racks. */
  greedyPartition(rack: Counts): PartitionResult {
    const cur = rack.slice();
    const out: Play[] = [];
    let score = 0;
    for (;;) {
      const w = this.bestWord(cur);
      if (!w) break;
      out.push(w);
      score += w.reward;
      for (let i = 0; i < w.word.length; i++) cur[w.word.charCodeAt(i) - A_CODE]!--;
    }
    return { score, words: out };
  }

  /**
   * Best partition, exact when the rack is small enough to be cheap, else
   * exact on the best greedy word removed first (repeat until small).
   */
  partition(rack: Counts, wantWords = true, exactLimit = 15): PartitionResult {
    let n = 0;
    for (let i = 0; i < 26; i++) n += rack[i]!;
    if (n <= exactLimit) return this.bestPartition(rack, wantWords);
    const cur = rack.slice();
    const pre: Play[] = [];
    let preScore = 0;
    while (n > exactLimit) {
      // Remove the highest reward 7+ letter word (or best word) and recurse.
      const w = this.bestWord(cur);
      if (!w) break;
      pre.push(w);
      preScore += w.reward;
      for (let i = 0; i < w.word.length; i++) cur[w.word.charCodeAt(i) - A_CODE]!--;
      n -= w.word.length;
    }
    const rest = this.bestPartition(cur, wantWords);
    return { score: preScore + rest.score, words: [...pre, ...rest.words] };
  }
}
