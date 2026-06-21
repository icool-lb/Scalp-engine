// api/binance.js
// FIX22 DIAGNOSTIC + REAL BINANCE SPOT/FUTURES SUPPORT
// Version marker: BINANCE_API_FIX22_DIAGNOSTIC_2026_06_21

const VERSION = 'BINANCE_API_FIX22_DIAGNOSTIC_2026_06_21';

const spotHosts = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://data-api.binance.vision'
];

const futuresHosts = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com'
];

function cleanSymbol(value) {
  return String(value || 'BTCUSDT').toUpperCase().trim().replace('.P', '');
}

function preferFutures(symbol) {
  // In Binance app, BTWUSDT is Perp, so futures must be tried first.
  return symbol === 'BTWUSDT';
}

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store,max-age=0');
  return res.status(status).json({ version: VERSION, ...body });
}

async function httpJson(url) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  const text = await r.text().catch(() => '');
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!r.ok) {
    throw Object.assign(new Error(data?.msg || data?.message || text || `HTTP ${r.status}`), {
      status: r.status,
      detail: data || text || null,
      url
    });
  }

  if (data === null || data === undefined) {
    throw Object.assign(new Error('Empty Binance response'), {
      detail: text || null,
      url
    });
  }

  if (typeof data === 'object' && data.code && Number(data.code) < 0) {
    throw Object.assign(new Error(data.msg || 'Binance API error'), {
      status: 400,
      detail: data,
      url
    });
  }

  return data;
}

async function tryHosts(hosts, path, validator) {
  let last = null;

  for (const host of hosts) {
    const url = host + path;
    try {
      const data = await httpJson(url);
      if (!validator || validator(data)) {
        return { host, url, data };
      }
      last = {
        host,
        url,
        error: 'Unexpected response shape',
        sample: data
      };
    } catch (e) {
      last = {
        host,
        url,
        error: e.message,
        status: e.status || null,
        detail: e.detail || null
      };
    }
  }

  throw Object.assign(new Error(last?.error || 'All Binance hosts failed'), {
    detail: last
  });
}

async function tryRoutes(routes) {
  const attempts = [];

  for (const route of routes) {
    try {
      const got = await tryHosts(route.hosts, route.path, route.validator);
      return {
        market: route.market,
        kind: route.kind,
        ...got,
        attempts
      };
    } catch (e) {
      attempts.push({
        market: route.market,
        kind: route.kind,
        error: e.message,
        detail: e.detail || null
      });
    }
  }

  throw Object.assign(new Error('All Binance routes failed'), {
    detail: attempts
  });
}

function routesFor(symbol, spotPath, futuresPath, validator, kind) {
  const futures = {
    market: 'futures',
    kind,
    hosts: futuresHosts,
    path: futuresPath,
    validator
  };

  const spot = {
    market: 'spot',
    kind,
    hosts: spotHosts,
    path: spotPath,
    validator
  };

  return preferFutures(symbol) ? [futures, spot] : [spot, futures];
}

function bookValidator(x) {
  return x && typeof x === 'object'
    && Number.isFinite(Number(x.bidPrice))
    && Number.isFinite(Number(x.askPrice));
}

function lastPriceValidator(x) {
  return x && typeof x === 'object'
    && Number.isFinite(Number(x.price));
}

function markPriceValidator(x) {
  return x && typeof x === 'object'
    && Number.isFinite(Number(x.markPrice));
}

function arrayValidator(x) {
  return Array.isArray(x);
}

function depthValidator(x) {
  return x && Array.isArray(x.bids) && Array.isArray(x.asks);
}

