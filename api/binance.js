const spotHosts = ['https://api.binance.com', 'https://api1.binance.com', 'https://data-api.binance.vision'];
const futuresHosts = ['https://fapi.binance.com', 'https://fapi1.binance.com'];

function cleanSymbol(s) {
  return String(s || 'BTCUSDT').toUpperCase().trim().replace('.P', '');
}
function preferFutures(symbol) {
  // BTWUSDT in the Binance app is shown as Perp, so futures must be tried first.
  return symbol === 'BTWUSDT';
}
async function httpJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const txt = await r.text().catch(() => '');
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch (_) { j = null; }

  if (!r.ok) {
    throw Object.assign(new Error(j?.msg || j?.message || txt || `HTTP ${r.status}`), {
      status: r.status,
      detail: j || txt || null
    });
  }
  if (j == null) {
    throw Object.assign(new Error('Empty Binance response'), { detail: txt || null });
  }
  if (typeof j === 'object' && j.code && Number(j.code) < 0) {
    throw Object.assign(new Error(j.msg || 'Binance API error'), { detail: j });
  }
  return j;
}
async function tryHosts(hosts, path, validator) {
  let last = null;
  for (const h of hosts) {
    try {
      const data = await httpJson(h + path);
      if (!validator || validator(data)) return { host: h, data };
      last = { host: h, error: 'Unexpected response shape', data };
    } catch (e) {
      last = { host: h, error: e.message, detail: e.detail || null, status: e.status || null };
    }
  }
  throw Object.assign(new Error(last?.error || 'Binance hosts failed'), { detail: last });
}
async function tryRoutes(routes) {
  let last = null;
  for (const r of routes) {
    try {
      const got = await tryHosts(r.hosts, r.path, r.validator);
      return { ...got, market: r.market, kind: r.kind };
    } catch (e) {
      last = { market: r.market, kind: r.kind, error: e.message, detail: e.detail || null };
    }
  }
  throw Object.assign(new Error('Binance routes failed'), { detail: last });
}
function routesFor(symbol, spotPath, futuresPath, validator, kind = 'default') {
  const futures = { market: 'futures', hosts: futuresHosts, path: futuresPath, validator, kind };
  const spot = { market: 'spot', hosts: spotHosts, path: spotPath, validator, kind };
  return preferFutures(symbol) ? [futures, spot] : [spot, futures];
}
function bookValidator(j) {
  return j && typeof j === 'object' && Number.isFinite(Number(j.bidPrice)) && Number.isFinite(Number(j.askPrice));
}
function priceValidator(j) {
  return j && typeof j === 'object' && Number.isFinite(Number(j.price));
}
function premiumValidator(j) {
  return j && typeof j === 'object' && Number.isFinite(Number(j.markPrice));
}
function arrValidator(j) { return Array.isArray(j); }
function depthValidator(j) { return j && Array.isArray(j.bids) && Array.isArray(j.asks); }

