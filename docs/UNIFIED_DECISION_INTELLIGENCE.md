# Unified Decision Intelligence

This layer addresses five weaknesses in signal-heavy fantasy systems: descriptive/predictive confusion, inconsistent confidence, non-league-relative metrics, data-dense UX, and weight growth without validation.

## 1. Descriptive vs predictive

Every signal is either **descriptive** or **predictive-eligible**. A descriptive trend may be displayed, but it should not influence player projections until it passes minimum data requirements and improves held-out performance.

## 2. Universal confidence

All adjustments carry a confidence score built from sample size, recency, source quality, cross-source agreement, and historical stability. The UI must show both the adjustment and its confidence band.

## 3. League-relative translation

Signals should eventually be translated into the active league scoring and replacement environment. The same game-environment effect can have different fantasy value in standard, PPR, Superflex, TE-premium, shallow, and deep formats.

## 4. Decision-first UX

The recommendation should lead. Supporting evidence follows in an auditable adjustment ledger. The ledger prevents a strong-looking single signal from silently overwhelming the base projection.

## 5. Backtest gate

`scripts/backtest_adjustments.py` uses walk-forward season splits. A weight should only increase when the adjusted model improves out-of-sample error or decision accuracy. Random train/test splits across seasons are intentionally avoided.

# Officiating-Adjusted Game Environment

The referee feature is modeled as a game-environment signal, not a direct player bonus.

Preferred hierarchy:

1. Officiating crew identity when available.
2. Historical scoring residual versus closing betting total.
3. Penalty profile and estimated scoring effect.
4. Stability across multiple seasons.
5. Context controls such as teams, venue, weather, spread and offensive strength.
6. Player-specific exposure through position and expected team scoring share.

The builder requires at least 24 games and 2 seasons before the signal becomes predictive-eligible. The strong sample target is 48 games. Even then, the weekly player projection adjustment is capped at 5% and is confidence-weighted.

The intent is not to say a referee "causes" an over or under. The model asks whether officiating information adds predictive value after the market and game context have already been considered.

# Adjustment Ledger

`js/adjustment-ledger.js` provides a common contract for Vegas, referee/game environment, matchup, role change, injury, weather and championship-archetype signals. Each row exposes raw effect, confidence, cap, applied percentage and fantasy-point impact.

`decision-intelligence.html` is the audit view for this system.
