// api/binance.js
// FIX33: Binance Spot/Futures + Binance Alpha + Databento confirmation engine
// Version marker: BINANCE_API_FIX34_DATABENTO_PRICE_SCALE_2026_07_17

const VERSION = 'BINANCE_API_FIX34_DATABENTO_PRICE_SCALE_2026_07_17';

const spotHosts = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://data-api.binance.vision'
];

const futuresHosts = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com'
];

const alphaHost = 'https://www.binance.com';

const alphaCache = {
  ts: 0,
  tokens: null,
  map: new Map()
};

function cleanSymbol(value) {
  return String(value || 'BTCUSDT').toUpperCase().trim().replace('.P', '');
}

function isAlphaWanted(symbol) {
  // BTWUSDT in Binance app is Alpha / Trade-X style, not normal spot/fapi.
  return symbol === 'BTWUSDT';
}

function baseToken(symbol) {
  return String(symbol || '').toUpperCase().replace(/USDT$/, '');
}

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store,max-age=0');
  return res.status(status).json({ version: VERSION, ...body });
}

async function httpJson(url) {
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 market-data-bridge'
    },
    cache: 'no-store'
  });

  const text = await r.text().catch(() => '');
  let data = null;

  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

  if (!r.ok) {
    throw Object.assign(new Error(data?.msg || data?.message || text || `HTTP ${r.status}`), {
      status: r.status,
      detail: data || text || null,
      url
    });
  }

  if (data === null || data === undefined) {
    throw Object.assign(new Error('Empty response'), { detail: text || null, url });
  }

  if (typeof data === 'object' && data.code && Number(data.code) < 0) {
    throw Object.assign(new Error(data.msg || 'API error'), { status: 400, detail: data, url });
  }

  return data;
}

async function tryHosts(hosts, path, validator) {
  let last = null;
  for (const host of hosts) {
    const url = host + path;
    try {
      const data = await httpJson(url);
      if (!validator || validator(data)) return { host, url, data };
      last = { host, url, error: 'Unexpected response shape', sample: data };
    } catch (e) {
      last = { host, url, error: e.message, status: e.status || null, detail: e.detail || null };
    }
  }
  throw Object.assign(new Error(last?.error || 'All hosts failed'), { detail: last });
}

async function tryRoutes(routes) {
  const attempts = [];
  for (const route of routes) {
    try {
      const got = await tryHosts(route.hosts, route.path, route.validator);
      return { market: route.market, kind: route.kind, ...got, attempts };
    } catch (e) {
      attempts.push({ market: route.market, kind: route.kind, error: e.message, detail: e.detail || null });
    }
  }
  throw Object.assign(new Error('All Binance routes failed'), { detail: attempts });
}

function routesFor(symbol, spotPath, futuresPath, validator, kind) {
  const futures = { market: 'futures', kind, hosts: futuresHosts, path: futuresPath, validator };
  const spot = { market: 'spot', kind, hosts: spotHosts, path: spotPath, validator };
  return [spot, futures];
}

function bookValidator(x) {
  return x && typeof x === 'object'
    && Number.isFinite(Number(x.bidPrice))
    && Number.isFinite(Number(x.askPrice));
}
function lastPriceValidator(x) {
  return x && typeof x === 'object' && Number.isFinite(Number(x.price));
}
function markPriceValidator(x) {
  return x && typeof x === 'object' && Number.isFinite(Number(x.markPrice));
}
function arrayValidator(x) { return Array.isArray(x); }
function depthValidator(x) { return x && Array.isArray(x.bids) && Array.isArray(x.asks); }

function alphaOk(j) {
  return j && typeof j === 'object' && (j.success === true || j.code === '000000' || j.code === 0);
}

