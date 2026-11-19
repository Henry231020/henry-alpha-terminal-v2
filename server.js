require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { MarketCache } = require('./lib/market-cache');
const { PressureStore } = require('./lib/pressure-store');
const { TradeSubscriptionManager } = require('./lib/trade-subscriptions');
const { createHeliusRiskClient } = require('./lib/helius-risk');
const { createRugCheckRiskClient } = require('./lib/rugcheck-risk');
const { createPressurePersistence } = require('./lib/pressure-persistence');
const { createFeedDiagnostics } = require('./lib/feed-diagnostics');
const { parseTradeMessage } = require('./lib/trade-message');
const { parseGeckoTrades } = require('./lib/gecko-trades');
const { WalletIntelligence } = require('./lib/wallet-intelligence');
const { TradeLearningEngine } = require('./lib/trade-learning');
const { AlertStore } = require('./lib/alert-store');
const { AlertThrottle } = require('./lib/alert-throttle');
const { newestTokenMints, prioritisedTokenMints } = require('./lib/token-priority');
const { RiskRequestGuard } = require('./lib/risk-request-guard');
const { valueTradeInUsd, MAX_TRADE_QUOTE_AGE_MS } = require('./lib/trade-valuation');
const { isSafeMetadataUrl } = require('./lib/safe-metadata-url');
const { boundedInteger } = require('./lib/query-limits');
const { pressureAlertSignal } = require('./lib/pressure-alert');
const { selectPairForMint, normalisePairForMint } = require('./lib/dex-pair-normalizer');
const heliusRisk = createHeliusRiskClient();
const rugCheckRisk = createRugCheckRiskClient();
const persistence = createPressurePersistence();
const marketCache = new MarketCache({ ttlMs: 20000, maxEntries: 1000 });
const pressureStore = new PressureStore();
const walletIntelligence = new WalletIntelligence();
const tradeLearning = new TradeLearningEngine();
const alertStore = new AlertStore({ maxAlerts: 500 });
let tradeSubscriptions = null;
let solUsdPrice = null;
let solUsdCheckedAt = 0;
let solUsdRequest = null;
let solUsdRetryAfter = 0;
const SOL_USD_FAILURE_COOLDOWN_MS = 15000;
let tradeFeedStatus = 'GeckoTerminal public polling active; PumpPortal paid trade stream not used';
const geckoDiagnostics = { status: 'starting', calls: 0, tradesSeen: 0, tradesRecorded: 0, duplicateOrStale: 0, errors: 0, lastCallAt: null, lastTradeAt: null, lastError: null };
const geckoSeenTrades = new Set();
let geckoCursor = 0;
let geckoPollInProgress = false;
const alertThrottle = new AlertThrottle({ cooldownMs: 30000, retentionMs: 10 * 60 * 1000, maxEntries: 5000 });
const riskRequestGuard = new RiskRequestGuard({ cooldownMs: 30000, maxConcurrent: 3 });

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
const feedDiagnostics = createFeedDiagnostics();
let lastDexRefresh = null;
let dexErrors = 0;
let dexCooldownSkips = 0;
let dexNoPairResults = 0;
let dexHttpErrors = 0;
let dexNetworkErrors = 0;
let dexLastError = null;
let refreshInProgress = false;
const selectedTokenOrder = new Map();
const MAX_SELECTED_TOKENS = 20;


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

function resolveMetadataUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const uri = value.trim();
  if (isSafeMetadataUrl(uri)) return uri;
  if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
  return null;
}

function resolveImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const uri = value.trim();
  if (/^https:\/\//i.test(uri)) return uri;
  if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
  return null;
}

