'use strict';

const WebSocket = require('ws');

const PUMP_PROGRAMS = [
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
];
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

function tokenAmount(balance) {
  const amount = balance && balance.uiTokenAmount;
  if (!amount) return null;
  if (amount.uiAmountString !== null && amount.uiAmountString !== undefined && amount.uiAmountString !== '') {
    const uiString = Number(amount.uiAmountString);
    if (Number.isFinite(uiString)) return uiString;
  }
  if (amount.uiAmount !== null && amount.uiAmount !== undefined) {
    const uiNumber = Number(amount.uiAmount);
    if (Number.isFinite(uiNumber)) return uiNumber;
  }
  const raw = Number(amount.amount);
  const decimals = Number(amount.decimals);
  if (!Number.isFinite(raw) || !Number.isFinite(decimals)) return null;
  return raw / (10 ** decimals);
}

function parseObservedTrades(transaction, timestamp = Date.now()) {
  const meta = transaction && transaction.meta;
  const message = transaction && transaction.transaction && transaction.transaction.message;
  if (!meta || meta.err || !message || !Array.isArray(message.accountKeys)) return [];

  const accountKeys = message.accountKeys.map((entry, index) => ({
    address: typeof entry === 'string' ? entry : entry && (entry.pubkey || entry.address),
    signer: Boolean(entry && typeof entry === 'object' && entry.signer),
    index
  }));
  const signers = new Map(accountKeys.filter(entry => entry.address && entry.signer).map(entry => [entry.address, entry.index]));
  if (!signers.size) return [];

  const balances = new Map();
  for (const row of [...(meta.preTokenBalances || []), ...(meta.postTokenBalances || [])]) {
    if (!row || typeof row.owner !== 'string' || typeof row.mint !== 'string' || row.mint === WRAPPED_SOL_MINT) continue;
    const key = row.owner + ':' + row.mint;
    if (!balances.has(key)) balances.set(key, { owner: row.owner, mint: row.mint, pre: 0, post: 0 });
  }
  for (const row of meta.preTokenBalances || []) {
    const item = balances.get(row && row.owner + ':' + row.mint);
    const value = tokenAmount(row);
    if (item && value !== null) item.pre += value;
  }
  for (const row of meta.postTokenBalances || []) {
    const item = balances.get(row && row.owner + ':' + row.mint);
    const value = tokenAmount(row);
    if (item && value !== null) item.post += value;
  }

  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  const feeLamports = Number(meta.fee) || 0;
  const observed = [];

  for (const item of balances.values()) {
    const index = signers.get(item.owner);
    if (index === undefined || preBalances[index] === undefined || postBalances[index] === undefined) continue;
    const tokenDelta = item.post - item.pre;
    const nativeDelta = Number(postBalances[index]) - Number(preBalances[index]);
    if (!Number.isFinite(tokenDelta) || Math.abs(tokenDelta) <= 0 || !Number.isFinite(nativeDelta)) continue;

    let side = null;
    let solLamports = 0;
    if (tokenDelta > 0 && nativeDelta < 0) {
      side = 'buy';
      solLamports = Math.abs(nativeDelta);
      // If this wallet paid the transaction fee, exclude the fee from estimated trade size.
      if (index === 0) solLamports = Math.max(0, solLamports - feeLamports);
    } else if (tokenDelta < 0 && nativeDelta > 0) {
      side = 'sell';
      solLamports = nativeDelta + (index === 0 ? feeLamports : 0);
    }
    const solAmount = solLamports / 1e9;
    if (!side || !Number.isFinite(solAmount) || solAmount <= 0.00001) continue;
    observed.push({
      mint: item.mint,
      wallet: item.owner,
      side,
      solAmount,
      timestamp,
      source: 'Helius standard logs + confirmed transaction balance changes',
      estimate: true
    });
  }
  return observed;
}

