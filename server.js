require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { MarketCache } = require('./lib/market-cache');
const { PressureStore } = require('./lib/pressure-store');
const { TradeSubscriptionManager } = require('./lib/trade-subscriptions');
const { createHeliusRiskClient } = require('./lib/helius-risk');
const { createPressurePersistence } = require('./lib/pressure-persistence');
const heliusRisk = createHeliusRiskClient();
const persistence = createPressurePersistence();
const marketCache = new MarketCache({ ttlMs: 120000, maxEntries: 1000 });
const pressureStore = new PressureStore();
let tradeSubscriptions = null;
let solUsdPrice = null;
let solUsdCheckedAt = 0;
let solUsdRequest = null;
let tradeFeedStatus = 'waiting for API key';
const alertedPressure = new Map();

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PUMP_URL = 'wss://pumpportal.fun/api/data';
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 500);
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 500);
const DEX_REFRESH_MS = Math.max(15000, Number(process.env.DEX_REFRESH_MS || 30000));

const startedAt = new Date().toISOString();
const tokens = new Map();
const recentEvents = [];
const clients = new Set();

let pumpSocket = null;
let pumpStatus = 'connecting';
let reconnectTimer = null;
let reconnectDelay = 2000;
let totalEvents = 0;
let lastDexRefresh = null;
let dexErrors = 0;
let refreshInProgress = false;

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeToken(mint, data = {}) {
  const prior = tokens.get(mint) || {};

  return {
    mint,
    name: data.name || prior.name || 'Unknown token',
    symbol: data.symbol || prior.symbol || '',
    uri: data.uri || prior.uri || null,
    image: data.image || prior.image || null,
    txType: data.txType || prior.txType || 'discovered',
    firstSeenAt: prior.firstSeenAt || new Date().toISOString(),
    lastEventAt: data.receivedAt || prior.lastEventAt || new Date().toISOString(),
    marketCapSol: safeNumber(data.marketCapSol) ?? prior.marketCapSol ?? null,
    priceUsd: prior.priceUsd ?? null,
    marketCapUsd: prior.marketCapUsd ?? null,
    liquidityUsd: prior.liquidityUsd ?? null,
    volume24h: prior.volume24h ?? null,
    txns24h: prior.txns24h ?? null,
    buys24h: prior.buys24h ?? null,
    sells24h: prior.sells24h ?? null,
    priceChange24h: prior.priceChange24h ?? null,
    pairAddress: prior.pairAddress || null,
    dexId: prior.dexId || null,
    dexUrl: prior.dexUrl || null,
    poolCreatedAt: prior.poolCreatedAt || null,
    traderPublicKey: data.traderPublicKey || prior.traderPublicKey || null,
    pool: data.pool || prior.pool || null,
    latestEventData: data,
    updatedAt: new Date().toISOString()
  };
}

function upsertFromEvent(event) {
  const data = event && event.data ? event.data : event;

  if (!data || typeof data.mint !== 'string') return null;

  const token = normalizeToken(data.mint, {
    ...data,
    receivedAt: event.receivedAt || new Date().toISOString()
  });

  tokens.delete(data.mint);
  tokens.set(data.mint, token);

  while (tokens.size > MAX_TOKENS) {
    tokens.delete(tokens.keys().next().value);
  }

  return token;
}

function broadcast(data) {
  const message = JSON.stringify(data);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (_) {}
    }
  }
}

function addEvent(payload) {
  totalEvents++;

  const event = {
    provider: 'PumpPortal',
    receivedAt: new Date().toISOString(),
    data: payload
  };

  recentEvents.unshift(event);

  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.pop();
  }

  const token = upsertFromEvent(event);
  if (token && token.mint) subscribeMintTrades(token.mint);

  broadcast({
    type: 'provider-event',
    ...event,
    token
  });
}

async function getSolUsdPrice() {
  if (solUsdPrice && Date.now() - solUsdCheckedAt < 60000) return solUsdPrice;
  if (solUsdRequest) return solUsdRequest;
  solUsdRequest = (async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      const body = await response.json();
      const price = safeNumber(body?.solana?.usd);
      if (price && price > 0) { solUsdPrice = price; solUsdCheckedAt = Date.now(); }
      return price;
    } catch (_) { return null; }
  })();
  try { return await solUsdRequest; } finally { solUsdRequest = null; }
}
function subscribeMintTrades(mint) {
  if (tradeSubscriptions && tradeFeedStatus === 'connected') tradeSubscriptions.subscribe(mint);
}

