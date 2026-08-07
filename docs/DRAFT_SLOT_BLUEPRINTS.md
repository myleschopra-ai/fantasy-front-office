# Draft Slot Blueprint Board

The Draft Slot Blueprint Board answers a different question from the live draft recommendation screen:

> If I were assigned each possible snake-draft position, what is the strongest *likely* roster construction the current decision framework would produce from that slot?

It runs each draft position independently. Opponents remain competent and ADP-driven, with modest variance, while the target roster uses the Front Office recommendation logic on every turn.

## Why this is not a perfect-draft board

Showing the single highest-scoring simulation would select lucky player falls that are not repeatable. The board therefore reports the median result for each slot and displays a representative upper-quartile roster as the actionable blueprint.

Each pick also reports how often that player appeared in the simulated roster path. High-frequency picks are structural targets; low-frequency picks are contingent outcomes.

## Draft decision inputs

The target team weighs:

- current player market rank
- available ADP when the external ADP source loads, otherwise market rank as an explicit proxy
- positional starter need
- late-draft penalties for leaving starter holes
- positional scarcity and tier pressure
- acquisition value relative to the current pick
- a bounded ceiling proxy
- roster construction limits by position

The active league can update team count, PPR scoring and Superflex/2QB assumptions through the shared league switcher.

## Outputs

For every draft slot, the board shows:

- median roster outcome score
- representative upper-quartile roster
- starter-strength score
- depth score
- number of stable/common-path selections
- roster positional distribution
- round-by-round projected selection
- player path frequency across simulations

The purpose is to reveal slot-dependent roster archetypes and decision paths, not to claim that a specific player will certainly be available at a specific pick.
