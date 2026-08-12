# Historical calibration

`scripts/import_draft_history.py` converts CSV or JSON into `schemas/draft_history.schema.json`. Snake history learns empirical ADP/ranges only after at least three observations; its adjustment is shrinkage-limited to 25% weight and eight draft slots. Auction history extends the existing position/tier price model with manager premiums.

Examples:

```bash
python3 scripts/import_draft_history.py prior_draft.csv --kind snake --output snake_history.json
python3 scripts/import_draft_history.py auction_sales.json --kind auction --output auction_history.json
```

Calibration is evidence, not truth. Small samples are ignored, current market rankings remain the prior, and local history is never uploaded automatically.