function processTradeMessage(data) {
  if (!data || typeof data.mint !== 'string' || !['buy', 'sell'].includes(String(data.txType || '').toLowerCase())) return false;
  const solAmount = safeNumber(data.solAmount);
  if (solAmount === null || solAmount < 0) return false;
  const now = Date.now();
  getSolUsdPrice().then(price => {
    if (!price) return;
    const side = String(data.txType).toLowerCase();
    const usdValue = solAmount * price;
    const trade = { side, timestamp: now, usdValue, wallet: data.traderPublicKey || null };
    const accepted = pressureStore.recordTrade(data.mint, trade);
    if (!accepted) return;
    persistence.save(data.mint, 'trade', now, trade).catch(() => {});
    const analysis = pressureStore.analyse(data.mint);
    const previous = alertedPressure.get(data.mint);
    if (analysis.signal === 'URGENT DUMP PRESSURE' && (!previous || now - previous > 30000)) {
      alertedPressure.set(data.mint, now);
      const alert = { signal: analysis.signal, analysis, automaticTrading: false, receivedAt: new Date(now).toISOString() };
      persistence.save(data.mint, 'alert', now, alert).catch(() => {});
      broadcast({ type: 'pressure-alert', mint: data.mint, ...alert });
    }
    broadcast({ type: 'trade-observation', mint: data.mint, side, usdValue, receivedAt: new Date(now).toISOString(), analysis });
  });
  return true;
}

async function fetchDexPairs(mint) {
  const cached = marketCache.get(mint);
  if (cached) return cached;
  if (!marketCache.canRequest()) throw new Error('DexScreener rate-limit cooldown active');
  const response = await fetch(
    `https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    }
  );

  marketCache.noteStatus(response.status);
  if (!response.ok) {
    throw new Error(`DexScreener HTTP ${response.status}`);
  }

  const pairs = await response.json();

  if (!Array.isArray(pairs) || !pairs.length) return null;

  pairs.sort((a, b) =>
    (Number(b?.liquidity?.usd) || 0) -
    (Number(a?.liquidity?.usd) || 0)
  );

  const pair = pairs[0];

  const market = {
    priceUsd: safeNumber(pair.priceUsd),
    marketCapUsd: safeNumber(pair.marketCap) ?? safeNumber(pair.fdv),
    liquidityUsd: safeNumber(pair.liquidity?.usd),
    volume24h: safeNumber(pair.volume?.h24),
    txns24h:
      (safeNumber(pair.txns?.h24?.buys) || 0) +
      (safeNumber(pair.txns?.h24?.sells) || 0),
    buys24h: safeNumber(pair.txns?.h24?.buys),
    sells24h: safeNumber(pair.txns?.h24?.sells),
    priceChange24h: safeNumber(pair.priceChange?.h24),
    image: pair.info?.imageUrl || null,
    pairAddress: pair.pairAddress || null,
    dexId: pair.dexId || null,
    dexUrl: pair.url || `https://dexscreener.com/solana/${mint}`,
    poolCreatedAt: pair.pairCreatedAt || null,
    baseName: pair.baseToken?.name || null,
    baseSymbol: pair.baseToken?.symbol || null,
    source: 'DexScreener',
    checkedAt: new Date().toISOString()
  };
  marketCache.set(mint, market);
  return market;
}

async function refreshOneToken(mint) {
  try {
    const market = await fetchDexPairs(mint);
    const prior = tokens.get(mint);

    if (!prior || !market) return;

    const merged = {
      ...prior,
      ...market,
      name: market.baseName || prior.name,
      symbol: market.baseSymbol || prior.symbol,
      updatedAt: new Date().toISOString()
    };

    tokens.set(mint, merged);
    if (Number.isFinite(merged.priceUsd) && merged.priceUsd > 0) {
      const snapshot = { timestamp: Date.now(), priceUsd: merged.priceUsd };
      pressureStore.recordSnapshot(mint, snapshot);
      persistence.save(mint, 'snapshot', snapshot.timestamp, snapshot).catch(() => {});
    }
    pressureStore.setRisk(mint, { liquidityUsd: merged.liquidityUsd, walletRisk: 'unknown', holderConcentrationPct: null });
    broadcast({ type: 'market-update', token: merged });
  } catch (error) {
    dexErrors++;

    if (dexErrors < 5 || dexErrors % 25 === 0) {
      console.error('DexScreener refresh failed:', error.message);
    }
  }
}