function createHeliusTradeStream(options = {}) {
  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const onTrade = typeof options.onTrade === 'function' ? options.onTrade : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const WebSocketImpl = options.WebSocketImpl || WebSocket;
  const maxConcurrent = Math.max(1, Math.min(5, Number(options.maxConcurrent) || 3));
  const maxQueue = Math.max(50, Math.min(1000, Number(options.maxQueue) || 300));

  let socket = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let reconnectDelay = 2000;
  let stopped = false;
  let active = 0;
  const queue = [];
  const seen = new Map();
  let status = apiKey ? 'connecting' : 'disabled: HELIUS_API_KEY missing';

  function setStatus(value) {
    status = value;
    onStatus(value);
  }

  function pruneSeen(now) {
    for (const [signature, at] of seen) {
      if (now - at > 5 * 60 * 1000) seen.delete(signature);
      if (seen.size <= 15000) break;
    }
  }

  function enqueue(signature, blockTime) {
    if (!signature || seen.has(signature)) return;
    const now = Date.now();
    pruneSeen(now);
    seen.set(signature, now);
    if (queue.length >= maxQueue) queue.shift();
    queue.push({ signature, timestamp: Number.isFinite(Number(blockTime)) ? Number(blockTime) * 1000 : now });
    drain();
  }

  async function fetchAndParse(item) {
    if (typeof fetchImpl !== 'function') return;
    const response = await fetchImpl('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: item.signature,
        method: 'getTransaction',
        params: [item.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Helius getTransaction HTTP ' + response.status);
    const body = await response.json();
    if (body.error || !body.result) return;
    const transactionTime = Number(body.result.blockTime) > 0 ? Number(body.result.blockTime) * 1000 : item.timestamp;
    const trades = parseObservedTrades(body.result, transactionTime);
    for (const trade of trades) {
      try { onTrade(trade); } catch (_) {}
    }
  }

  function drain() {
    while (!stopped && active < maxConcurrent && queue.length) {
      const item = queue.shift();
      active++;
      fetchAndParse(item).catch(() => {}).finally(() => {
        active--;
        drain();
      });
    }
  }

  function connect() {
    if (stopped || !apiKey) return;
    clearTimeout(reconnectTimer);
    setStatus('connecting');
    const current = new WebSocketImpl('wss://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(apiKey));
    socket = current;

    current.on('open', () => {
      if (socket !== current || stopped) return;
      reconnectDelay = 2000;
      setStatus('connected: standard Solana logs');
      PUMP_PROGRAMS.forEach((programId, index) => {
        current.send(JSON.stringify({
          jsonrpc: '2.0',
          id: index + 1,
          method: 'logsSubscribe',
          params: [{ mentions: [programId] }, { commitment: 'confirmed' }]
        }));
      });
      heartbeatTimer = setInterval(() => {
        if (socket === current && current.readyState === WebSocketImpl.OPEN) {
          try { current.ping(); } catch (_) {}
        }
      }, 30000);
    });

    current.on('message', raw => {
      if (socket !== current) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.method !== 'logsNotification') return;
        const value = message.params && message.params.result && message.params.result.value;
        if (!value || value.err || !Array.isArray(value.logs)) return;
        const logs = value.logs.join('\n');
        if (!/Instruction: (Buy|Sell)/i.test(logs)) return;
        enqueue(value.signature, value.blockTime);
      } catch (_) {}
    });

    current.on('error', () => {});
    current.on('close', () => {
      if (socket !== current) return;
      clearInterval(heartbeatTimer);
      socket = null;
      if (stopped) return;
      setStatus('disconnected; reconnecting');
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect();
      }, reconnectDelay);
    });
  }

  function start() {
    if (!apiKey) {
      setStatus('disabled: HELIUS_API_KEY missing');
      return;
    }
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(heartbeatTimer);
    if (socket) {
      const current = socket;
      socket = null;
      try { current.close(); } catch (_) {}
    }
    queue.length = 0;
    setStatus('stopped');
  }

  function stats() {
    return { status, queuedSignatures: queue.length, activeTransactionLookups: active, deduplicatedSignatures: seen.size, programs: PUMP_PROGRAMS.length };
  }

  return { start, stop, stats };
}

module.exports = { PUMP_PROGRAMS, parseObservedTrades, createHeliusTradeStream };
