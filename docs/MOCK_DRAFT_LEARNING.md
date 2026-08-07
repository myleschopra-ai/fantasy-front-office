# Mock Draft Learning Layer

The mock-draft companion persists archived mock drafts in the browser and uses them as an empirical layer on top of market rankings.

## Learned signals

For every archived draft, the companion stores league size, user slot, strategy, timestamp, and every pick. It derives empirical ADP, observed pick range and sample count, player survival frequency to a target pick, and user reach/value patterns.

The empirical layer is local-first. No mock history is uploaded or shared.

## Simulation use

CPU selection scores blend current market rank with empirical ADP once a player has at least three observations. Roster need, tier scarcity, team tendency, positional runs, and controlled variance remain part of the CPU score.

At the user's turn, repeated simulations estimate the picks before the user's next turn. The UI shows a primary recommendation, upside alternative, structural alternative, wait candidate, simulated survival rate, likely-gone list, and likely-available list.

## Calibration rule

Observed mock history is not treated as authoritative with tiny samples. Empirical ADP is only shown after three observations and remains labeled with its sample size. Monte Carlo survival is a simulation estimate, not a guarantee.
