# XAU / BTC / XAG SCALP EXECUTION ENGINE V12.4.3

MetaAPI candles route fix.

Issue fixed:
- Current price endpoint was working.
- Candles endpoint returned 404 NotFound because the path used:
  /symbols/{symbol}/timeframes/{tf}/candles
- Corrected candles path to:
  /historical-market-data/symbols/{symbol}/timeframes/{tf}/candles

Everything else remains from V12.4.2:
- Stable breaking tape
- Magic button
- Backtest integrity fixes
- Hobby Safe API
- Supabase Journal / Worker

After deployment test:
- /api/metaapi?symbol=XAUUSD
- /api/metaapi?symbol=XAUUSD&timeframe=5m&limit=10

Open app with:
?v=1243
