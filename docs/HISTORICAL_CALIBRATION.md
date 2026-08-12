# Historical calibration

`scripts/import_draft_history.py` converts CSV or JSON into `schemas/draft_history.schema.json`. Snake history learns empirical ADP/ranges only after at least three observations; its adjustment is shrinkage-limited to 25% weight and eight draft slots. Auction history extends the existing position/tier price model with manager premiums.

Examples:

```bash
python3 scripts/import_draft_history.py prior_draft.csv --kind snake --output snake_history.json
python3 scripts/import_draft_history.py auction_sales.json --kind auction --output auction_history.json
```

Auction calibration reports its matched sample count, mean absolute error (MAE), root mean squared error (RMSE), and a middle-60% price range by position/tier. With at least two seasons it also performs leave-one-season-out validation and reports held-out MAE, RMSE, and bias overall and by position, tier, and manager. Confidence is labeled low, medium, or high from the available evidence; fewer than three matching observations remain unmodeled. These are historical diagnostics, not guaranteed future prices.

Completed snake drafts are archived locally and can be compared in `draft-review.html` by draft slot, league format, and selected strategy. Comparisons with fewer than three drafts are explicitly labeled directional.

Calibration is evidence, not truth. Small samples are ignored or visibly qualified, current market rankings remain the prior, and local history is never uploaded automatically.
