# Auction Draft Engine

The auction engine treats the draft as a constrained portfolio-allocation problem rather than a linear ranking exercise.

## Core decision variables

For each player the UI keeps separate:

- intrinsic roster value
- generic market AAV
- expected league clearing price
- current room-inflation adjusted price
- maximum bid given remaining budget and roster slots
- acquisition surplus
- nomination recommendation

Historical league behavior affects expected acquisition cost, not intrinsic football value.

## League-specific history contract

`config/auction_history.example.json` documents the import shape. Each purchase can include player, position, price, manager, nomination order, generic AAV, rank, and keeper status. Prices are normalized against league budget before estimating position, tier, and manager premiums.

The current browser implementation stores imported history in localStorage. It is intentionally provider-independent so Yahoo historical exports or manually reconstructed results can be loaded before Yahoo API access is available.

## Shrinkage

Small samples are shrunk toward the generic market. Position and tier effects gain influence only as comparable historical transactions accumulate. A historical league discount therefore lowers expected clearing price without lowering the player's intrinsic value.

## Live room state

The engine estimates room inflation from remaining dollars relative to remaining baseline player value. Every maximum bid also reserves the minimum amount required to fill the rest of the roster.

## Recommendations

Player decisions: `PRIORITY BUY`, `TARGET`, `BUY TO MAX`, `PRICE SENSITIVE`, `AVOID OVERPAY`.

Nomination decisions: `NOMINATE TO BUY`, `NOMINATE TO DRAIN`, `HOLD NOMINATION`.

## Current limitations

- Generic AAV is presently derived from the live FantasyCalc redraft market rather than a dedicated auction-AAV feed.
- Historical league prices must currently be imported through the JSON contract; automatic Yahoo historical-auction retrieval remains dependent on Yahoo API access.
- Manager-specific premiums are learned in the underlying model but are not yet applied to a nominated-player opponent-bidding simulation.
- The engine does not yet run thousands of complete auction-room simulations to optimize final roster construction under multiple bidding paths.

Those are the next validation targets before treating maximum bids as calibrated championship-optimal prices.
