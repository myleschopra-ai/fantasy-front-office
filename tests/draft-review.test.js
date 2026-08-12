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
const secondPayload = { ...payload, slot: 4, strategy: 'hero-rb', picks: picks.map((pick, index) => ({ ...pick, team: 4, mine: true, key: `${pick.key}-second`, pick: pick.pick + index })) };
const secondReview = { ...Review.analyze(secondPayload, D), gradeScore: 88, totalValue: 6 };
Review.archive(storage, secondPayload, secondReview);
const archived = JSON.parse(storage.getItem(Review.ARCHIVE_KEY));
assert.deepEqual(Review.archiveDimensions(archived).slots, ['2', '4']);
assert.equal(Review.compareArchive(archived).n, 2);
assert.equal(Review.compareArchive(archived, { slot: '4' }).best.strategy, 'hero-rb');
assert.equal(Review.compareArchive(archived, { strategy: 'balanced' }).n, 1);
storage.setItem(Review.ARCHIVE_KEY, "not json");
assert.doesNotThrow(() => Review.archive(storage, payload, review), "corrupt archive must recover safely");
assert.equal(Review.artifact(payload, review).kind, "draft-review");
const auction = Review.analyzeAuction({ initialBudget: 200, remainingBudget: 95, minBid: 1, leagueSnapshot: { roster: { RB: 1 } }, myRoster: [{ key: 'ar', name: 'Auction RB', position: 'RB', price: 45, expectedPrice: 50, surplus: 5 }] }, D);
assert.equal(auction.spend, 45);
assert.equal(auction.totalSurplus, 5);
assert.equal(Review.auctionArtifact({}, auction).kind, 'auction-review');
console.log("draft review tests passed");
