# Vegas disagreement and line movement

The Vegas layer should reward independent agreement, not merely the existence of a sportsbook projection.

## Consensus confidence

For each player and market the consensus builder now stores:

- median line across books
- minimum and maximum line
- absolute spread
- number of contributing books
- per-book lines
- agreement score from 0 to 1
- freshness in hours

A single sportsbook receives only partial confidence. Two or more books with tight lines can generate a consensus signal. Large book disagreement reduces the Vegas weight instead of averaging away the uncertainty.

## Model disagreement

The front-end grading library compares the sportsbook-implied fantasy total with the internal model.

- Two or more books, agreement >= 0.72 and Vegas >= 15 fantasy points above the model: `$ Vegas bullish consensus`.
- Two or more books, agreement >= 0.72 and Vegas >= 15 fantasy points below the model: `⚠ Vegas bearish consensus`.
- Smaller disagreements are shown as directional leans.

The Vegas grade adjustment remains bounded at +/-12 points.

## Line movement

`build_vegas_consensus.py` accepts an optional previous consensus snapshot:

```bash
python scripts/build_vegas_consensus.py data/vegas/quotes.json data/vegas/consensus.json data/vegas/consensus.previous.json
```

For each market it records the change in the consensus line. It also recalculates the fantasy-point implication and stores fantasy-point movement for standard, half-PPR and PPR scoring.

A movement of roughly four implied fantasy points is treated as meaningful. Movement strengthens an existing model-vs-market signal but cannot by itself override the football model.

## Draft use

At draft time the desired display contract is:

- internal projected fantasy points
- Vegas-implied fantasy points
- delta versus model
- number of books
- book-agreement score
- line direction since previous snapshot
- bounded grade adjustment
- plain-language signal

Examples:

`$ Vegas bullish consensus · 3 books · 0.88 agreement · +21 pts vs model · line rising`

`⚠ Vegas bearish consensus · 2 books · 0.81 agreement · -18 pts vs model`

`↔ Vegas mixed · books disagree`

The purpose is to identify information the betting market may be pricing differently, not to treat sportsbook lines as ground truth.