async function alphaRequest(path, validator) {
  const url = alphaHost + path;
  const j = await httpJson(url);
  if (!alphaOk(j)) {
    throw Object.assign(new Error(j?.message || j?.messageDetail || 'Alpha API failed'), {
      detail: j,
      url
    });
  }
  if (validator && !validator(j.data)) {
    throw Object.assign(new Error('Unexpected Alpha response shape'), {
      detail: j,
      url
    });
  }
  return { host: alphaHost, url, raw: j, data: j.data };
}

function normalizeAlphaId(alphaId) {
  const s = String(alphaId || '').trim();
  if (!s) return '';
  if (s.startsWith('ALPHA_')) return s;
  if (/^\d+$/.test(s)) return `ALPHA_${s}`;
  return s;
}

async function getAlphaSymbol(symbol) {
  const token = baseToken(symbol);
  if (!token) throw new Error('Bad Alpha symbol');

  const cached = alphaCache.map.get(token);
  if (cached && Date.now() - cached.ts < 15 * 60 * 1000) return cached;

  if (!alphaCache.tokens || Date.now() - alphaCache.ts > 15 * 60 * 1000) {
    const got = await alphaRequest(
      '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
      x => Array.isArray(x)
    );
    alphaCache.tokens = got.data || [];
    alphaCache.ts = Date.now();
    alphaCache.map.clear();
  }

  const upper = token.toUpperCase();
  const found = (alphaCache.tokens || []).find(t => {
    const sym = String(t.symbol || '').toUpperCase();
    const name = String(t.name || '').toUpperCase();
    const cex = String(t.cexCoinName || '').toUpperCase();
    return sym === upper || cex === upper || name === upper || name.includes(upper);
  });

  if (!found) {
    throw Object.assign(new Error(`Alpha token not found for ${token}`), {
      detail: {
        token,
        hint: 'Token List did not return matching symbol/name',
        sample: (alphaCache.tokens || []).slice(0, 5).map(t => ({ symbol: t.symbol, name: t.name, alphaId: t.alphaId }))
      }
    });
  }

  const alphaId = normalizeAlphaId(found.alphaId || found.id || found.tokenId);
  if (!alphaId || !alphaId.startsWith('ALPHA_')) {
    throw Object.assign(new Error(`Invalid Alpha ID for ${token}`), { detail: found });
  }

  const result = {
    token,
    alphaId,
    alphaSymbol: `${alphaId}USDT`,
    tokenInfo: {
      symbol: found.symbol,
      name: found.name,
      alphaId: found.alphaId,
      price: found.price,
      percentChange24h: found.percentChange24h
    },
    ts: Date.now()
  };

  alphaCache.map.set(token, result);
  return result;
}

async function alphaPrice(symbol) {
  const meta = await getAlphaSymbol(symbol);
  const qs = new URLSearchParams({ symbol: meta.alphaSymbol });
  const got = await alphaRequest(
    `/bapi/defi/v1/public/alpha-trade/ticker?${qs}`,
    x => x && typeof x === 'object'
  );
  const d = got.data || {};
  const mid = Number(d.lastPrice ?? d.price ?? meta.tokenInfo.price);
  if (!Number.isFinite(mid)) {
    throw Object.assign(new Error('Alpha ticker has no lastPrice'), { detail: got.raw });
  }
  return {
    ok: true,
    source: 'binance-alpha',
    market: 'alpha',
    priceSource: 'alphaTicker',
    host: got.host,
    symbol,
    alphaSymbol: meta.alphaSymbol,
    alphaId: meta.alphaId,
    bid: mid,
    ask: mid,
    mid,
    spread: 0,
    time: new Date().toISOString(),
    raw: d,
    tokenInfo: meta.tokenInfo
  };
}

