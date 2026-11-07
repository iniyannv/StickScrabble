import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../src/engine/lexicon.js";
import { countsFromString, lengthMultiplier, wordReward, BAG_COUNTS, BAG_SIZE } from "../src/engine/rules.js";

const lex = Lexicon.load();

test("rules mirror the server", () => {
  assert.equal(BAG_COUNTS.reduce((a, b) => a + b, 0), BAG_SIZE);
  assert.deepEqual(lengthMultiplier(3), [1, 1]);
  assert.deepEqual(lengthMultiplier(4), [3, 2]);
  assert.deepEqual(lengthMultiplier(9), [3, 1]);
  // CATS base 6 * 1.5 = 9; DOTS base 5 * 1.5 = 7.5 -> 7 (integer division)
  assert.equal(wordReward("CATS"), 9);
  assert.equal(wordReward("DOTS"), 7);
  assert.equal(wordReward("QUETZAL"), 3 * (10 + 1 + 1 + 1 + 10 + 1 + 1));
});

test("dictionary membership", () => {
  assert.ok(lex.isWord("QUETZAL"));
  assert.ok(lex.isWord("aa"));
  assert.ok(!lex.isWord("QZX"));
});

// Brute force best single word from a small dictionary scan.
function naiveBest(rack: string): number {
  const c = countsFromString(rack);
  let best = 0;
  for (const w of lex.words) {
    if (w.length > rack.length) continue;
    const need = countsFromString(w);
    if (need.every((n, i) => n <= c[i]!)) best = Math.max(best, wordReward(w));
  }
  return best;
}

test("bestWord matches brute force", () => {
  for (const r of ["AEIRST", "QUIZ", "XYLOPHE", "JKQZVW", "EEEE", "BANANAS"]) {
    assert.equal(lex.bestWord(countsFromString(r))?.reward ?? 0, naiveBest(r), r);
  }
});

test("bestPartition words are valid, disjoint, and sum to the score", () => {
  for (const r of ["QZXJKAEIOUSTRNLD", "AEEIIONRSTLDGBC", "AAB", "ZZZ"]) {
    const rack = countsFromString(r);
    const res = lex.bestPartition(rack);
    const used = countsFromString(res.words.map((w) => w.word).join(""));
    used.forEach((n, i) => assert.ok(n <= rack[i]!, `${r} overuses letter ${i}`));
    for (const w of res.words) assert.ok(lex.isWord(w.word));
    assert.equal(res.words.reduce((a, w) => a + w.reward, 0), res.score);
    assert.ok(res.score >= (lex.bestWord(rack)?.reward ?? 0));
  }
  assert.equal(lex.bestPartition(countsFromString("ZZZ")).score, 0);
});

test("partition (approx) never beats exact and is close", () => {
  const r = countsFromString("AEEIIONRSTLDGBC");
  const exact = lex.bestPartition(r).score;
  const approx = lex.partition(r, true, 10).score;
  assert.ok(approx <= exact);
  assert.ok(approx >= exact * 0.8);
});
