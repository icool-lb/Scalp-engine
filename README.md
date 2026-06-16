# V12.4.1 DNA + Supabase Backtest Fix12

Keeps the current professional interface and DNA/Wizard changes.

Changed:
- Adjustable Backtest Pro parameters before testing.
- Results now change when you adjust Min Quality, session, target, hold bars, overlap and costs.
- Saves full backtest settings + trades + learning causes to Supabase.
- Adds Supabase health + recommendations actions.
- Adds strategy_rule_suggestions table.

Upload only these changed files if your APIs already work:
- index.html
- api/journal.js
- supabase_schema.sql / supabase_schema_for_phone.txt

Keep existing api/metaapi.js, api/binance.js, api/worker-track-trades.js.