async function alphaKlines(symbol, interval, limit, startTime, endTime) {
  const meta = await getAlphaSymbol(symbol);
  const qs = new URLSearchParams({ symbol: meta.alphaSymbol, interval, limit: String(Math.min(limit || 500, 1500)) });
  if (startTime) qs.set('startTime', String(startTime));
  if (endTime) qs.set('endTime', String(endTime));

  const got = await alphaRequest(
    `/bapi/defi/v1/public/alpha-trade/klines?${qs}`,
    x => Array.isArray(x)
  );

  const candles = (got.data || []).map(k => ({
    symbol,
    time: new Date(Number(k[0])).toISOString(),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    tickVolume: Number(k[8] || k[5] || 1),
    state: 'complete'
  })).filter(c =>
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close)
  );

  if (!candles.length) {
    throw Object.assign(new Error(`No Alpha candles for ${symbol}`), { detail: got.raw });
  }

  return {
    ok: true,
    source: 'binance-alpha',
    market: 'alpha',
    host: got.host,
    symbol,
    alphaSymbol: meta.alphaSymbol,
    alphaId: meta.alphaId,
    timeframe: interval,
    candles
  };
}

async function alphaDepth(symbol, limit) {
  const meta = await getAlphaSymbol(symbol);
  const allowed = [5, 10, 20, 50, 100, 500, 1000];
  let lim = Number(limit || 100);
  lim = allowed.includes(lim) ? lim : 100;

  const qs = new URLSearchParams({ symbol: meta.alphaSymbol, limit: String(lim) });
  const got = await alphaRequest(
    `/bapi/defi/v1/public/alpha-trade/fullDepth?${qs}`,
    x => x && Array.isArray(x.bids) && Array.isArray(x.asks)
  );

  const bids = (got.data.bids || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
  const asks = (got.data.asks || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
  const bidVolume = bids.reduce((s, x) => s + x[1], 0);
  const askVolume = asks.reduce((s, x) => s + x[1], 0);

  return {
    ok: true,
    source: 'binance-alpha-depth',
    market: 'alpha',
    host: got.host,
    symbol,
    alphaSymbol: meta.alphaSymbol,
    alphaId: meta.alphaId,
    bidVolume,
    askVolume,
    bids: bids.slice(0, 30),
    asks: asks.slice(0, 30),
    time: new Date().toISOString()
  };
}

async function alphaAggTrades(symbol, limit, startTime, endTime, fromId) {
  const meta = await getAlphaSymbol(symbol);
  const qs = new URLSearchParams({ symbol: meta.alphaSymbol, limit: String(Math.min(Number(limit || 500), 1000)) });
  if (startTime) qs.set('startTime', String(startTime));
  if (endTime) qs.set('endTime', String(endTime));
  if (fromId) qs.set('fromId', String(fromId));

  const got = await alphaRequest(
    `/bapi/defi/v1/public/alpha-trade/agg-trades?${qs}`,
    x => Array.isArray(x)
  );

  let buyAggVolume = 0;
  let sellAggVolume = 0;
  for (const tr of got.data || []) {
    const qty = Number(tr.q || 0);
    if (tr.m) sellAggVolume += qty;
    else buyAggVolume += qty;
  }

  return {
    ok: true,
    source: 'binance-alpha-aggtrades',
    market: 'alpha',
    host: got.host,
    symbol,
    alphaSymbol: meta.alphaSymbol,
    alphaId: meta.alphaId,
    buyAggVolume,
    sellAggVolume,
    count: (got.data || []).length,
    time: new Date().toISOString()
  };
}

async function normalPrice(symbol) {
  const encoded = encodeURIComponent(symbol);
  const routes = [
    ...routesFor(symbol, `/api/v3/ticker/bookTicker?symbol=${encoded}`, `/fapi/v1/ticker/bookTicker?symbol=${encoded}`, bookValidator, 'bookTicker'),
    ...routesFor(symbol, `/api/v3/ticker/price?symbol=${encoded}`, `/fapi/v1/ticker/price?symbol=${encoded}`, lastPriceValidator, 'lastPrice'),
    { market: 'futures', kind: 'markPrice', hosts: futuresHosts, path: `/fapi/v1/premiumIndex?symbol=${encoded}`, validator: markPriceValidator }
  ];
  const r = await tryRoutes(routes);
  const raw = r.data;
  let bid, ask, mid, spread;
  if (r.kind === 'bookTicker') {
    bid = Number(raw.bidPrice); ask = Number(raw.askPrice); mid = (bid + ask) / 2; spread = ask - bid;
  } else if (r.kind === 'lastPrice') {
    mid = Number(raw.price); bid = mid; ask = mid; spread = 0;
  } else {
    mid = Number(raw.markPrice); bid = mid; ask = mid; spread = 0;
  }
  return { ok: true, source: 'binance', market: r.market, priceSource: r.kind, host: r.host, symbol, bid, ask, mid, spread, time: new Date().toISOString(), raw };
}

async function normalKlines(symbol, interval, limit, startTime) {
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit || 700, 1000)) });
  if (startTime) params.set('startTime', String(startTime));
  const r = await tryRoutes(routesFor(symbol, `/api/v3/klines?${params}`, `/fapi/v1/klines?${params}`, arrayValidator, 'klines'));
  const candles = r.data.map(k => ({
    symbol,
    time: new Date(k[0]).toISOString(),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    tickVolume: Number(k[8] || k[5]),
    state: 'complete'
  })).filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  if (!candles.length) throw new Error(`No valid candles for ${symbol}`);
  return { ok: true, source: 'binance', market: r.market, host: r.host, symbol, timeframe: interval, candles };
}