async function refreshMarketData() {
  if (refreshInProgress) return;

  refreshInProgress = true;

  try {
    const list = [...tokens.keys()].slice(0, 20);

    for (const mint of list) {
      await refreshOneToken(mint);
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    lastDexRefresh = new Date().toISOString();
  } finally {
    refreshInProgress = false;
  }
}

function connectPumpPortal() {
  clearTimeout(reconnectTimer);
  pumpStatus = 'connecting';

  broadcast({
    type: 'status',
    provider: 'PumpPortal',
    status: pumpStatus,
    time: new Date().toISOString()
  });

  console.log('Connecting to PumpPortal...');

  const socketUrl = process.env.PUMPPORTAL_API_KEY ? PUMP_URL + '?api-key=' + encodeURIComponent(process.env.PUMPPORTAL_API_KEY) : PUMP_URL;
  const socket = new WebSocket(socketUrl);
  pumpSocket = socket;

  socket.on('open', () => {
    if (pumpSocket !== socket) return;

    pumpStatus = 'connected';
    reconnectDelay = 2000;

    socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
    socket.send(JSON.stringify({ method: 'subscribeMigration' }));
    tradeSubscriptions = new TradeSubscriptionManager({ socket, maxSubscriptions: 100 });
    tradeFeedStatus = process.env.PUMPPORTAL_API_KEY ? 'connected' : 'disabled: API key required';
    if (process.env.PUMPPORTAL_API_KEY) {
      for (const mint of tokens.keys()) tradeSubscriptions.subscribe(mint);
    }

    console.log('PumpPortal connected; subscribed to launches and migrations');

    broadcast({
      type: 'status',
      provider: 'PumpPortal',
      status: pumpStatus,
      time: new Date().toISOString()
    });
  });

  socket.on('message', raw => {
    try {
      const parsed = JSON.parse(raw.toString());
      if (processTradeMessage(parsed)) return;
      addEvent(parsed);
    } catch (_) {
      console.error('Ignored invalid PumpPortal message');
    }
  });

  socket.on('error', error => {
    console.error('PumpPortal connection error:', error.message);
  });

  socket.on('close', () => {
    if (pumpSocket !== socket) return;

    pumpStatus = 'disconnected';
    tradeFeedStatus = process.env.PUMPPORTAL_API_KEY ? 'disconnected' : 'disabled: API key required';
    tradeSubscriptions = null;

    broadcast({
      type: 'status',
      provider: 'PumpPortal',
      status: pumpStatus,
      time: new Date().toISOString()
    });

    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectPumpPortal();
    }, reconnectDelay);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'GET only' });
  }

  if (url.pathname === '/health' || url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      app: 'HENRY ALPHA TERMINAL V2',
      version: '2.0.0-section-1',
      startedAt,
      automaticTrading: false
    });
  }

  if (url.pathname === '/status' || url.pathname === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      pumpPortal: pumpStatus,
      totalEvents,
      tokensTracked: tokens.size,
      recentEvents: recentEvents.length,
      dexScreener: 'market lookups enabled',
      lastDexRefresh,
      dexErrors,
      marketCache: marketCache.getStats(),
      pressureObservations: pressureStore.getStats(),
      tradeFeed: tradeFeedStatus,
      heliusRisk: process.env.HELIUS_API_KEY ? 'configured; queried per token on request' : 'not configured',
      persistence: persistence.status(),
      tradeSubscriptions: tradeSubscriptions ? tradeSubscriptions.stats() : { subscribedMints: 0, maxSubscriptions: 100 },
      solUsdPrice,
      pressureEngine: 'live trade ingestion is conditional on PumpPortal API key; BUY signals remain risk-gated',
      automaticTrading: false,
      persistenceMode: persistence.status().mode
    });
  }

  if (url.pathname.startsWith('/api/risk/')) {
    const mint = decodeURIComponent(url.pathname.slice('/api/risk/'.length));
    if (!mint) return sendJson(res, 400, { error: 'mint required' });
    const risk = await heliusRisk.getHolderRisk(mint);
    if (risk.status === 'observed') {
      pressureStore.setRisk(mint, {
        liquidityUsd: (tokens.get(mint) || {}).liquidityUsd,
        holderConcentrationPct: risk.top10ConcentrationPct,
        walletRisk: 'unknown'
      });
      persistence.save(mint, 'risk', Date.now(), risk).catch(() => {});
    }
    return sendJson(res, 200, { mint, risk, automaticTrading: false });
  }

  if (url.pathname === '/api/pressure') {
    const mint = url.searchParams.get('mint');
    if (mint) return sendJson(res, 200, { mint, analysis: pressureStore.analyse(mint), store: pressureStore.getStats() });
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const pressure = [...tokens.values()].slice(0, limit).map(token => ({
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      priceUsd: token.priceUsd,
      liquidityUsd: token.liquidityUsd,
      analysis: pressureStore.analyse(token.mint)
    }));
    return sendJson(res, 200, { count: pressure.length, pressure, store: pressureStore.getStats(), automaticTrading: false, note: 'Signals are based only on observed trades and snapshots; missing wallet-risk data cannot pass buy gates.' });
  }

  if (url.pathname === '/events' || url.pathname === '/api/events') {
    return sendJson(res, 200, recentEvents);
  }

  if (url.pathname === '/api/tokens') {
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'newest';
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get('limit') || 100))
    );

    let list = [...tokens.values()].filter(token =>
      !query ||
      [token.name, token.symbol, token.mint].some(value =>
        String(value || '').toLowerCase().includes(query)
      )
    );

    if (sort === 'liquidity') {
      list.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
    } else if (sort === 'volume') {
      list.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    } else if (sort === 'marketcap') {
      list.sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0));
    } else {
      list.sort((a, b) =>
        Date.parse(b.lastEventAt || 0) - Date.parse(a.lastEventAt || 0)
      );
    }

    return sendJson(res, 200, {
      count: list.length,
      tokens: list.slice(0, limit)
    });
  }

  const match = url.pathname.match(/^\/api\/token\/([^/]+)$/);

  if (match) {
    const mint = decodeURIComponent(match[1]);
    const token = tokens.get(mint);

    if (!token) {
      return sendJson(res, 404, {
        ok: false,
        error: 'Token has not been discovered by this service yet.',
        mint
      });
    }

    try {
      const market = await fetchDexPairs(mint);

      if (market) {
        const merged = {
          ...token,
          ...market,
          name: market.baseName || token.name,
          symbol: market.baseSymbol || token.symbol,
          updatedAt: new Date().toISOString()
        };

        tokens.set(mint, merged);
        if (Number.isFinite(merged.priceUsd) && merged.priceUsd > 0) {
          const snapshot = { timestamp: Date.now(), priceUsd: merged.priceUsd };
          pressureStore.recordSnapshot(mint, snapshot);
          persistence.save(mint, 'snapshot', snapshot.timestamp, snapshot).catch(() => {});
        }
        pressureStore.setRisk(mint, { liquidityUsd: merged.liquidityUsd, walletRisk: 'unknown', holderConcentrationPct: null });

        return sendJson(res, 200, {
          token: merged,
          recentEvents: recentEvents.filter(event =>
            event.data?.mint === mint
          ).slice(0, 50),
          dataNotes: {
            market: 'Latest DexScreener pair snapshot',
            history: 'Historical candles require stored observations or a separate history provider.',
            trades: 'This section collects launch and migration events, not full live trade history.'
          }
        });
      }
    } catch (error) {
      console.error('Token market lookup failed:', error.message);
    }

    return sendJson(res, 200, {
      token,
      recentEvents: recentEvents.filter(event =>
        event.data?.mint === mint
      ).slice(0, 50),
      dataNotes: {
        market: 'No DexScreener pair found yet',
        history: 'Historical candles are not available from this endpoint.',
        trades: 'This section collects launch and migration events only.'
      }
    });
  }

  if (url.pathname === '/api/market') {
    const mint = url.searchParams.get('mint');

    if (!mint) {
      return sendJson(res, 400, {
        ok: false,
        error: 'mint query parameter required'
      });
    }

    try {
      return sendJson(res, 200, {
        mint,
        market: await fetchDexPairs(mint)
      });
    } catch (error) {
      return sendJson(res, 502, {
        ok: false,
        error: 'Market provider unavailable',
        message: error.message
      });
    }
  }

  const file = path.join(__dirname, 'public', 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(503);
    return res.end('Dashboard file not found.');
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', socket => {
  clients.add(socket);

  socket.send(JSON.stringify({
    type: 'status',
    provider: 'PumpPortal',
    status: pumpStatus,
    time: new Date().toISOString()
  }));

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`HENRY ALPHA TERMINAL V2 listening on ${PORT}`);
  persistence.initialize().then(async result => {
    console.log('Pressure persistence:', result);
    if (!result || !result.ready || typeof persistence.mints !== 'function') return;
    try {
      const mints = await persistence.mints(500);
      let restored = 0;
      for (const mint of mints) {
        const rows = await persistence.recent(mint, 1000);
        // Query is newest-first; replay oldest-first so bounded in-memory windows
        // retain the most recent observations in their original order.
        rows.reverse();
        for (const row of rows) {
          const observedAt = row.observed_at;
          if (pressureStore.restoreObservation(mint, row.kind, observedAt, row.payload)) restored++;
        }
      }
      console.log('Pressure persistence recovery:', { mints: mints.length, restored });
    } catch (error) {
      console.error('Pressure persistence recovery failed; continuing in memory mode:', error.message);
    }
  }).catch(error => console.error('Pressure persistence initialization failed:', error.message));
  connectPumpPortal();
  setInterval(refreshMarketData, DEX_REFRESH_MS);
});
