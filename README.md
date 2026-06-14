# XAU / BTC / XAG SCALP EXECUTION ENGINE V12.4.1 — Hobby Safe

This version fixes Vercel Hobby deployment limit.

Vercel Hobby error reason:
Previous build had more than 12 files inside /api, so Vercel counted them as Serverless Functions.

Now /api contains only 4 functions:
- metaapi.js
- binance.js
- journal.js
- worker-track-trades.js

Everything remains:
- Breaking ticker
- Fast Impulse Sniper
- Supabase Auto Journal
- Backtest Lab
- Worker tracking
- Strict routing:
  - BTCUSDT = Binance only
  - BTCUSD = MetaAPI only
  - XAUUSD/XAGUSD = MetaAPI only

Upload full ZIP contents to GitHub, then Redeploy Vercel.
Open with ?v=1241 to avoid iPhone/Safari cache.

Test endpoints:
- /api/metaapi?symbol=XAUUSD
- /api/metaapi?symbol=XAUUSD&timeframe=5m&limit=10
- /api/binance?type=price&symbol=BTCUSDT
- /api/binance?type=klines&symbol=BTCUSDT&timeframe=5m&limit=10
- /api/journal?action=open