async function normalDepth(symbol, limit) {
  const encoded = encodeURIComponent(symbol);
  limit = Math.max(5, Math.min(parseInt(limit || '100', 10), 500));
  const r = await tryRoutes(routesFor(symbol, `/api/v3/depth?symbol=${encoded}&limit=${limit}`, `/fapi/v1/depth?symbol=${encoded}&limit=${limit}`, depthValidator, 'depth'));
  const bids = (r.data.bids || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
  const asks = (r.data.asks || []).map(x => [Number(x[0]), Number(x[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]));
  return {
    ok: true, source: 'binance-depth', market: r.market, host: r.host, symbol,
    bidVolume: bids.reduce((s, x) => s + x[1], 0),
    askVolume: asks.reduce((s, x) => s + x[1], 0),
    bids: bids.slice(0, 30), asks: asks.slice(0, 30), time: new Date().toISOString()
  };
}

async function normalAggTrades(symbol, limit) {
  const encoded = encodeURIComponent(symbol);
  limit = Math.max(1, Math.min(parseInt(limit || '800', 10), 1000));
  const r = await tryRoutes(routesFor(symbol, `/api/v3/aggTrades?symbol=${encoded}&limit=${limit}`, `/fapi/v1/aggTrades?symbol=${encoded}&limit=${limit}`, arrayValidator, 'aggTrades'));
  let buyAggVolume = 0, sellAggVolume = 0;
  for (const tr of r.data) {
    const q = Number(tr.q || 0);
    if (tr.m) sellAggVolume += q; else buyAggVolume += q;
  }
  return { ok: true, source: 'binance-aggtrades', market: r.market, host: r.host, symbol, buyAggVolume, sellAggVolume, count: r.data.length, time: new Date().toISOString() };
}

// ===== DATABENTO FIX33 =====
// Uses Databento Historical HTTP API through the existing api/binance.js file to avoid adding a 5th Vercel function.
// It fetches recent OHLCV-1m and derives a confirmation score. API key stays server-side in DATABENTO_API_KEY.
function databentoMapSymbol(symbol) {
  const s = cleanSymbol(symbol);
  if (s === 'XAUUSD' || s === 'GC' || s === 'GC.FUT') return { dataset: 'GLBX.MDP3', dbSymbol: 'GC.FUT', stype_in: 'parent', proxy: 'GC futures proxy for XAUUSD' };
  if (s === 'XAGUSD' || s === 'SI' || s === 'SI.FUT') return { dataset: 'GLBX.MDP3', dbSymbol: 'SI.FUT', stype_in: 'parent', proxy: 'SI futures proxy for XAGUSD' };
  if (s === 'UKOIL' || s === 'CL' || s === 'CL.FUT') return { dataset: 'GLBX.MDP3', dbSymbol: 'CL.FUT', stype_in: 'parent', proxy: 'CL futures proxy for oil; verify Brent/WTI mapping with your broker' };
  if (s === 'BTCUSD' || s === 'BTCUSDT') return { dataset: 'GLBX.MDP3', dbSymbol: 'MBT.FUT', stype_in: 'parent', proxy: 'Micro Bitcoin futures proxy' };
  return { dataset: 'GLBX.MDP3', dbSymbol: 'GC.FUT', stype_in: 'parent', proxy: 'default GC futures proxy' };
}

function csvParseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.replace(/^"|"$/g, '').trim());
}