const metadataRequests = new Set();
async function resolveTokenMetadata(token) {
  if (!token || !token.mint || token.image || !token.uri || metadataRequests.has(token.mint)) return;
  const metadataUrl = resolveMetadataUrl(token.uri);
  if (!metadataUrl) return;
  metadataRequests.add(token.mint);
  try {
    const response = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return;
    const metadata = await response.json();
    const current = tokens.get(token.mint);
    if (!current || current.uri !== token.uri) return;
    const image = resolveImageUrl(metadata && metadata.image);
    const next = {
      ...current,
      name: current.name === 'Unknown token' && metadata.name ? metadata.name : current.name,
      symbol: current.symbol || (metadata.symbol || ''),
      image,
      metadataStatus: image ? 'image loaded from token metadata' : 'metadata checked; image unavailable',
      updatedAt: new Date().toISOString()
    };
    tokens.set(token.mint, next);
    broadcast({ type: 'token-metadata', token: next });
  } catch (_) {
    const current = tokens.get(token.mint);
    if (current && current.uri === token.uri) {
      tokens.set(token.mint, { ...current, metadataStatus: 'metadata fetch failed; image unavailable' });
    }
  } finally {
    metadataRequests.delete(token.mint);
  }
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
  if (token && token.mint) {
    subscribeMintTrades(token.mint);
    if (!token.image && token.uri) resolveTokenMetadata(token);
  }

  broadcast({
    type: 'provider-event',
    ...event,
    token
  });
}

async function getSolUsdPrice() {
  const now = Date.now();
  if (solUsdPrice && now - solUsdCheckedAt < 60000) return { price: solUsdPrice, checkedAt: solUsdCheckedAt };
  if (solUsdRequest) return solUsdRequest;
  if (now < solUsdRetryAfter) return null;
  solUsdRequest = (async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const retryHeader = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
        const retryMs = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(retryHeader * 1000, 5 * 60 * 1000) : SOL_USD_FAILURE_COOLDOWN_MS;
        solUsdRetryAfter = Date.now() + retryMs;
        return null;
      }
      const body = await response.json();
      const price = safeNumber(body?.solana?.usd);
      if (price && price > 0) { solUsdPrice = price; solUsdCheckedAt = Date.now(); solUsdRetryAfter = 0; return { price, checkedAt: solUsdCheckedAt }; }
      solUsdRetryAfter = Date.now() + SOL_USD_FAILURE_COOLDOWN_MS;
      return null;
    } catch (_) { solUsdRetryAfter = Date.now() + SOL_USD_FAILURE_COOLDOWN_MS; return null; }
  })();
  try { return await solUsdRequest; } finally { solUsdRequest = null; }
}
function subscribeMintTrades(mint) {
  if (tradeSubscriptions && tradeFeedStatus === 'connected') tradeSubscriptions.subscribeLatest(mint);
}

const pendingTrades = [];
const MAX_PENDING_TRADES = 500;

function recordPressureAlert(mint, signal, analysis, timestamp = Date.now()) {
  // Cool down each mint/signal pair independently: a BUY alert must not suppress
  // a later SELL warning for the same token.
  const key = mint + ':' + signal;
  if (!alertThrottle.shouldAllow(key, timestamp)) return false;
  const alert = { mint, signal, analysis, automaticTrading: false, receivedAt: new Date(timestamp).toISOString() };
  alertStore.record(alert);
  persistence.save(mint, 'alert', timestamp, alert).catch(() => {});
  broadcast({ type: 'pressure-alert', ...alert });
  return true;
}

function recordObservedUsdTrade(mint, item) {
  const { side, timestamp, wallet } = item;
  const usdValue = Number(item.usdValue);
  if (!Number.isFinite(usdValue) || usdValue <= 0) return false;
  const tokenFirstSeenAt = tokens.get(mint)?.firstSeenAt || null;
  const trade = { side, timestamp, usdValue, usdValueApproximate: false, solUsdQuoteAgeMs: null, wallet: wallet || null, tokenFirstSeenAt };
  const accepted = pressureStore.recordTrade(mint, trade);
  if (!accepted) { feedDiagnostics.recordStoreRejected(); return false; }
  feedDiagnostics.recordTradeRecorded(new Date(timestamp).toISOString());
  walletIntelligence.recordTrade(mint, trade, tokenFirstSeenAt);
  persistence.save(mint, 'trade', timestamp, trade).catch(() => {});
  const analysis = pressureStore.analyse(mint);
  const alertSignal = pressureAlertSignal(analysis);
  if (alertSignal) recordPressureAlert(mint, alertSignal, analysis, timestamp);
  broadcast({ type: 'trade-observation', mint, side, usdValue: trade.usdValue, usdValueApproximate: false, solUsdQuoteAgeMs: null, receivedAt: new Date(timestamp).toISOString(), analysis });
  return true;
}

