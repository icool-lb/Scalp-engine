# XAU / BTC / XAG SCALP EXECUTION ENGINE V12

Decision Engine Rebuild.

Key changes:
- BTC sources are separated strictly:
  - BTCUSD = MetaAPI broker price/candles only. No Binance data is mixed.
  - BTCUSDT = Binance Spot price/klines/depth/aggTrades only.
  - XAUUSD/XAGUSD = MetaAPI only with synthetic footprint from candles/tickVolume.
- Binance APIs use fallback hosts: api.binance.com, api1.binance.com, data-api.binance.vision.
- Core decision is no longer equal voting from RSI/MACD/EMA/Gann.
- Core decision priority:
  1. Candle Behavior
  2. Session/Level Liquidity
  3. Smart Money Footprint
  4. Opportunity/Breakout/No-Chase Hunter
  5. Target Guard / Risk
- RSI/MACD/EMA/Gann are supporting/context only and cannot create a trade alone.
- Analysis panels now show detailed explanations, not just a number.
- Opportunity Hunter detects:
  - compression near level
  - breakout/breakdown
  - no-chase after extended candles
  - liquidity triggers
- No demo fallback.

Required Vercel environment variables for MetaAPI routes:
METAAPI_TOKEN
METAAPI_ACCOUNT_ID
METAAPI_REGION=london

Binance routes need no API key.
