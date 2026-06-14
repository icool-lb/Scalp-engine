# XAU / BTC / XAG SCALP EXECUTION ENGINE V12.4.2 — Magic + Integrity

New:
- Stable Breaking Tape: moving ticker no longer restarts every refresh and no flickering color.
- Magic Button / الزر السحري:
  - Detects range or trend.
  - Calculates range high/low, duration, touches, price location.
  - Reads candle behavior, liquidity, footprint, HTF, target guard.
  - Gives next direction probability, target, invalidation, time horizon.
  - Warns about manipulation: sweeps, long wicks, footprint/candle conflict, false breakout risk.
  - Draws Magic support/resistance/target/invalidation on chart.
- Backtest Integrity Fix:
  - Target Guard hard block.
  - XAU/XAG liquidity sweep = watch only unless retest/confirmation.
  - No overlapping trades.
  - HTF aggregation for backtest.
  - Estimated cost/slippage.
  - Better loss-cause report.

Hobby Safe API retained:
- /api/metaapi
- /api/binance
- /api/journal
- /api/worker-track-trades

Open with ?v=1242 after deploy.
