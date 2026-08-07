# Championship Equity Engine

The draft advisor should optimize expected roster outcomes, not isolated player ranks.

## Player decision vector

Each candidate is evaluated across these dimensions:

- Talent: market-adjusted player quality and stability.
- Opportunity: expected role, positional replacement pressure, and current roster demand.
- Market price: difference between expected selection point and current pick.
- Floor: conservative outcome proxy.
- Ceiling: upside proxy weighted toward players with room to outperform price.
- Breakout probability: asymmetric upside estimate.
- Bust probability: overpricing, duplication, and fragile roster-construction estimate.
- Positional scarcity: replacement loss if the position is deferred.
- Next-pick survival: Monte Carlo estimate from the draft-room simulator.
- Roster fit: starter and depth requirements from the active league configuration.
- Championship impact: estimated improvement in roster title-equity proxy relative to alternatives.

## Draft actions

The UI converts the vector into one of four actions:

- Draft now: strong championship impact with meaningful availability risk.
- Wait: attractive player who is likely to survive.
- Target later: useful roster fit but current price is inefficient.
- Avoid at cost: downside or roster duplication overwhelms marginal upside.

## Roster equity

The first implementation is an interpretable simulation proxy, not a claim of calibrated title probability. It rewards starter strength, positional balance, upside concentration, replacement value, and scarcity while penalizing severe starter gaps, duplicate low-leverage depth, and reaches.

At each user pick, the engine evaluates the leading candidates by adding each player to the current roster, estimating the resulting roster-equity distribution, and comparing that result with realistic alternative picks. The displayed `Equity delta` is the candidate's marginal improvement versus the best alternative baseline.

Future calibration can replace the proxy with historical league outcomes without changing the UI contract.