module.exports = async function(req, res) {
  try {
    if (req.method !== 'GET') {
      return json(res, 405, { ok: false, error: 'GET only' });
    }

    const type = String(req.query.type || 'price').toLowerCase();
    const symbol = cleanSymbol(req.query.symbol);
    const encoded = encodeURIComponent(symbol);

    if (type === 'health') {
      return json(res, 200, {
        ok: true,
        route: 'api/binance.js',
        symbol,
        message: 'If you see this version, Vercel is running the new file.'
      });
    }

    if (type === 'price') {
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
          lastPriceValidator,
          'lastPrice'
        ),
        {
          market: 'futures',
          kind: 'markPrice',
          hosts: futuresHosts,
          path: `/fapi/v1/premiumIndex?symbol=${encoded}`,
          validator: markPriceValidator
        }
      ];

      const result = await tryRoutes(routes);
      const raw = result.data;

      let bid;
      let ask;
      let mid;
      let spread;

      if (result.kind === 'bookTicker') {
        bid = Number(raw.bidPrice);
        ask = Number(raw.askPrice);
        mid = (bid + ask) / 2;
        spread = ask - bid;
      } else if (result.kind === 'lastPrice') {
        mid = Number(raw.price);
        bid = mid;
        ask = mid;
        spread = 0;
      } else {
        mid = Number(raw.markPrice);
        bid = mid;
        ask = mid;
        spread = 0;
      }

      return json(res, 200, {
        ok: true,
        source: 'binance',
        symbol,
        market: result.market,
        priceSource: result.kind,
        host: result.host,
        bid,
        ask,
        mid,
        spread,
        time: new Date().toISOString(),
        raw
      });
    }

    if (type === 'klines') {
      const interval = String(req.query.timeframe || '5m');
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '700', 10), 1000));
      const params = new URLSearchParams({ symbol, interval, limit: String(limit) });

      if (req.query.startTime) {
        params.set('startTime', String(req.query.startTime));
      }

      const result = await tryRoutes(routesFor(
        symbol,
        `/api/v3/klines?${params}`,
        `/fapi/v1/klines?${params}`,
        arrayValidator,
        'klines'
      ));

      const candles = result.data.map(k => ({
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
        Number.isFinite(c.open)
        && Number.isFinite(c.high)
        && Number.isFinite(c.low)
        && Number.isFinite(c.close)
      );

      if (!candles.length) {
        throw Object.assign(new Error(`No valid candles for ${symbol}`), {
          detail: { market: result.market, host: result.host }
        });
      }

      return json(res, 200, {
        ok: true,
        source: 'binance',
        symbol,
        market: result.market,
        host: result.host,
        timeframe: interval,
        candles
      });
    }

    if (type === 'depth') {
      const limit = Math.max(5, Math.min(parseInt(req.query.limit || '100', 10), 500));

      const result = await tryRoutes(routesFor(
        symbol,
        `/api/v3/depth?symbol=${encoded}&limit=${limit}`,
        `/fapi/v1/depth?symbol=${encoded}&limit=${limit}`,
        depthValidator,
        'depth'
      ));

      const bids = (result.data.bids || [])
        .map(x => [Number(x[0]), Number(x[1])])
        .filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));

      const asks = (result.data.asks || [])
        .map(x => [Number(x[0]), Number(x[1])])
        .filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));

      const bidVolume = bids.reduce((sum, row) => sum + row[1], 0);
      const askVolume = asks.reduce((sum, row) => sum + row[1], 0);

      return json(res, 200, {
        ok: true,
        source: 'binance-depth',
        symbol,
        market: result.market,
        host: result.host,
        bidVolume,
        askVolume,
        bids: bids.slice(0, 30),
        asks: asks.slice(0, 30),
        time: new Date().toISOString()
      });
    }

    if (type === 'aggtrades') {
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '800', 10), 1000));

      const result = await tryRoutes(routesFor(
        symbol,
        `/api/v3/aggTrades?symbol=${encoded}&limit=${limit}`,
        `/fapi/v1/aggTrades?symbol=${encoded}&limit=${limit}`,
        arrayValidator,
        'aggTrades'
      ));

      let buyAggVolume = 0;
      let sellAggVolume = 0;

      for (const trade of result.data) {
        const qty = Number(trade.q || 0);
        if (trade.m) sellAggVolume += qty;
        else buyAggVolume += qty;
      }

      return json(res, 200, {
        ok: true,
        source: 'binance-aggtrades',
        symbol,
        market: result.market,
        host: result.host,
        buyAggVolume,
        sellAggVolume,
        count: result.data.length,
        time: new Date().toISOString()
      });
    }

    return json(res, 400, { ok: false, error: 'bad type', type });

  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: e.message || 'Binance error',
      detail: e.detail || null
    });
  }
};
