# XAU / BTC / XAG SCALP EXECUTION ENGINE V11.11

Hybrid Intelligence release based on the chat requirements.

Modules added or upgraded:
- Technical Schools: aggregates all school scores into BUY / SELL / RANGE leadership.
- Session Liquidity: detects session high/low sweeps and liquidity proximity.
- Smart Money Footprint:
  - For BTCUSDT: uses Binance public order book and aggregate trades.
  - For XAUUSD/XAGUSD: uses best available MetaAPI candle tickVolume + wick/absorption fallback because paid CMD/DOM is not used.
- Opportunity Hunter: highlights hidden opportunities like breakout/retest around resistance/support, session liquidity, and Gann reaction lines.
- Risk/Journal/Backtest: keeps mode rules, target guard, entry reports, and local journal.

New Binance public API routes:
- /api/binance-price
- /api/binance-klines
- /api/binance-depth
- /api/binance-aggtrades

Use BTCUSDT Binance from the symbol selector when you want Binance candles/price/footprint.
Use BTCUSD Meta when you want broker BTC but still benefit from Binance liquidity enrichment.

No demo fallback.

Required Vercel Environment Variables for metals and Meta symbols:
METAAPI_TOKEN
METAAPI_ACCOUNT_ID
METAAPI_REGION=london