function recordTradeAtPrice(item, quote) {
  const valuation = valueTradeInUsd(item, quote);
  if (!valuation) { feedDiagnostics.recordStalePriceValuation(); return; }
  recordObservedUsdTrade(item.mint, { ...item, ...valuation });
}

function processTradeMessage(data) {
  const parsedTrade = parseTradeMessage(data);
  if (!parsedTrade.ok) {
    if (parsedTrade.candidate) feedDiagnostics.recordRejected(parsedTrade.reason);
    return false;
  }
  feedDiagnostics.recordValidTrade();
  const item = { ...parsedTrade.trade, timestamp: Date.now() };
  getSolUsdPrice().then(quote => {
    if (!quote || !quote.price) {
      feedDiagnostics.recordPriceUnavailable();
      // Retain a bounded queue so a temporary price-provider outage does not
      // discard otherwise valid trades. Expire old items before retrying.
      const cutoff = Date.now() - MAX_TRADE_QUOTE_AGE_MS;
      while (pendingTrades.length && pendingTrades[0].timestamp < cutoff) pendingTrades.shift();
      if (pendingTrades.length >= MAX_PENDING_TRADES) pendingTrades.shift();
      pendingTrades.push(item);
      return;
    }
    const cutoff = Date.now() - MAX_TRADE_QUOTE_AGE_MS;
    while (pendingTrades.length && pendingTrades[0].timestamp < cutoff) pendingTrades.shift();
    const queued = pendingTrades.splice(0, pendingTrades.length);
    for (const pending of queued) recordTradeAtPrice(pending, quote);
    recordTradeAtPrice(item, quote);
  }).catch(() => {
    feedDiagnostics.recordPriceUnavailable();
    const cutoff = Date.now() - MAX_TRADE_QUOTE_AGE_MS;
    while (pendingTrades.length && pendingTrades[0].timestamp < cutoff) pendingTrades.shift();
    if (pendingTrades.length >= MAX_PENDING_TRADES) pendingTrades.shift();
    pendingTrades.push(item);
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

  if (!Array.isArray(pairs) || !pairs.length) {
    dexNoPairResults++;
    return null;
  }

  const pair = selectPairForMint(pairs, mint);
  if (!pair) {
    dexNoPairResults++;
    return null;
  }
  const market = normalisePairForMint(pair, mint);
  if (!market || !Number.isFinite(market.priceUsd) || market.priceUsd <= 0) {
    dexNoPairResults++;
    return null;
  }
  market.dexUrl = market.dexUrl || `https://dexscreener.com/solana/${mint}`;
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
    pressureStore.updateLiquidity(mint, merged.liquidityUsd, merged.checkedAt || Date.now());
    if (Number.isFinite(merged.priceUsd) && merged.priceUsd > 0) {
      const snapshot = { timestamp: Date.parse(merged.checkedAt || '') || Date.now(), priceUsd: merged.priceUsd };
      const snapshotRecorded = pressureStore.recordSnapshot(mint, snapshot);
      if (snapshotRecorded) persistence.save(mint, 'snapshot', snapshot.timestamp, snapshot).catch(() => {});
      if (snapshotRecorded) {
        pressureStore.updateLiquidity(mint, merged.liquidityUsd, merged.checkedAt || Date.now());
        const analysis = pressureStore.analyse(mint);
        const decisionAction = analysis.tradeDecision?.action;
        if (decisionAction === 'BUY SETUP' || decisionAction === 'SELL / EXIT WARNING') {
          recordPressureAlert(mint, decisionAction, analysis, snapshot.timestamp);
        }
        const learningResult = tradeLearning.observe({ mint, analysis, priceUsd: merged.priceUsd, timestamp: snapshot.timestamp });
        if (learningResult.trade) {
          persistence.save(mint, 'paper_trade', learningResult.trade.exitAt || learningResult.trade.entryAt, learningResult.trade).catch(() => {});
          broadcast({ type: 'paper-trade-update', mint, trade: learningResult.trade, learning: tradeLearning.summary(20) });
        }
      }
    }
    broadcast({ type: 'market-update', token: merged });
  } catch (error) {
    const message = String(error && error.message || 'Unknown DEX error');
    dexLastError = { message, at: new Date().toISOString() };
    if (message.includes('rate-limit cooldown active')) {
      dexCooldownSkips++;
      return;
    }
    dexErrors++;
    if (message.startsWith('DexScreener HTTP ')) dexHttpErrors++;
    else dexNetworkErrors++;
    if (dexErrors < 5 || dexErrors % 25 === 0) {
      console.error('DexScreener refresh failed:', message);
    }
  }
}

async function refreshMarketData() {
  if (refreshInProgress) return;

  refreshInProgress = true;

  try {
    // Prioritise first discovery time, not last activity: busy older tokens must not
    // keep newer launches out of the market-price warm-up window.
    const list = prioritisedTokenMints([...tokens.values()], [...selectedTokenOrder.keys()], 20);

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
  broadcast({ type: 'status', provider: 'PumpPortal discovery', status: pumpStatus, time: new Date().toISOString() });
  // Free discovery only. Do not subscribe to PumpPortal's paid token-trade stream.
  const socket = new WebSocket(PUMP_URL);
  pumpSocket = socket;
  socket.on('open', () => {
    if (pumpSocket !== socket) return;
    pumpStatus = 'connected';
    reconnectDelay = 2000;
    socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
    socket.send(JSON.stringify({ method: 'subscribeMigration' }));
    tradeSubscriptions = null;
    tradeFeedStatus = 'GeckoTerminal public trade polling active; PumpPortal discovery only';
    console.log('PumpPortal free discovery connected; paid trade subscriptions disabled');
    broadcast({ type: 'status', provider: 'PumpPortal discovery', status: pumpStatus, time: new Date().toISOString() });
  });
  socket.on('message', raw => {
    feedDiagnostics.recordMessage();
    try {
      const parsed = JSON.parse(raw.toString());
      // Never parse PumpPortal trade events: the paid trade subscription is not used.
      addEvent(parsed);
    } catch (_) {
      feedDiagnostics.recordMalformedJson();
      console.error('Ignored invalid PumpPortal discovery message');
    }
  });
  socket.on('error', error => console.error('PumpPortal discovery error:', error.message));
  socket.on('close', () => {
    if (pumpSocket !== socket) return;
    pumpStatus = 'disconnected';
    tradeFeedStatus = 'GeckoTerminal public polling active; PumpPortal discovery disconnected';
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectPumpPortal();
    }, reconnectDelay);
  });
}

