# XAU / BTC / XAG SCALP EXECUTION ENGINE V12.4

Breaking Tape + Fast Impulse Sniper + Supabase Lab.

Added:
- Breaking-news style ticker above the chart.
- Priority order:
  1. FAST / LOCKED TRADE
  2. BREAKOUT ALERT
  3. IMPULSE PRE-ALERT
  4. LIQUIDITY SWEEP
  5. TARGET GUARD
  6. NO CHASE
  7. WATCH / commentary
- Fast Sniper real trade mode:
  - BTCUSDT Binance only
  - Aggressive Mode only
  - M1 / M5 only
  - Requires IMPULSE_ALERT or BREAKOUT
  - Requires Binance Footprint alignment
  - Blocks if No Chase / candle already too stretched
  - Small SL behind micro-structure
  - TP1 before nearest obstacle when possible
  - Auto locks and auto saves to Supabase/local journal
- Keeps strict routing:
  - BTCUSDT => Binance only
  - BTCUSD => MetaAPI only
  - XAUUSD/XAGUSD => MetaAPI only
- Supabase Auto Journal + Backtest Lab retained from V12.3.

Required Vercel env:
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JOURNAL_WORKER_SECRET
METAAPI_TOKEN
METAAPI_ACCOUNT_ID
METAAPI_REGION=london