module.exports = async function(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

    const type = String(req.query.type || 'price').toLowerCase();
    const symbol = cleanSymbol(req.query.symbol);

    if (type === 'price') {
      const encoded = encodeURIComponent(symbol);

      // 1) Best: bookTicker. 2) Fallback: ticker/price. 3) Futures fallback: premiumIndex markPrice.
      const routes = [
        ...routesFor(
          symbol,
          `/api/v3/ticker/bookTicker?symbol=${encoded}`,
          `/fapi/v1/ticker/bookTicker?symbol=${encoded}`,
          bookValidator,
          'bookTicker'
        ),
        ...routesFor(
          symbol,
          `/api/v3/ticker/price?symbol=${encoded}`,
          `/fapi/v1/ticker/price?symbol=${encoded}`,
          priceValidator,
          'lastPrice'
        ),
        { market: 'futures', hosts: futuresHosts, path: `/fapi/v1/premiumIndex?symbol=${encoded}`, validator: premiumValidator, kind: 'markPrice' }
      ];

      const { host, market, kind, data: j } = await tryRoutes(routes);

      let bid, ask, mid, spread, priceSource = kind;
      if (kind === 'bookTicker') {
        bid = Number(j.bidPrice);
        ask = Number(j.askPrice);
        mid = (bid + ask) / 2;
        spread = ask - bid;
      } else if (kind === 'lastPrice') {
        mid = Number(j.price);
        bid = mid;
        ask = mid;
        spread = 0;
      } else {
        mid = Number(j.markPrice);
        bid = mid;
        ask = mid;
        spread = 0;
      }

      res.setHeader('Cache-Control', 'no-store,max-age=0');
      return res.status(200).json({
        ok: true,
        source: 'binance',
        market,
        priceSource,
        host,
        symbol,
        bid,
        ask,
        mid,
        spread,
        time: new Date().toISOString(),
        raw: j
      });
    }

    if (type === 'klines') {
      const interval = String(req.query.timeframe || '5m');
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '700', 10), 1000));
      const qs = new URLSearchParams({ symbol, interval, limit: String(limit) });
      if (req.query.startTime) qs.set('startTime', String(req.query.startTime));

      const { host, market, data: j } = await tryRoutes(routesFor(
        symbol,
        `/api/v3/klines?${qs}`,
        `/fapi/v1/klines?${qs}`,
        arrValidator,
        'klines'
      ));

      const candles = j.map(k => ({
        symbol,
        time: new Date(k[0]).toISOString(),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        tickVolume: Number(k[8] || k[5]),
        state: 'complete'
      })).filter(c =>
        Number.isFinite(c.open) && Number.isFinite(c.high) &&
        Number.isFinite(c.low) && Number.isFinite(c.close)
      );

      if (!candles.length) throw new Error(`No valid candles for ${symbol}`);

      res.setHeader('Cache-Control', 'no-store,max-age=0');
      return res.status(200).json({ ok: true, source: 'binance', market, host, symbol, timeframe: interval, candles });
    }

    if (type === 'depth') {
      const limit = Math.max(5, Math.min(parseInt(req.query.limit || '100', 10), 500));
      const encoded = encodeURIComponent(symbol);

      const { host, market, data: j } = await tryRoutes(routesFor(
        symbol,
        `/api/v3/depth?symbol=${encoded}&limit=${limit}`,
        `/fapi/v1/depth?symbol=${encoded}&limit=${limit}`,
        depthValidator,
        'depth'
      ));

      const bids = (j.bids || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
      const asks = (j.asks || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
      const bidVolume = bids.reduce((s, x) => s + x[1], 0);
      const askVolume = asks.reduce((s, x) => s + x[1], 0);

      res.setHeader('Cache-Control', 'no-store,max-age=0');
      return res.status(200).json({
        ok: true,
        source: 'binance-depth',
        market,
        host,
        symbol,
        bidVolume,
        askVolume,
        bids: bids.slice(0, 30),
        asks: asks.slice(0, 30),
        time: new Date().toISOString()
      });
    }

    if (type === 'aggtrades') {
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '800', 10), 1000));
      const encoded = encodeURIComponent(symbol);

      const { host, market, data: j } = await tryRoutes(routesFor(
        symbol,
        `/api/v3/aggTrades?symbol=${encoded}&limit=${limit}`,
        `/fapi/v1/aggTrades?symbol=${encoded}&limit=${limit}`,
        arrValidator,
        'aggTrades'
      ));

      let buyAggVolume = 0, sellAggVolume = 0;
      for (const t of j) {
        const q = Number(t.q || 0);
        if (t.m) sellAggVolume += q;
        else buyAggVolume += q;
      }

      res.setHeader('Cache-Control', 'no-store,max-age=0');
      return res.status(200).json({
        ok: true,
        source: 'binance-aggtrades',
        market,
        host,
        symbol,
        buyAggVolume,
        sellAggVolume,
        count: j.length,
        time: new Date().toISOString()
      });
    }

    return res.status(400).json({ ok: false, error: 'bad type' });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || 'Binance error',
      detail: e.detail || null
    });
  }
};