async function pollGeckoTerminalTrades() {
  if (geckoPollInProgress) return;
  geckoPollInProgress = true;
  geckoDiagnostics.status = 'polling public API';
  try {
    const candidates = [...tokens.values()]
      .filter(token => token && token.mint && token.pairAddress)
      .sort((a, b) => (selectedTokenOrder.get(b.mint) || Date.parse(b.firstSeenAt || '') || 0) - (selectedTokenOrder.get(a.mint) || Date.parse(a.firstSeenAt || '') || 0));
    if (!candidates.length) {
      geckoDiagnostics.status = 'waiting for tokens with a verified DEX pool';
      return;
    }
    const count = Math.min(8, candidates.length);
    const start = geckoCursor % candidates.length;
    const batch = Array.from({ length: count }, (_, i) => candidates[(start + i) % candidates.length]);
    geckoCursor = (start + count) % candidates.length;
    for (let i = 0; i < batch.length; i++) {
      const token = batch[i];
      const url = 'https://api.geckoterminal.com/api/v2/networks/solana/pools/' +
        encodeURIComponent(token.pairAddress) + '/trades';
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json;version=20230203' },
          signal: AbortSignal.timeout(10000)
        });
        geckoDiagnostics.calls++;
        geckoDiagnostics.lastCallAt = new Date().toISOString();
        if (!response.ok) throw new Error('GeckoTerminal HTTP ' + response.status);
        const body = await response.json();
        const trades = parseGeckoTrades(body, token.mint, token.priceOrientation);
        for (const item of trades) {
          const key = item.txHash + ':' + item.timestamp + ':' + item.side;
          if (geckoSeenTrades.has(key)) { geckoDiagnostics.duplicateOrStale++; continue; }
          geckoSeenTrades.add(key);
          if (geckoSeenTrades.size > 10000) geckoSeenTrades.delete(geckoSeenTrades.values().next().value);
          const recorded = recordObservedUsdTrade(token.mint, item);
          if (recorded) {
            geckoDiagnostics.tradesRecorded++;
            geckoDiagnostics.lastTradeAt = new Date(item.timestamp).toISOString();
          }
          geckoDiagnostics.tradesSeen++;
        }
        geckoDiagnostics.lastError = null;
      } catch (error) {
        geckoDiagnostics.errors++;
        geckoDiagnostics.lastError = String(error.message || error).slice(0, 180);
      }
      // Public GeckoTerminal limit is approximately 10 calls/minute; stay below it.
      if (i < batch.length - 1) await new Promise(resolve => setTimeout(resolve, 6500));
    }
    geckoDiagnostics.status = 'active; public API polling';
  } finally {
    geckoPollInProgress = false;
  }
}
const server = http.createServer(async (req, res) => {
  // The dashboard and API are same-origin; do not grant arbitrary websites
  // cross-origin access to live market and account-adjacent diagnostics.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

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
      dexDiagnostics: { httpErrors: dexHttpErrors, networkErrors: dexNetworkErrors, cooldownSkips: dexCooldownSkips, noPairResults: dexNoPairResults, lastError: dexLastError },
      marketCache: marketCache.getStats(),
      pressureObservations: pressureStore.getStats(),
      tradeFeed: tradeFeedStatus,
      feedDiagnostics: feedDiagnostics.snapshot(),
      geckoTradeFeed: { ...geckoDiagnostics, seenTransactionKeys: geckoSeenTrades.size, publicFreeTier: true, documentedApproximateLimitPerMinute: 10 },
      heliusRisk: process.env.HELIUS_API_KEY ? 'configured; queried per token on request' : 'not configured',
      rugCheckRisk: 'public token report queried on token selection; optional RUGCHECK_API_KEY supported',
      persistence: persistence.status(),
      tradeLearning: tradeLearning.summary(10),
      tradeSubscriptions: tradeSubscriptions ? tradeSubscriptions.stats() : { subscribedMints: 0, maxSubscriptions: 100 },
      solUsdPrice,
      solUsdQuoteAt: solUsdCheckedAt ? new Date(solUsdCheckedAt).toISOString() : null,
      solUsdQuoteAgeMs: solUsdCheckedAt ? Math.max(0, Date.now() - solUsdCheckedAt) : null,
      solUsdRetryAfter: solUsdRetryAfter > Date.now() ? new Date(solUsdRetryAfter).toISOString() : null,
      pressureEngine: 'GeckoTerminal public trade polling; market signals remain risk-gated and data freshness is provider-limited',
      automaticTrading: false,
      persistenceMode: persistence.status().mode
    });
  }

  if (url.pathname.startsWith('/api/risk/')) {
    let mint;
    try {
      mint = decodeURIComponent(url.pathname.slice('/api/risk/'.length));
    } catch (_) {
      return sendJson(res, 400, { error: 'Invalid mint address encoding' });
    }
    const permit = riskRequestGuard.begin(mint);
    if (!permit.ok) return sendJson(res, permit.status, { error: permit.reason, retryAfterMs: permit.retryAfterMs || null, automaticTrading: false });
    try {
      const [risk, rugcheck] = await Promise.all([
        heliusRisk.getHolderRisk(mint),
        rugCheckRisk.getTokenRisk(mint)
      ]);
      // Never carry a previous concentration forward when the current Helius
      // scan is unavailable or incomplete; unknown must remain unknown.
      const holderConcentrationPct = risk.status === 'observed'
        ? risk.top10ConcentrationPct
        : null;
      const observedRiskTimes = [
        risk.status === 'observed' ? Number(risk.checkedAt) : NaN,
        rugcheck.status === 'observed' ? Number(rugcheck.checkedAt) : NaN
      ].filter(value => Number.isFinite(value) && value <= Date.now() + 5000);
      // Use the older source timestamp so cached provider data cannot make
      // the combined risk assessment appear fresher than its oldest input.
      const checkedAt = observedRiskTimes.length
        ? Math.min(...observedRiskTimes, Date.now())
        : Date.now();
      pressureStore.updateHolderRisk(mint, {
        holderConcentrationPct,
        walletRisk: rugcheck.status === 'observed' ? rugcheck.walletRisk : 'unknown',
        checkedAt
      });
      const savedRisk = {
        holderConcentrationPct,
        walletRisk: rugcheck.status === 'observed' ? rugcheck.walletRisk : 'unknown',
        checkedAt,
        helius: risk,
        rugcheck
      };
      persistence.save(mint, 'risk', checkedAt, savedRisk).catch(() => {});
      return sendJson(res, 200, { mint, risk, rugcheck, checkedAt: new Date(checkedAt).toISOString(), analysis: pressureStore.analyse(mint), automaticTrading: false });
    } finally {
      permit.release();
    }
  }

  if (url.pathname === '/api/alerts/recent') {
    const limit = boundedInteger(url.searchParams.get('limit'), { fallback: 20, min: 1, max: 100 });
    const persisted = await persistence.recentAlertsAll(limit);
    const saved = persisted.map(row => ({ mint: row.mint, observedAt: row.observed_at, ...(row.payload || {}) }));
    const combined = [...alertStore.recent(limit), ...saved]
      .sort((a, b) => Date.parse(b.receivedAt || b.observedAt || 0) - Date.parse(a.receivedAt || a.observedAt || 0));
    const seen = new Set();
    const alerts = combined.filter(item => {
      const key = String(item.mint || '') + ':' + String(item.signal || '') + ':' + String(item.receivedAt || item.observedAt || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
    return sendJson(res, 200, { count: alerts.length, alerts, persistence: persistence.status(), automaticTrading: false });
  }

  if (url.pathname === '/api/alerts') {
    const mint = url.searchParams.get('mint');
    if (!mint) return sendJson(res, 400, { error: 'mint query parameter required' });
    const limit = boundedInteger(url.searchParams.get('limit'), { fallback: 25, min: 1, max: 100 });
    const rows = await persistence.recentAlerts(mint, limit);
    const persisted = rows.map(row => ({
      mint,
      observedAt: row.observed_at,
      ...(row.payload || {})
    }));
    const combined = [...alertStore.recent(limit, mint), ...persisted]
      .sort((a, b) => Date.parse(b.receivedAt || b.observedAt || 0) - Date.parse(a.receivedAt || a.observedAt || 0));
    const seen = new Set();
    const alerts = combined.filter(item => {
      const key = String(item.signal || '') + ':' + String(item.receivedAt || item.observedAt || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
    return sendJson(res, 200, { mint, count: alerts.length, alerts, persistence: persistence.status(), automaticTrading: false });
  }

  if (url.pathname === '/api/learning') {
    const limit = boundedInteger(url.searchParams.get('limit'), { fallback: 50, min: 1, max: 200 });
    return sendJson(res, 200, { ...tradeLearning.summary(limit), persistence: persistence.status() });
  }

  if (url.pathname === '/api/wallet-intelligence') {
    const mint = url.searchParams.get('mint');
    if (!mint) return sendJson(res, 400, { error: 'mint query parameter required' });
    const token = tokens.get(mint);
    return sendJson(res, 200, { mint, intelligence: walletIntelligence.analyse(mint, token?.firstSeenAt), automaticTrading: false });
  }

  if (url.pathname === '/api/pressure') {
    const mint = url.searchParams.get('mint');
    if (mint) return sendJson(res, 200, { mint, analysis: pressureStore.analyse(mint), walletIntelligence: walletIntelligence.analyse(mint, tokens.get(mint)?.firstSeenAt), store: pressureStore.getStats() });
    const limit = boundedInteger(url.searchParams.get('limit'), { fallback: 100, min: 1, max: 200 });
    const pressure = [...tokens.values()]
      .sort((a, b) => Date.parse(b.lastEventAt || b.firstSeenAt || 0) - Date.parse(a.lastEventAt || a.firstSeenAt || 0))
      .slice(0, limit)
      .map(token => ({
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

  if (url.pathname.startsWith('/api/token/')) {
    let mint;
    try {
      mint = decodeURIComponent(url.pathname.slice('/api/token/'.length));
    } catch (_) {
      return sendJson(res, 400, { ok: false, error: 'Invalid token address encoding' });
    }
    const token = tokens.get(mint);
    if (!token) return sendJson(res, 404, { ok: false, error: 'Token not found in the current discovery session' });

    // Keep recently selected tokens in the market refresh rotation so their indicators
    // continue warming even when they fall outside the newest-launch window.
    selectedTokenOrder.delete(mint);
    selectedTokenOrder.set(mint, Date.now());
    while (selectedTokenOrder.size > MAX_SELECTED_TOKENS) selectedTokenOrder.delete(selectedTokenOrder.keys().next().value);
    // Selecting a token promotes its live trade subscription and requests a fresh
    // market quote, even when it is outside the background scanner's newest-20 window.
    subscribeMintTrades(mint);
    await refreshOneToken(mint);
    const current = tokens.get(mint) || token;
    const recentTokenEvents = recentEvents
      .filter(event => event && event.data && event.data.mint === mint)
      .slice(0, 20);
    const marketNote = current.priceUsd > 0
      ? 'DexScreener quote · last checked ' + current.checkedAt
      : 'No valid DexScreener quote is available yet; market and indicator data remain unverified.';
    return sendJson(res, 200, {
      token: current,
      recentEvents: recentTokenEvents,
      dataNotes: { market: marketNote },
      automaticTrading: false
    });
  }

  if (url.pathname === '/api/tokens') {
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'newest';
    const limit = Math.min(
      200,
      boundedInteger(url.searchParams.get('limit'), { fallback: 100, min: 1, max: 200 })
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

wss.on('connection', (socket, req) => {
  // Browsers include Origin on WebSocket handshakes. Reject cross-site pages
  // attempting to subscribe to this live feed; non-browser clients may omit it.
  const origin = req && req.headers && req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        socket.close(1008, 'Origin not allowed');
        return;
      }
    } catch (_) {
      socket.close(1008, 'Invalid origin');
      return;
    }
  }
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

  let liveFeedsStarted = false;
  function startLiveFeeds() {
    if (liveFeedsStarted) return;
    liveFeedsStarted = true;
    connectPumpPortal();
    setInterval(refreshMarketData, DEX_REFRESH_MS);
    setTimeout(pollGeckoTerminalTrades, 5000);
    setInterval(pollGeckoTerminalTrades, 60000);
  }

  persistence.initialize().then(async result => {
    console.log('Pressure persistence:', result);
    if (result && result.ready && typeof persistence.mints === 'function') {
      try {
        const [recentMints, openPaperMints] = await Promise.all([
          persistence.mints(500),
          typeof persistence.openPaperMints === 'function' ? persistence.openPaperMints(1000) : Promise.resolve([])
        ]);
        // Include every currently open paper position even when its mint has
        // been inactive long enough to fall outside the recent-mint window.
        const mints = [...new Set([...openPaperMints, ...recentMints])];
        const openPaperMintSet = new Set(openPaperMints);
        let restored = 0;
        for (const mint of mints) {
          const rows = await persistence.recent(mint, 1000);
          // Query is newest-first; replay oldest-first before accepting live events.
          rows.reverse();
          for (const row of rows) {
            if (row.kind === 'paper_trade') { if (tradeLearning.restoreTrade(row.payload)) restored++; }
            else if (pressureStore.restoreObservation(mint, row.kind, row.observed_at, row.payload)) {
              if (row.kind === 'trade' && row.payload && typeof row.payload.wallet === 'string') {
                walletIntelligence.recordTrade(mint, { ...row.payload, timestamp: Number(row.payload.timestamp ?? new Date(row.observed_at).getTime()) }, row.payload.tokenFirstSeenAt || tokens.get(mint)?.firstSeenAt);
              }
              restored++;
            }
          }
          // The entry record for a long-lived open position may be older than
          // the 1,000-row mixed market-history window. Reapply its latest
          // paper state after replay so older closed records cannot override it.
          if (openPaperMintSet.has(mint) && typeof persistence.latestPaperTrade === 'function') {
            const latestPaperTrade = await persistence.latestPaperTrade(mint);
            if (latestPaperTrade && tradeLearning.restoreTrade(latestPaperTrade.payload)) restored++;
          }
        }
        console.log('Pressure persistence recovery:', { mints: mints.length, restored });
      } catch (error) {
        console.error('Pressure persistence recovery failed; continuing in memory mode:', error.message);
      }
    }
  }).catch(error => {
    console.error('Pressure persistence initialization failed:', error.message);
  }).finally(startLiveFeeds);
});