function databentoPrice(value) {
  let x = Number(value);
  if (!Number.isFinite(x)) return NaN;
  // Databento CSV often returns fixed-point prices for futures.
  // GC values like 4218000000 mean 4218.000000, so divide by 1e6.
  // Filter negative/zero sentinels and non-tradable rows.
  if (x <= 0) return NaN;
  if (Math.abs(x) > 1e7) x = x / 1e6;
  else if (Math.abs(x) > 1e5) x = x / 1e2;
  return x;
}

function databentoParseCsv(txt) {
  const lines = String(txt || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const h = csvParseLine(lines[0]).map(x => x.toLowerCase());
  const idx = (names) => names.map(n => h.indexOf(n)).find(i => i >= 0);
  const ti = idx(['ts_event', 'time', 'datetime']);
  const oi = idx(['open']);
  const hi = idx(['high']);
  const li = idx(['low']);
  const ci = idx(['close']);
  const vi = idx(['volume']);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = csvParseLine(lines[i]);
    const t = Date.parse(p[ti]);
    const o = databentoPrice(p[oi]), hh = databentoPrice(p[hi]), l = databentoPrice(p[li]), c = databentoPrice(p[ci]), v = Number(p[vi] || 0);
    if ([t, o, hh, l, c].every(Number.isFinite) && hh >= l) {
      out.push({ t, time: new Date(t).toISOString(), o, h: Math.max(o, hh, l, c), l: Math.min(o, hh, l, c), c, v: Number.isFinite(v) ? v : 0 });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

async function databentoOhlcv(req) {
  const key = process.env.DATABENTO_API_KEY;
  if (!key) return { ok: false, source: 'databento', error: 'Missing DATABENTO_API_KEY in Vercel variables' };

  const symbol = cleanSymbol(req.query.symbol || 'XAUUSD');
  const map = databentoMapSymbol(symbol);
  const limit = Math.max(5, Math.min(Number(req.query.limit || 80), 300));
  const mins = Math.max(30, Math.min(Number(req.query.minutes || 240), 1440));
  const end = req.query.end || new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // historical service: use older-than-24h safe default
  const start = req.query.start || new Date(Date.parse(end) - mins * 60 * 1000).toISOString();
  const schema = String(req.query.schema || 'ohlcv-1m');

  const params = new URLSearchParams({
    dataset: String(req.query.dataset || map.dataset),
    symbols: String(req.query.dbSymbol || map.dbSymbol),
    stype_in: String(req.query.stype_in || map.stype_in),
    schema,
    start,
    end,
    limit: String(limit),
    encoding: 'csv'
  });

  const url = 'https://hist.databento.com/v0/timeseries.get_range?' + params.toString();
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
      Accept: 'text/csv'
    }
  });

  const txt = await r.text();
  if (!r.ok) return { ok: false, source: 'databento', status: r.status, error: txt.slice(0, 500), map, start, end };
  const candles = databentoParseCsv(txt).slice(-limit);
  if (!candles.length) return { ok: false, source: 'databento', error: 'No Databento candles parsed after price-scale normalization', raw: txt.slice(0, 300), map, start, end };

  return { ok: true, source: 'databento', version: VERSION, symbol, map, dataset: params.get('dataset'), dbSymbol: params.get('symbols'), schema, start, end, priceScale: 'auto fixed-point /1e6 when needed', candles, count: candles.length };
}

