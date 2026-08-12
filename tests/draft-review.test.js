const assert = require("assert");
const Review = require("../js/draft-review.js");
const D = require("../js/draft-intelligence.js");

const league = { roster: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, BN: 2 } };
const picks = [
  { key: "qb", name: "QB One", position: "QB", pick: 12, overallRank: 10, team: 2, round: 1 },
  { key: "wr", name: "WR One", position: "WR", pick: 13, overallRank: 20, team: 2, round: 2, decision: { selectedUtility: 76, recommendedUtility: 84, recommendedKey: "rb", recommendedName: "RB One" } },
  { key: "rb", name: "RB Two", position: "RB", pick: 36, overallRank: 25, team: 2, round: 3 },
  { key: "te", name: "TE One", position: "TE", pick: 37, overallRank: 40, team: 2, round: 4 },
  { key: "wr2", name: "WR Two", position: "WR", pick: 60, overallRank: 48, team: 2, round: 5 },
];
const payload = { picks, slot: 2, teams: 12, rounds: 5, strategy: "balanced", leagueSnapshot: league };
const review = Review.analyze(payload, D);
assert.equal(review.pickCount, 5);
assert.equal(review.counterfactuals.length, 1);
assert.equal(review.counterfactuals[0].utilityGap, 8);
assert.ok(review.steals.some((pick) => pick.key === "wr2"));
assert.equal(review.format, "12-team 1QB");

const memory = new Map();
const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
Review.archive(storage, payload, review);
Review.archive(storage, payload, review);
assert.equal(JSON.parse(storage.getItem(Review.ARCHIVE_KEY)).length, 1, "archive must be idempotent");
storage.setItem(Review.ARCHIVE_KEY, "not json");
assert.doesNotThrow(() => Review.archive(storage, payload, review), "corrupt archive must recover safely");
assert.equal(Review.artifact(payload, review).kind, "draft-review");
console.log("draft review tests passed");