function databentoConfirmFromCandles(candles) {
  const a = candles || [];
  if (a.length < 8) return { dir: 'RANGE', score: 0, reason: 'Not enough Databento bars' };
  const last = a[a.length - 1], prev = a[a.length - 2];
  const recent = a.slice(-8);
  const avgVol = recent.slice(0, -1).reduce((s, x) => s + Number(x.v || 0), 0) / Math.max(1, recent.length - 1);
  const volRatio = avgVol ? Number(last.v || 0) / avgVol : 1;
  const momentum = last.c - recent[0].o;
  const range = Math.max(...recent.map(x => x.h)) - Math.min(...recent.map(x => x.l)) || 1;
  const closePos = (last.c - last.l) / Math.max(1e-9, last.h - last.l);
  let dir = 'RANGE', score = 45, parts = [];
  if (momentum > range * 0.18 && closePos > 0.55) { dir = 'BUY'; score += 18; parts.push('Databento momentum BUY'); }
  if (momentum < -range * 0.18 && closePos < 0.45) { dir = 'SELL'; score += 18; parts.push('Databento momentum SELL'); }
  if (volRatio > 1.2) { score += 12; parts.push('Volume expansion ' + volRatio.toFixed(2) + 'x'); }
  if (last.c > prev.c && dir === 'BUY') { score += 8; parts.push('Last bar confirms BUY'); }
  if (last.c < prev.c && dir === 'SELL') { score += 8; parts.push('Last bar confirms SELL'); }
  score = Math.max(0, Math.min(96, Math.round(score)));
  return { dir, score, volRatio, lastClose: last.c, lastVolume: last.v, reason: parts.join(' | ') || 'Databento neutral' };
}

async function databentoConfirm(req) {
  const o = await databentoOhlcv(req);
  if (!o.ok) return o;
  const c = databentoConfirmFromCandles(o.candles);
  return { ...o, confirm: c };
}
// ===== END DATABENTO FIX33 =====

module.exports = async function(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });

    const type = String(req.query.type || 'price').toLowerCase();
    const symbol = cleanSymbol(req.query.symbol);
    const interval = String(req.query.timeframe || req.query.interval || '5m');
    const limit = Number(req.query.limit || (type === 'klines' ? 700 : 100));
    const alpha = isAlphaWanted(symbol) || String(req.query.alpha || '') === '1';

    if (type === 'health') {
      return json(res, 200, { ok: true, route: 'api/binance.js', version: VERSION, symbol, alpha, databento: !!process.env.DATABENTO_API_KEY, message: 'Fix33 Databento route active' });
    }

    if (type === 'databento') {
      return json(res, 200, await databentoConfirm(req));
    }

    if (type === 'databentoohlcv') {
      return json(res, 200, await databentoOhlcv(req));
    }

    if (type === 'alphasymbol') {
      const meta = await getAlphaSymbol(symbol);
      return json(res, 200, { ok: true, symbol, market: 'alpha', ...meta });
    }

    let body;
    if (type === 'price') body = alpha ? await alphaPrice(symbol) : await normalPrice(symbol);
    else if (type === 'klines') body = alpha ? await alphaKlines(symbol, interval, limit, req.query.startTime, req.query.endTime) : await normalKlines(symbol, interval, limit, req.query.startTime);
    else if (type === 'depth') body = alpha ? await alphaDepth(symbol, limit) : await normalDepth(symbol, limit);
    else if (type === 'aggtrades') body = alpha ? await alphaAggTrades(symbol, limit, req.query.startTime, req.query.endTime, req.query.fromId) : await normalAggTrades(symbol, limit);
    else return json(res, 400, { ok: false, error: 'bad type', type });

    return json(res, 200, body);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message || 'Binance error', detail: e.detail || null });
  }
};
